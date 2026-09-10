import { Sqlite } from "resource://gre/modules/Sqlite.sys.mjs";
import { AsyncShutdown } from "resource://gre/modules/AsyncShutdown.sys.mjs";
import { PlacesUtils } from "resource://gre/modules/PlacesUtils.sys.mjs";
import * as GeckoEmbeddings from "chrome://global/content/ml/EmbeddingsGenerator.sys.mjs";
import { setTimeout, clearTimeout } from "resource://gre/modules/Timer.sys.mjs";
import { FluxionMemorySearch } from "resource://fluxion/modules/FluxionMemorySearch.sys.mjs";
import { FluxionMemoryPolicy } from "resource://fluxion/modules/FluxionMemoryPolicy.sys.mjs";

const FILE_NAME = "fluxion_memory.sqlite";
const SCHEMA_VERSION = 3;
let connectionPromise;
let embedder;
let pendingEmbedding;
let shutdownStarted = false;
let shutdownBlockerRegistered = false;
let shutdownPromise;
let shutdownStep = "Database has not been opened";
// Shared across browser windows: privacy changes invalidate work already in flight.
let revision = 0;
let historyDeletion = Promise.resolve();
const HISTORY_EVENTS = ["history-cleared", "page-removed"];
const PENDING_REMOVAL_PREF = "fluxion.memory.pendingRemoval";
const recoverOnOpen = Services.prefs.getBoolPref(PENDING_REMOVAL_PREF, false);
let pendingRemovals = 0;

function persistRemovalPending(value) {
  Services.prefs.setBoolPref(PENDING_REMOVAL_PREF, value);
  Services.prefs.savePrefFile(null);
}

function removeEvidence(remove, fullClear = false) {
  revision += 1;
  pendingRemovals += 1;
  const previous = historyDeletion;
  let persistenceError;
  try { persistRemovalPending(true); } catch (error) { persistenceError = error; }
  historyDeletion = (async () => {
    if (persistenceError) throw persistenceError;
    try { await previous; } catch (error) { if (!fullClear) throw error; }
    await remove(await connection());
  })().then(() => {
    pendingRemovals -= 1;
    if (!pendingRemovals) persistRemovalPending(false);
  }, error => {
    pendingRemovals -= 1;
    throw error;
  });
  historyDeletion.catch(Cu.reportError);
  return historyDeletion;
}

function vectorFrom(result, expectedSize) {
  let value = result?.output ?? result;
  if (Array.isArray(value) && value.length === 1 && (Array.isArray(value[0]) || ArrayBuffer.isView(value[0]))) value = value[0];
  if (!Array.isArray(value) && !ArrayBuffer.isView(value)) throw new Error("Fluxion embedding returned no vector");
  if (value.length !== expectedSize) throw new Error(`Fluxion embedding dimension ${value.length} did not match ${expectedSize}`);
  return value;
}

function excludedDomains() {
  return FluxionMemoryPolicy.parseExcludedDomains(
    Services.prefs.getStringPref("fluxion.memory.excludedDomains", "[]"),
  );
}

async function pruneBlocked(db, domains) {
  // Keyset batches bound chrome-thread work and keep the cursor stable while
  // rows are deleted. The same policy guards new evidence and old profiles.
  let after = 0;
  const limit = 256;
  for (;;) {
    const rows = await db.executeCached(
      "SELECT id,url FROM pages WHERE id > :after ORDER BY id LIMIT :limit", { after, limit },
    );
    if (!rows.length) return;
    // Preferences cannot change during this synchronous batch. Normalize the
    // exclusion list once, then take a fresh snapshot after the next SQL wait.
    const canIndex = FluxionMemoryPolicy.createPageFilter(domains ?? excludedDomains());
    const blocked = rows.filter(row => !canIndex({ url: row.getResultByName("url") }));
    if (blocked.length) {
      await db.executeTransaction(async () => {
        for (const row of blocked) {
          const rowid = row.getResultByName("id");
          await db.executeCached("DELETE FROM page_vectors WHERE rowid=:rowid", { rowid });
          await db.executeCached("DELETE FROM pages WHERE id=:rowid", { rowid });
        }
      });
    }
    after = rows.at(-1).getResultByName("id");
    if (rows.length < limit) return;
    await new Promise(resolve => setTimeout(resolve, 0));
    if (shutdownStarted) throw new Error("Fluxion Memory policy cleanup interrupted by shutdown");
  }
}

