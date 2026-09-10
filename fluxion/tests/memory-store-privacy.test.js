"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const FluxionMemorySearch = require("../chrome/core/memory-search.js");

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function fixture(persistedPrefs = new Map(), factoryStyle = "legacy", storedDimension = 2) {
  const embedding = deferred();
  const embeddingStarted = deferred();
  const writes = [];
  const operations = [];
  const errors = [];
  const timers = new Map();
  let timerID = 0;
  let embeddingCalls = 0;
  let historyObserver;
  const db = {
    async getSchemaVersion() { return 3; },
    async setSchemaVersion(version) { writes.push(`SCHEMA ${version}`); },
    async execute(sql) {
      writes.push(sql);
      return [];
    },
    async executeCached(sql, parameters) {
      writes.push(sql);
      operations.push({ sql, parameters });
      if (sql.startsWith("SELECT sql FROM sqlite_master")) {
        return [{ getResultByName: () => `CREATE VIRTUAL TABLE page_vectors USING vec0(embedding FLOAT[${storedDimension}] distance_metric=cosine)` }];
      }
      if (sql.startsWith("SELECT id,")) return [];
      if (sql.startsWith("SELECT id")) return [{ getResultByName: () => 1 }];
      return [];
    },
    async executeTransaction(callback) { await callback(); },
    async close() {},
  };
  const createEngine = () => ({
    embeddingSize: 2,
    embed() { embeddingCalls += 1; embeddingStarted.resolve(); return embedding.promise; },
  });
  const context = vm.createContext({
    Sqlite: { openConnection: async () => db },
    AsyncShutdown: { profileBeforeChange: { addBlocker() {} } },
    PathUtils: { profileDir: "/profile", join: (...parts) => parts.join("/") },
    PlacesUtils: { tensorToSQLBindable: vector => vector },
    GeckoEmbeddings: factoryStyle === "current"
      ? { embeddingsGeneratorFactory: { forPlaces: createEngine }, EmbeddingsGenerator: {} }
      : { EmbeddingsGenerator: { forPlaces: createEngine } },
    Cu: { reportError: error => errors.push(error) },
    URL,
    FluxionMemorySearch,
    setTimeout(callback) { timers.set(++timerID, callback); return timerID; },
    clearTimeout(id) { timers.delete(id); },
    Services: { prefs: {
      getBoolPref: (key, fallback) => persistedPrefs.get(key) ?? fallback,
      setBoolPref: (key, value) => persistedPrefs.set(key, value),
      savePrefFile() {},
    } },
    PlacesObservers: {
      addListener(types, callback) { historyObserver = callback; },
      removeListener() {},
    },
  });
  const source = fs.readFileSync(path.join(__dirname, "../modules/FluxionMemoryStore.sys.mjs"), "utf8")
    .replace(/^import .*;\n/gm, "")
    .replace("export const FluxionMemoryStore", "globalThis.FluxionMemoryStore");
  vm.runInContext(source, context);
  return { store: context.FluxionMemoryStore, embedding, embeddingStarted, writes, db, operations, errors,
    embeddingCalls: () => embeddingCalls,
    expireEmbeddingWait: () => { for (const callback of timers.values()) callback(); },
    notifyHistory: events => historyObserver(events) };
}

