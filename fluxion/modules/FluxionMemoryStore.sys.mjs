import { Sqlite } from "resource://gre/modules/Sqlite.sys.mjs";
import { PlacesUtils } from "resource://gre/modules/PlacesUtils.sys.mjs";
import { EmbeddingsGenerator } from "chrome://global/content/ml/EmbeddingsGenerator.sys.mjs";
import { setTimeout } from "resource://gre/modules/Timer.sys.mjs";

const FILE_NAME = "fluxion_memory.sqlite";
const SCHEMA_VERSION = 1;
let connectionPromise;
let embedder;

function vectorFrom(result, expectedSize) {
  let value = result?.output ?? result;
  if (Array.isArray(value) && value.length === 1 && (Array.isArray(value[0]) || ArrayBuffer.isView(value[0]))) value = value[0];
  if (!Array.isArray(value) && !ArrayBuffer.isView(value)) throw new Error("Fluxion embedding returned no vector");
  if (value.length !== expectedSize) throw new Error(`Fluxion embedding dimension ${value.length} did not match ${expectedSize}`);
  return value;
}

async function connection() {
  if (!connectionPromise) connectionPromise = (async () => {
    const db = await Sqlite.openConnection({ path: PathUtils.join(PathUtils.profileDir, FILE_NAME), extensions: ["vec"] });
    await db.execute("PRAGMA journal_mode = WAL");
    const version = await db.getSchemaVersion();
    if (version > SCHEMA_VERSION) throw new Error("Fluxion Memory database is newer than this build");
    if (version < 1) {
      const generator = EmbeddingsGenerator.forPlaces();
      await db.executeTransaction(async () => {
        await db.execute(`CREATE TABLE pages (
          id INTEGER PRIMARY KEY, url TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
          description TEXT NOT NULL, headings TEXT NOT NULL, content TEXT NOT NULL,
          workspace TEXT NOT NULL, tab_group TEXT NOT NULL, last_visit INTEGER NOT NULL,
          visit_count INTEGER NOT NULL DEFAULT 1, indexed_at INTEGER NOT NULL
        )`);
        await db.execute(`CREATE VIRTUAL TABLE page_vectors USING vec0(
          embedding FLOAT[${generator.embeddingSize}] distance_metric=cosine
        )`);
        await db.setSchemaVersion(SCHEMA_VERSION);
      });
    }
    return db;
  })();
  return connectionPromise;
}

function generator() {
  embedder ||= EmbeddingsGenerator.forPlaces();
  return embedder;
}

async function embedAndStore(url, text) {
  const db = await connection();
  const engine = generator();
  const result = await engine.embed(text);
  const vector = PlacesUtils.tensorToSQLBindable(vectorFrom(result, engine.embeddingSize));
  const rows = await db.executeCached("SELECT id FROM pages WHERE url=:url", { url });
  if (!rows.length) return;
  const rowid = rows[0].getResultByName("id");
  await db.executeTransaction(async () => {
    await db.executeCached("DELETE FROM page_vectors WHERE rowid=:rowid", { rowid });
    await db.executeCached("INSERT INTO page_vectors(rowid,embedding) VALUES(:rowid,:vector)", { rowid, vector });
  });
}

function withTimeout(promise, milliseconds) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("Fluxion local embedding timed out")), milliseconds)),
  ]);
}

export const FluxionMemoryStore = Object.freeze({
  async upsert(page) {
    const db = await connection();
    const parameters = {
      url: page.url,
      title: page.title,
      description: page.description,
      headings: page.headings,
      content: page.text,
      workspace: page.workspace,
      tabGroup: page.tabGroup,
      lastVisit: page.lastVisit,
      indexedAt: page.indexedAt,
    };
    await db.executeCached(`INSERT INTO pages
        (url,title,description,headings,content,workspace,tab_group,last_visit,indexed_at)
        VALUES (:url,:title,:description,:headings,:content,:workspace,:tabGroup,:lastVisit,:indexedAt)
        ON CONFLICT(url) DO UPDATE SET title=excluded.title, description=excluded.description,
        headings=excluded.headings, content=excluded.content, workspace=excluded.workspace,
        tab_group=excluded.tab_group, last_visit=excluded.last_visit,
        visit_count=pages.visit_count+1, indexed_at=excluded.indexed_at`, parameters);
  },

  async embed(url, text) {
    await embedAndStore(url, text);
  },

  async search(query, limit = 12, includeSemantic = true) {
    const db = await connection();
    const pattern = `%${query.replace(/[\\%_]/g, value => `\\${value}`)}%`;
    const lexical = await db.executeCached(`SELECT *, 0.0 AS distance FROM pages
      WHERE title LIKE :pattern ESCAPE '\\' OR headings LIKE :pattern ESCAPE '\\'
      OR content LIKE :pattern ESCAPE '\\' ORDER BY last_visit DESC LIMIT :limit`, { pattern, limit });
    let semantic = [];
    try {
      const counts = await db.execute("SELECT count(*) AS count FROM page_vectors");
      if (includeSemantic && counts[0].getResultByName("count") > 0) {
        const engine = generator();
        const result = await withTimeout(engine.embed(query), 1500);
        const vector = PlacesUtils.tensorToSQLBindable(vectorFrom(result, engine.embeddingSize));
        semantic = await db.executeCached(`SELECT pages.*, matches.distance FROM
          (SELECT rowid,distance FROM page_vectors WHERE embedding MATCH :vector AND k=:limit) matches
          JOIN pages ON pages.id=matches.rowid WHERE matches.distance < 0.72`, { vector, limit });
      }
    } catch (error) {
      Cu.reportError(error);
    }
    const row = item => Object.fromEntries(["url","title","description","headings","content","workspace","tab_group","last_visit","visit_count","distance"].map(name => [name === "tab_group" ? "group" : name === "last_visit" ? "lastVisit" : name === "visit_count" ? "visitCount" : name, item.getResultByName(name)]));
    return { lexical: lexical.map(row), semantic: semantic.map(row) };
  },

  async get(url) {
    const db = await connection();
    const rows = await db.executeCached(
      "SELECT url,title,description,headings,content FROM pages WHERE url=:url",
      { url },
    );
    if (!rows.length) return null;
    return Object.fromEntries(["url", "title", "description", "headings", "content"]
      .map(name => [name, rows[0].getResultByName(name)]));
  },

  async deleteBlocked(domains) {
    const db = await connection();
    const rows = await db.execute("SELECT id,url FROM pages");
    const blocked = rows.filter(item => domains.some(domain => {
      try { const host = new URL(item.getResultByName("url")).hostname; return host === domain || host.endsWith(`.${domain}`); } catch (_) { return true; }
    }));
    await db.executeTransaction(async () => {
      for (const item of blocked) {
        const rowid = item.getResultByName("id");
        await db.executeCached("DELETE FROM page_vectors WHERE rowid=:rowid", { rowid });
        await db.executeCached("DELETE FROM pages WHERE id=:rowid", { rowid });
      }
    });
  },

  async clear() {
    const db = await connection();
    await db.executeTransaction(async () => { await db.execute("DELETE FROM page_vectors"); await db.execute("DELETE FROM pages"); });
  },
});