async function connection() {
  if (shutdownStarted) throw new Error("Fluxion Memory database is shutting down");
  if (!connectionPromise) {
    ensureShutdownBlocker();
    shutdownStep = "Opening database";
    connectionPromise = (async () => {
      const db = await Sqlite.openConnection({ path: PathUtils.join(PathUtils.profileDir, FILE_NAME), extensions: ["vec"] });
      try {
        await db.execute("PRAGMA journal_mode = WAL");
        const version = await db.getSchemaVersion();
        if (version > SCHEMA_VERSION) throw new Error("Fluxion Memory database is newer than this build");
        if (version < 1) {
          const engine = generator();
          await db.executeTransaction(async () => {
            await db.execute(`CREATE TABLE pages (
              id INTEGER PRIMARY KEY, url TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
              description TEXT NOT NULL, headings TEXT NOT NULL, content TEXT NOT NULL,
              workspace TEXT NOT NULL, workspace_name TEXT NOT NULL DEFAULT '', tab_group TEXT NOT NULL, last_visit INTEGER NOT NULL,
              visit_count INTEGER NOT NULL DEFAULT 1, indexed_at INTEGER NOT NULL,
              search_title TEXT NOT NULL, search_url TEXT NOT NULL,
              search_description TEXT NOT NULL, search_headings TEXT NOT NULL, search_content TEXT NOT NULL
            )`);
            await db.execute(`CREATE VIRTUAL TABLE page_vectors USING vec0(
              embedding FLOAT[${engine.embeddingSize}] distance_metric=cosine
            )`);
            await db.setSchemaVersion(SCHEMA_VERSION);
          });
        } else {
          const definition = await db.executeCached(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='page_vectors'",
          );
          const storedSize = Number(definition[0]?.getResultByName("sql")
            ?.match(/embedding\s+FLOAT\s*\[\s*(\d+)\s*\]/i)?.[1]);
          if (!Number.isInteger(storedSize) || storedSize < 1) {
            throw new Error("Fluxion Memory vector schema has no valid embedding dimension");
          }
          const engine = generator();
          if (storedSize !== engine.embeddingSize) {
            // Gecko may choose a different regional model after an upgrade.
            // Old vectors cannot be compared in its new dimensional space;
            // retain page evidence and regenerate vectors on subsequent visits.
            await db.executeTransaction(async () => {
              await db.execute("DROP TABLE page_vectors");
              await db.execute(`CREATE VIRTUAL TABLE page_vectors USING vec0(
                embedding FLOAT[${engine.embeddingSize}] distance_metric=cosine
              )`);
            });
          }
        }
        if (recoverOnOpen) {
          // A crash or failed removal may leave evidence whose Places visits
          // are gone. Recover conservatively before exposing any stored data.
          await db.executeTransaction(async () => {
            await db.execute("DELETE FROM page_vectors");
            await db.execute("DELETE FROM pages");
          });
          if (!pendingRemovals) persistRemovalPending(false);
        }
        if (version === 1) {
          shutdownStep = "Migrating normalized search fields";
          await FluxionMemorySearch.migrateV1(db, async () => {
            await new Promise(resolve => setTimeout(resolve, 0));
            if (shutdownStarted) throw new Error("Fluxion Memory migration interrupted by shutdown");
          });
        }
        if (version === 1 || version === 2) await FluxionMemorySearch.migrateV2(db);
        // Re-evaluate policy on every first open, including upgrades. Failure
        // leaves the connection unexposed and is retried on the next launch.
        shutdownStep = "Removing excluded evidence";
        await pruneBlocked(db);
        shutdownStep = "Database open";
        return db;
      } catch (error) {
        shutdownStep = "Closing database after initialization failure";
        try {
          await db.close();
        } catch (closeError) {
          Cu.reportError(closeError);
        }
        shutdownStep = "Database closed after initialization failure";
        throw error;
      }
    })();
  }
  return connectionPromise;
}

async function closeConnection() {
  PlacesObservers.removeListener(HISTORY_EVENTS, onHistoryEvents);
  await historyDeletion.catch(Cu.reportError);
  shutdownStarted = true;
  shutdownPromise ||= (async () => {
    const pending = connectionPromise;
    if (!pending) {
      shutdownStep = "Database was never opened";
      return;
    }
    shutdownStep = "Waiting for database connection";
    let db;
    try {
      db = await pending;
    } catch (_) {
      shutdownStep = "Database initialization already failed";
      connectionPromise = undefined;
      return;
    }
    shutdownStep = "Closing database";
    try {
      await db.close();
      shutdownStep = "Database closed";
    } finally {
      connectionPromise = undefined;
    }
  })();
  return shutdownPromise;
}

function ensureShutdownBlocker() {
  if (shutdownBlockerRegistered) return;
  AsyncShutdown.profileBeforeChange.addBlocker(
    "Fluxion Memory: close enriched history database",
    closeConnection,
    () => ({ step: shutdownStep, connectionOpen: Boolean(connectionPromise) }),
  );
  shutdownBlockerRegistered = true;
}