async function lexicalURLs(query, pages, limit = 12) {
  const { store, operations } = fixture();
  await store.search(query, limit, false);
  const statement = operations.find(operation => operation.sql.startsWith("SELECT *,"));
  // Execute the production SQL with SQLite itself, not a LIKE reimplementation.
  const result = spawnSync("python3", ["-c", `
import json, sqlite3, sys
data = json.load(sys.stdin)
db = sqlite3.connect(':memory:')
db.row_factory = sqlite3.Row
db.execute('CREATE TABLE pages (url TEXT, title TEXT, description TEXT, headings TEXT, content TEXT, last_visit INTEGER, search_title TEXT, search_url TEXT, search_description TEXT, search_headings TEXT, search_content TEXT)')
for page in data['pages']:
    db.execute('INSERT INTO pages VALUES (?,?,?,?,?,?,?,?,?,?,?)', [page.get(key, 0 if key == 'last_visit' else '') for key in ['url','title','description','headings','content','last_visit','search_title','search_url','search_description','search_headings','search_content']])
rows = db.execute(data['statement']['sql'], data['statement']['parameters'])
print(json.dumps([row['url'] for row in rows]))
`], { input: JSON.stringify({ statement, pages: pages.map(page => ({ ...page, ...FluxionMemorySearch.foldedFields(page) })) }), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("lexical retrieval finds terms distributed across URL, description, title, headings, and content", async () => {
  assert.deepEqual(await lexicalURLs("godot websocket authentication", [
    { url: "https://docs.example.com/godot", title: "Networking", description: "Websocket setup", content: "Authentication examples" },
    { url: "https://unrelated.example/", title: "Godot networking", content: "Websocket basics" },
  ]), ["https://docs.example.com/godot"]);
  assert.deepEqual(await lexicalURLs("timer godot", [
    { url: "https://docs.example.com/", title: "Godot guides", headings: "Using the timer node" },
  ]), ["https://docs.example.com/"]);
});

test("exact phrases remain ahead of newer distributed-term candidates before the result limit", async () => {
  assert.deepEqual(await lexicalURLs("godot timer", [
    { url: "https://exact.example/", title: "Godot timer reference", last_visit: 1 },
    { url: "https://recent.example/", title: "Godot", description: "Timer guide", last_visit: 999 },
  ], 1), ["https://exact.example/"]);
});

test("lexical query wildcard characters remain literal", async () => {
  assert.deepEqual(await lexicalURLs("50% a_b", [
    { url: "https://exact.example/", title: "50%", description: "a_b" },
    { url: "https://wrong.example/", title: "500", description: "axb" },
  ]), ["https://exact.example/"]);
});

test("old exact titles and URLs survive a full candidate page of newer phrase matches", async () => {
  const partials = Array.from({ length: 30 }, (_, index) => ({
    url: `https://partial.example/${index}`, title: `Discussion of godot timer tips ${index}`, last_visit: index + 100,
  }));
  const rows = await lexicalURLs("godot timer", [
    ...partials, { url: "https://exact.example/", title: "Godot Timer", last_visit: 1 },
  ], 18);
  assert.equal(rows.length, 18);
  assert.equal(rows[0], "https://exact.example/");

  const exactURL = "https://docs.example/timer";
  const urls = await lexicalURLs(exactURL, [
    ...Array.from({ length: 30 }, (_, index) => ({ url: `${exactURL}/tips/${index}`, last_visit: index + 100 })),
    { url: exactURL, title: "Original reference", last_visit: 1 },
  ], 18);
  assert.equal(urls[0], exactURL);
});

test("candidate ties are deterministic and exact tier treats wildcard characters literally", async () => {
  const pages = [
    { url: "https://b.example/", title: "50% a_b", last_visit: 10 },
    { url: "https://a.example/", title: "50% a_b", last_visit: 10 },
    { url: "https://prefix.example/", title: "50% a_b examples", last_visit: 100 },
    { url: "https://wrong.example/", title: "500 axb", last_visit: 1000 },
  ];
  assert.deepEqual(await lexicalURLs("50% a_b", pages, 2), ["https://a.example/", "https://b.example/"]);
  assert.deepEqual(await lexicalURLs("50% a_b", pages.toReversed(), 2), ["https://a.example/", "https://b.example/"]);
});

test("Unicode and accent folding retrieve body-only evidence with the same semantics as ranking", async () => {
  for (const [query, content] of [
    ["cafe", "A CAFÉ with mountain views"], ["CAFÉ", "A cafe\u0301 with mountain views"],
    ["МОСКВА", "Прогулка: москва"], ["ΑΘΗΝΑ", "αθηνα"],
    ["office", "An oﬃce guide"], ["timer", "A ＴＩＭＥＲ guide"],
  ]) {
    assert.deepEqual(await lexicalURLs(query, [{ url: "https://body.example/", title: "Saved page", content }]),
      ["https://body.example/"], query);
  }
  assert.deepEqual(await lexicalURLs("cafe МОСКВА", [
    { url: "https://distributed.example/", title: "Café", headings: "москва" },
    { url: "https://irrelevant.example/", title: "Café", headings: "Paris" },
  ]), ["https://distributed.example/"]);
});

test("old normalized-exact title survives newer accent-folded phrase candidates", async () => {
  const rows = await lexicalURLs("CAFE GUIDE", [
    ...Array.from({ length: 30 }, (_, index) => ({ url: `https://partial.example/${index}`, title: `Café guide notes ${index}`, last_visit: 100 + index })),
    { url: "https://exact.example/", title: "Cafe\u0301 Guide", last_visit: 1 },
  ], 18);
  assert.equal(rows[0], "https://exact.example/");
});

test("store recovers pending deletion before migrating v1 and exposes no unmigrated query", async () => {
  const { store, db, writes } = fixture(new Map([["fluxion.memory.pendingRemoval", true]]));
  db.getSchemaVersion = async () => 1;
  await store.search("cafe", 12, false);
  const recovery = writes.indexOf("DELETE FROM pages");
  const migration = writes.findIndex(sql => sql.startsWith("ALTER TABLE pages"));
  const ready = writes.indexOf("SCHEMA 3");
  const query = writes.findIndex(sql => sql.startsWith("SELECT *,"));
  assert.ok(recovery >= 0 && recovery < migration);
  assert.ok(migration < ready && ready < query);
  assert.equal(writes.filter(sql => sql.startsWith("ALTER TABLE pages")).length, 6);
});

test("store rejects reads when v1 migration fails and closes the unready connection", async () => {
  const { store, db, writes } = fixture();
  db.getSchemaVersion = async () => 1;
  const execute = db.execute;
  let closed = false;
  db.close = async () => { closed = true; };
  db.execute = async sql => {
    if (sql.startsWith("ALTER TABLE pages")) throw new Error("migration disk failure");
    return execute(sql);
  };
  await assert.rejects(store.search("cafe", 12, false), /migration disk failure/);
  assert.equal(closed, true);
  assert.equal(writes.some(sql => sql.startsWith("SELECT *,")), false);
});

test("store upsert writes folded fields alongside unchanged original evidence", async () => {
  const { store, operations } = fixture();
  await store.upsert({ url: "https://example.org/Original", title: "Café", description: "Été",
    headings: "МОСКВА", text: "oﬃce ＧＵＩＤＥ", workspace: "dev", tabGroup: "Research", lastVisit: 100, indexedAt: 200 });
  const statement = operations.find(operation => operation.sql.startsWith("INSERT INTO pages"));
  assert.equal(statement.parameters.title, "Café");
  assert.equal(statement.parameters.content, "oﬃce ＧＵＩＤＥ");
  assert.equal(statement.parameters.url, "https://example.org/Original");
  assert.equal(statement.parameters.search_title, "cafe");
  assert.equal(statement.parameters.search_content, "office guide");
  assert.equal(statement.parameters.search_headings, "москва");
  assert.equal(statement.parameters.search_url, "https://example.org/original");
});

test("embedding timeout releases indexing, prevents request buildup, and discards late vectors", async () => {
  const { store, embedding, embeddingStarted, writes, expireEmbeddingWait, embeddingCalls } = fixture();
  const pending = store.embed("https://stalled.example/", "Slow embedding");
  await embeddingStarted.promise;
  expireEmbeddingWait();
  await assert.rejects(pending, /timed out/);
  assert.equal(await store.upsert({ url: "https://next.example/" }), true);
  await assert.rejects(store.embed("https://next.example/", "New page"), /still busy/);
  assert.equal(embeddingCalls(), 1);
  embedding.resolve([0.1, 0.9]);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(writes.some(sql => sql.startsWith("INSERT INTO page_vectors")), false);
});

for (const operation of ["clear", "clearVectors", "deleteBlocked", "deleteURLs"]) {
  test(`${operation} prevents an in-flight embedding from restoring deleted vectors`, async () => {
    const { store, embedding, embeddingStarted, writes } = fixture();
    const pending = store.embed("https://example.com/article", "Private page evidence");
    await embeddingStarted.promise;
    await store[operation](["example.com"]);
    embedding.resolve([0.1, 0.9]);
    await pending;
    assert.equal(writes.some(sql => sql.startsWith("INSERT INTO page_vectors")), false);
  });
}

test("domain removal erases dotted DNS aliases and their vectors without deleting suffix lookalikes", async () => {
  const { store, db, operations } = fixture();
  const urls = ["https://example.com/article", "https://example.com./article",
    "https://docs.example.com./guide", "https://notexample.com./article",
    "https://example.com.evil.invalid./article"];
  const execute = db.execute;
  db.execute = async sql => sql === "SELECT id,url FROM pages"
    ? urls.map((url, index) => ({ getResultByName: name => name === "url" ? url : index + 1 }))
    : execute(sql);
  await store.deleteBlocked(["example.com"]);
  for (const table of ["pages", "page_vectors"]) {
    assert.deepEqual(operations.filter(item => item.sql.startsWith(`DELETE FROM ${table} WHERE`))
      .map(item => item.parameters.rowid), [1, 2, 3]);
  }
});

test("a page extracted before a privacy change cannot be inserted afterwards", async () => {
  const { store, writes } = fixture();
  const extractionRevision = store.revision;
  await store.clear();
  assert.equal(await store.upsert({ url: "https://example.com/" }, extractionRevision), false);
  assert.equal(writes.some(sql => sql.startsWith("INSERT INTO pages")), false);
  assert.equal(await store.upsert({ url: "https://example.com/new" }, store.revision), true);
  assert.equal(writes.filter(sql => sql.startsWith("INSERT INTO pages")).length, 1);
});

test("current Gecko singleton factory routes its generated vector into storage", async () => {
  const { store, embeddingStarted, embedding, operations } = fixture(new Map(), "current");
  const pending = store.embed("https://example.com/", "Remember this page");
  await embeddingStarted.promise;
  embedding.resolve([0.25, 0.75]);
  await pending;
  const insertion = operations.find(operation => operation.sql.startsWith("INSERT INTO page_vectors"));
  assert.ok(insertion);
  assert.deepEqual(Array.from(insertion.parameters.vector), [0.25, 0.75]);
});

test("Gecko dimension changes rebuild only vectors and retain lexical page evidence", async () => {
  const { store, writes } = fixture(new Map(), "current", 512);
  await store.get("https://example.com/");
  assert.ok(writes.includes("DROP TABLE page_vectors"));
  assert.ok(writes.some(sql => sql.includes("embedding FLOAT[2]")));
  assert.equal(writes.some(sql => /(?:DROP TABLE|DELETE FROM) pages/.test(sql)), false);
});

test("unchanged Gecko dimension preserves existing vectors", async () => {
  const { store, writes } = fixture(new Map(), "current");
  await store.get("https://example.com/");
  assert.equal(writes.some(sql => sql.startsWith("DROP TABLE")), false);
});

test("failed removal remains quarantined across restart until startup recovery deletes evidence", async () => {
  const persistedPrefs = new Map();
  const first = fixture(persistedPrefs);
  const execute = first.db.executeCached;
  first.db.executeCached = async sql => {
    if (sql.startsWith("DELETE")) throw new Error("disk error");
    return execute(sql);
  };
  await assert.rejects(first.store.deleteURLs(["https://example.com/"]), /disk error/);
  assert.equal(persistedPrefs.get("fluxion.memory.pendingRemoval"), true);
  const restarted = fixture(persistedPrefs);
  await restarted.store.get("https://example.com/");
  const read = restarted.writes.findIndex(sql => sql.startsWith("SELECT url,"));
  assert.ok(restarted.writes.indexOf("DELETE FROM pages") < read);
  assert.ok(restarted.writes.indexOf("DELETE FROM page_vectors") < read);
  assert.equal(persistedPrefs.get("fluxion.memory.pendingRemoval"), false);
});

test("later targeted deletion cannot clear quarantine from an earlier failure", async () => {
  const persistedPrefs = new Map();
  const { store, db } = fixture(persistedPrefs);
  const execute = db.executeCached;
  db.executeCached = async sql => {
    if (sql.startsWith("DELETE")) throw new Error("disk error");
    return execute(sql);
  };
  await assert.rejects(store.deleteURLs(["https://example.com/"]), /disk error/);
  db.executeCached = execute;
  await assert.rejects(store.deleteBlocked(["other.example"]), /disk error/);
  assert.equal(persistedPrefs.get("fluxion.memory.pendingRemoval"), true);
  await store.clear();
  assert.equal(persistedPrefs.get("fluxion.memory.pendingRemoval"), false);
});

test("failed startup recovery never reads retained evidence or clears its durable marker", async () => {
  const persistedPrefs = new Map([["fluxion.memory.pendingRemoval", true]]);
  const { store, db, writes } = fixture(persistedPrefs);
  const execute = db.execute;
  db.execute = async sql => {
    if (sql.startsWith("DELETE")) throw new Error("recovery disk error");
    return execute(sql);
  };
  await assert.rejects(store.get("https://example.com/"), /recovery disk error/);
  assert.equal(writes.some(sql => sql.startsWith("SELECT url,")), false);
  assert.equal(persistedPrefs.get("fluxion.memory.pendingRemoval"), true);
});

test("Places visit removal erases that URL's evidence even if a bookmark retains the page", async () => {
  const { store, operations, notifyHistory } = fixture();
  const before = store.revision;
  notifyHistory([{ type: "page-removed", url: "https://example.com/deleted", isRemovedFromStore: false }]);
  assert.ok(store.revision > before);
  await store.get("https://example.com/deleted");
  const deletes = operations.filter(operation => operation.sql.startsWith("DELETE"));
  assert.equal(deletes.length, 2);
  assert.ok(deletes.every(operation => operation.parameters.url === "https://example.com/deleted"));
});

test("Places history clear removes all enriched text and vectors before subsequent reads", async () => {
  const { store, writes, notifyHistory } = fixture();
  notifyHistory([{ type: "history-cleared" }]);
  await store.get("https://example.com/");
  assert.ok(writes.indexOf("DELETE FROM pages") < writes.findIndex(sql => sql.startsWith("SELECT url,")));
  assert.ok(writes.includes("DELETE FROM page_vectors"));
});

test("failed history removal blocks Memory reads until a full clear succeeds", async () => {
  const { store, db, errors, notifyHistory } = fixture();
  const execute = db.executeCached;
  db.executeCached = async sql => {
    if (sql.startsWith("DELETE")) throw new Error("disk error");
    return execute(sql);
  };
  notifyHistory([{ type: "page-removed", url: "https://example.com/" }]);
  await assert.rejects(store.get("https://example.com/"), /disk error/);
  await assert.rejects(store.search("example", 12, false), /disk error/);
  assert.equal(errors.length, 1);
  db.executeCached = execute;
  await store.clear();
  assert.equal(await store.get("https://example.com/"), null);
});

test("search discards a lexical snapshot if Memory is cleared before it returns", async () => {
  const { store, db } = fixture();
  const reading = deferred();
  const read = deferred();
  const execute = db.executeCached;
  db.executeCached = async sql => {
    if (!sql.startsWith("SELECT *,")) return execute(sql);
    reading.resolve();
    return read.promise;
  };
  const partials = [];
  const pending = store.search("private evidence", 12, false, { onLexical: rows => partials.push(rows) });
  await reading.promise;
  await store.clear();
  read.resolve([{ getResultByName: key => key === "url" ? "https://example.com/" : "private evidence" }]);
  const results = await pending;
  assert.equal(results.lexical.length, 0);
  assert.equal(results.semantic.length, 0);
  assert.equal(partials.length, 0, "deleted evidence was emitted through the progressive callback");
});

test("enriched lexical rows are emitted once before the bounded embedding wait", async () => {
  const f = fixture();
  const execute = f.db.execute, cached = f.db.executeCached;
  f.db.execute = sql => sql.startsWith("SELECT count")
    ? Promise.resolve([{ getResultByName: () => 1 }]) : execute(sql);
  let lexicalQueries = 0;
  f.db.executeCached = (sql, params) => {
    if (!sql.startsWith("SELECT *,")) return cached(sql, params);
    lexicalQueries++;
    return Promise.resolve([{ getResultByName: name => name === "url" ? "https://example.com/plant" : "Plant evidence" }]);
  };
  const partials = [];
  let complete = false;
  const result = f.store.search("plant", 12, true, { onLexical: rows => partials.push(rows) })
    .then(value => { complete = true; return value; });
  await f.embeddingStarted.promise;
  assert.equal(complete, false);
  assert.equal(partials.length, 1);
  assert.equal(partials[0][0].url, "https://example.com/plant");
  assert.equal(lexicalQueries, 1);
  f.expireEmbeddingWait();
  const final = await result;
  assert.equal(final.lexical[0].url, "https://example.com/plant");
  assert.equal(final.semantic.length, 0);
  f.embedding.resolve([0.5, 0.5]);
});
