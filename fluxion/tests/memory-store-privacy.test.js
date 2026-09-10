"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function fixture(persistedPrefs = new Map()) {
  const embedding = deferred();
  const embeddingStarted = deferred();
  const writes = [];
  const operations = [];
  const errors = [];
  let historyObserver;
  const db = {
    async getSchemaVersion() { return 1; },
    async execute(sql) {
      writes.push(sql);
      return [];
    },
    async executeCached(sql, parameters) {
      writes.push(sql);
      operations.push({ sql, parameters });
      if (sql.startsWith("SELECT id")) return [{ getResultByName: () => 1 }];
      return [];
    },
    async executeTransaction(callback) { await callback(); },
    async close() {},
  };
  const context = vm.createContext({
    Sqlite: { openConnection: async () => db },
    AsyncShutdown: { profileBeforeChange: { addBlocker() {} } },
    PathUtils: { profileDir: "/profile", join: (...parts) => parts.join("/") },
    PlacesUtils: { tensorToSQLBindable: vector => vector },
    EmbeddingsGenerator: { forPlaces: () => ({
      embeddingSize: 2,
      embed() { embeddingStarted.resolve(); return embedding.promise; },
    }) },
    Cu: { reportError: error => errors.push(error) },
    setTimeout,
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
    notifyHistory: events => historyObserver(events) };
}

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

test("a page extracted before a privacy change cannot be inserted afterwards", async () => {
  const { store, writes } = fixture();
  const extractionRevision = store.revision;
  await store.clear();
  assert.equal(await store.upsert({ url: "https://example.com/" }, extractionRevision), false);
  assert.equal(writes.some(sql => sql.startsWith("INSERT INTO pages")), false);
  assert.equal(await store.upsert({ url: "https://example.com/new" }, store.revision), true);
  assert.equal(writes.filter(sql => sql.startsWith("INSERT INTO pages")).length, 1);
});

test("failed removal remains quarantined across restart until startup recovery deletes evidence", async () => {
  const persistedPrefs = new Map();
  const first = fixture(persistedPrefs);
  first.db.executeCached = async () => { throw new Error("disk error"); };
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
  db.executeCached = async () => { throw new Error("disk error"); };
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
  db.executeCached = async sql => {
    if (!sql.startsWith("SELECT *,")) return [];
    reading.resolve();
    return read.promise;
  };
  const pending = store.search("private evidence", 12, false);
  await reading.promise;
  await store.clear();
  read.resolve([{ getResultByName: key => key === "url" ? "https://example.com/" : "private evidence" }]);
  const results = await pending;
  assert.equal(results.lexical.length, 0);
  assert.equal(results.semantic.length, 0);
});