function generator() {
  if (!embedder) {
    // Firefox 155 moved the production factory off the class; preserve its
    // region/model policy and support the earlier factory during upgrades.
    const factory = GeckoEmbeddings.embeddingsGeneratorFactory || GeckoEmbeddings.EmbeddingsGenerator;
    if (typeof factory?.forPlaces !== "function") {
      throw new Error("This Gecko runtime does not expose its Places embedding factory");
    }
    embedder = factory.forPlaces();
    if (!Number.isInteger(embedder.embeddingSize) || embedder.embeddingSize < 1 ||
        typeof embedder.embed !== "function") {
      embedder = undefined;
      throw new Error("Gecko returned an invalid Places embedding engine");
    }
  }
  return embedder;
}

async function embedAndStore(url, text) {
  const startedAt = revision;
  await historyDeletion;
  const db = await connection();
  if (startedAt !== revision) return;
  const engine = generator();
  const result = await embedText(text, 10000);
  if (startedAt !== revision) return;
  const vector = PlacesUtils.tensorToSQLBindable(vectorFrom(result, engine.embeddingSize));
  const rows = await db.executeCached("SELECT id FROM pages WHERE url=:url", { url });
  if (!rows.length) return;
  const rowid = rows[0].getResultByName("id");
  await db.executeTransaction(async () => {
    if (startedAt !== revision) return;
    await db.executeCached("DELETE FROM page_vectors WHERE rowid=:rowid", { rowid });
    await db.executeCached("INSERT INTO page_vectors(rowid,embedding) VALUES(:rowid,:vector)", { rowid, vector });
  });
}

async function withTimeout(promise, milliseconds) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Fluxion local embedding timed out")), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function embedText(text, timeout) {
  // Gecko does not expose per-request cancellation. Keep at most one model
  // request alive after a timeout, while allowing lexical indexing to continue.
  if (pendingEmbedding) throw new Error("Fluxion local embedding engine is still busy");
  const task = Promise.resolve().then(() => generator().embed(text));
  pendingEmbedding = task;
  const release = () => { if (pendingEmbedding === task) pendingEmbedding = undefined; };
  task.then(release, release);
  return withTimeout(task, timeout);
}

export const FluxionMemoryStore = Object.freeze({
  get revision() { return revision; },

  async upsert(page, expectedRevision = revision) {
    await historyDeletion;
    const db = await connection();
    if (expectedRevision !== revision) return false;
    if (!FluxionMemoryPolicy.canIndexPage(page, excludedDomains())) return false;
    const parameters = {
      url: page.url,
      title: page.title,
      description: page.description,
      headings: page.headings,
      content: page.text,
      workspace: page.workspace,
      savedWorkspaceName: String(page.savedWorkspaceName || "").slice(0, 120),
      tabGroup: page.tabGroup,
      lastVisit: page.lastVisit,
      indexedAt: page.indexedAt,
      ...FluxionMemorySearch.foldedFields({ ...page, content: page.text }),
    };
    await db.executeCached(`INSERT INTO pages
        (url,title,description,headings,content,workspace,workspace_name,tab_group,last_visit,indexed_at,
         search_title,search_url,search_description,search_headings,search_content)
        VALUES (:url,:title,:description,:headings,:content,:workspace,:savedWorkspaceName,:tabGroup,:lastVisit,:indexedAt,
         :search_title,:search_url,:search_description,:search_headings,:search_content)
        ON CONFLICT(url) DO UPDATE SET title=excluded.title, description=excluded.description,
        headings=excluded.headings, content=excluded.content, workspace=excluded.workspace, workspace_name=excluded.workspace_name,
        tab_group=excluded.tab_group, last_visit=excluded.last_visit,
        visit_count=pages.visit_count+1, indexed_at=excluded.indexed_at,
        search_title=excluded.search_title, search_url=excluded.search_url,
        search_description=excluded.search_description, search_headings=excluded.search_headings,
        search_content=excluded.search_content`, parameters);
    return expectedRevision === revision;
  },

  async embed(url, text) {
    await embedAndStore(url, text);
  },

  async search(query, limit = 12, includeSemantic = true, { onLexical } = {}) {
    const normalizedQuery = FluxionMemorySearch.fold(query);
    const terms = [...new Set(normalizedQuery.split(/\s+/).filter(Boolean))].slice(0, 16);
    if (!terms.length) return { lexical: [], semantic: [] };
    const startedAt = revision;
    await historyDeletion;
    const db = await connection();
    const escapeLike = text => `%${text.replace(/[\\%_]/g, value => `\\${value}`)}%`;
    const parameters = { exact: normalizedQuery, pattern: escapeLike(normalizedQuery), limit };
    const fields = FluxionMemorySearch.fields.map(field => `search_${field}`);
    const matches = terms.map((term, index) => {
      parameters[`term${index}`] = escapeLike(term);
      return `(${fields.map(field => `${field} LIKE :term${index} ESCAPE '\\'`).join(" OR ")})`;
    });
    const lexical = await db.executeCached(`SELECT *, 0.0 AS distance FROM pages
      WHERE ${matches.join(" AND ")}
      ORDER BY CASE
        WHEN search_title = :exact OR search_url = :exact THEN 0
        WHEN search_title LIKE :pattern ESCAPE '\\' OR search_url LIKE :pattern ESCAPE '\\' THEN 1
        WHEN search_headings LIKE :pattern ESCAPE '\\' OR search_description LIKE :pattern ESCAPE '\\' THEN 2
        WHEN search_content LIKE :pattern ESCAPE '\\' THEN 3 ELSE 4 END,
        last_visit DESC, url ASC LIMIT :limit`, parameters);
    const aliases = { tab_group: "group", workspace_name: "savedWorkspaceName", indexed_at: "indexedAt", last_visit: "lastVisit", visit_count: "visitCount" };
    const row = item => Object.fromEntries(["url","title","description","headings","content","workspace","workspace_name","tab_group","indexed_at","last_visit","visit_count","distance"].map(name => [aliases[name] || name, item.getResultByName(name)]));
    if (startedAt === revision && typeof onLexical === "function") {
      try { onLexical(lexical.map(row)); } catch (error) { Cu.reportError(error); }
    }
    let semantic = [];
    try {
      const counts = await db.execute("SELECT count(*) AS count FROM page_vectors");
      if (includeSemantic && counts[0].getResultByName("count") > 0) {
        const engine = generator();
        const result = await embedText(query, 1500);
        const vector = PlacesUtils.tensorToSQLBindable(vectorFrom(result, engine.embeddingSize));
        semantic = await db.executeCached(`SELECT pages.*, matches.distance FROM
          (SELECT rowid,distance FROM page_vectors WHERE embedding MATCH :vector AND k=:limit) matches
          JOIN pages ON pages.id=matches.rowid WHERE matches.distance < 0.72`, { vector, limit });
      }
    } catch (error) {
      Cu.reportError(error);
    }
    return startedAt === revision
      ? { lexical: lexical.map(row), semantic: semantic.map(row) }
      : { lexical: [], semantic: [] };
  },

  async get(url) {
    const startedAt = revision;
    await historyDeletion;
    const db = await connection();
    const rows = await db.executeCached(
      "SELECT url,title,description,headings,content FROM pages WHERE url=:url",
      { url },
    );
    if (startedAt !== revision || !rows.length) return null;
    return Object.fromEntries(["url", "title", "description", "headings", "content"]
      .map(name => [name, rows[0].getResultByName(name)]));
  },

  async deleteBlocked(domains) {
    await removeEvidence(db => pruneBlocked(db, domains));
  },

  async pruneExisting() {
    // Opting out must not strand old sensitive evidence, but a never-enabled
    // profile must not acquire a database just to perform an empty cleanup.
    if (!connectionPromise && !await IOUtils.exists(PathUtils.join(PathUtils.profileDir, FILE_NAME))) return;
    await this.deleteBlocked(excludedDomains());
  },

  async deleteURLs(urls) {
    await removeEvidence(async db => {
      await db.executeTransaction(async () => {
        for (const url of new Set(urls)) {
          await db.executeCached(
            "DELETE FROM page_vectors WHERE rowid IN (SELECT id FROM pages WHERE url=:url)", { url });
          await db.executeCached("DELETE FROM pages WHERE url=:url", { url });
        }
      });
    });
  },

  async clearVectors() {
    await removeEvidence(db => db.executeTransaction(() => db.execute("DELETE FROM page_vectors")));
  },

  async vectorCount() {
    await historyDeletion;
    const db = await connection();
    const rows = await db.execute("SELECT count(*) AS count FROM page_vectors");
    return Number(rows[0]?.getResultByName("count") || 0);
  },

  async clear() {
    await removeEvidence(async db => {
      await db.executeTransaction(async () => { await db.execute("DELETE FROM page_vectors"); await db.execute("DELETE FROM pages"); });
    }, true);
  },

  async shutdown() {
    await closeConnection();
  },
});

function onHistoryEvents(events) {
  if (shutdownStarted) return;
  const removed = events.filter(event => event.type === "page-removed");
  const clearAll = events.some(event => event.type === "history-cleared") ||
    removed.some(event => !event.url);
  if (!clearAll && !removed.length) return;
  // A Memory record combines visits, so even removing only some visits erases
  // that URL's evidence. Bookmarked pages must not retain deleted history text.
  const deletion = clearAll ? FluxionMemoryStore.clear()
    : FluxionMemoryStore.deleteURLs(removed.map(event => event.url));
  // Failed removal must keep reads unavailable until a successful full clear.
  deletion.catch(() => {});
}

PlacesObservers.addListener(HISTORY_EVENTS, onHistoryEvents);
