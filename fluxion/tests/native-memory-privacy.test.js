"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const settle = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function fixture(saved = new Map()) {
  const prefs = saved;
  const timers = new Map(), operations = [], errors = [];
  let timerId = 0, factoryCalls = 0;
  const state = { vectors: 2, mapping: 2, enriched: 2, failDelete: false, beforeWrite: null, beforeInit: null, writes: 0,
    exclusionRows: [], cachedWrites: [], qualified: true, failExclusion: false, ownedExclusions: [], beforeCached: null,
    beforeStorage: null, failStorage: false, storageOpens: 0, storageReady: false,
    beforeInference: null, inferenceCalls: 0, searchCalls: 0, beforeEnriched: null,
    nativeResults: [], keywords: [], enrichedResults: { lexical: [], semantic: [] } };
  // Model the relevant native converter contract in a separate ESM-like
  // realm: Array.isArray crosses realms, instanceof Float32Array does not.
  const tensorToSQLBindable = vm.runInNewContext(`value => {
    if (Array.isArray(value)) value = new Float32Array(value);
    if (!(value instanceof Float32Array)) throw new Error("Invalid tensor format");
    return value;
  }`);
  const Services = { env: { get: () => "" }, obs: { addObserver() {}, removeObserver() {} }, prefs: {
    getBoolPref: (key, fallback) => prefs.get(key) ?? fallback,
    getStringPref: (key, fallback) => prefs.get(key) ?? fallback,
    setBoolPref: (key, value) => prefs.set(key, value),
    setStringPref: (key, value) => prefs.set(key, value),
    savePrefFile() {}, addObserver() {}, removeObserver() {},
  } };
  const db = {
    async execute(sql) {
      operations.push(sql);
      if (sql.startsWith("DELETE")) {
        assert.equal(prefs.get("browser.ml.enable"), false, "cleanup reopened the model gate");
        if (state.failDelete) throw new Error("native disk unavailable");
        if (sql.endsWith("vec_history")) state.vectors = 0;
        if (sql.endsWith("vec_history_mapping")) state.mapping = 0;
      }
      if (sql.startsWith("SELECT count")) return [{ getResultByName: () => state.vectors }];
      if (sql.includes("SELECT map.rowid")) return state.exclusionRows.map(row => ({ getResultByName: name => row[name] }));
      return [];
    },
    async executeCached(sql, parameters) {
      if (state.beforeCached) await state.beforeCached;
      if (state.failExclusion) throw new Error("native exclusion disk unavailable");
      state.cachedWrites.push({ sql, parameters });
    },
    async executeTransaction(callback) { return callback(); },
  };
  const native = {
    enoughEntries: true,
    getEmbeddingSize: () => 3,
    async getConnection() {
      if (state.beforeInit) await state.beforeInit;
      operations.push("manager initialized");
      return state.qualified && prefs.get("browser.ml.enable") && prefs.get("places.semanticHistory.featureGate") ? db : null;
    },
    semanticDB: { async getConnection() {
      state.storageOpens++;
      if (state.beforeStorage) await state.beforeStorage;
      if (state.failStorage) throw new Error("native storage open failed");
      state.storageReady = true;
      operations.push("storage opened");
      return db;
    } },
    async updateVectorDB() {
      state.writes++;
      if (state.beforeWrite) await state.beforeWrite;
      state.vectors++; state.mapping++;
      operations.push("background write");
    },
    onPagesRankChanged() {},
    async hasSufficientEntriesForSearching() { return true; },
    async infer() {
      state.inferenceCalls++;
      if (state.beforeInference) await state.beforeInference;
      return { results: state.nativeResults };
    },
  };
  const timerTools = {
    setTimeout(callback) { timers.set(++timerId, callback); return timerId; },
    clearTimeout(id) { timers.delete(id); },
  };
  const context = vm.createContext({ Services, Cu: { reportError: error => errors.push(error) }, ...timerTools,
    ChromeUtils: { importESModule: () => ({ getPlacesSemanticHistoryManager() { factoryCalls++; return native; } }) },
  });
  // Only adapt ES-module linkage for Node20's VM; execute the complete shipped
  // module body, not extracted/reimplemented privacy methods.
  const source = fs.readFileSync(path.join(__dirname, "../modules/FluxionNativeMemory.sys.mjs"), "utf8")
    .replace(/^import .*;\n/gm, "")
    .replace("export const FluxionNativeMemory", "globalThis.FluxionNativeMemory");
  vm.runInContext(source, context, { filename: "FluxionNativeMemory.sys.mjs" });
  const adapter = context.FluxionNativeMemory;
  const FluxionMemoryStore = {
    revision: 0,
    async clearVectors() { state.enriched = 0; },
    async clear() { state.enriched = 0; },
    async vectorCount() { return state.enriched; },
    async deleteBlocked(domains) { state.ownedExclusions.push(Array.from(domains)); },
    async search(query, limit, semantic, { onLexical } = {}) {
      state.searchCalls++;
      onLexical?.(state.enrichedResults.lexical);
      if (state.beforeEnriched) await state.beforeEnriched;
      return state.enrichedResults;
    },
  };
  function chromeWindow({ isPrivate = false } = {}) {
    const window = { navigator: {}, ...timerTools,
      addEventListener() {}, removeEventListener() {}, dispatchEvent() {}, CustomEvent: class {},
      gBrowser: { tabs: [], addTabsProgressListener() {}, removeTabsProgressListener() {} },
      FluxionUI: { workspaces: () => [], tabWorkspace: () => "" },
    };
    const PlacesUtils = { tensorToSQLBindable, history: {
      getNewQuery: () => ({}), getNewQueryOptions: () => ({}), executeQuery: () => ({ root: {
        get childCount() { return state.keywords.length; }, getChild: index => state.keywords[index],
      } }),
    } };
    const ctx = vm.createContext({ window, Services, URL, Cc: {}, Ci: { nsINavHistoryQueryOptions: {} },
      Cu: { reportError: error => errors.push(error) },
      ChromeUtils: { importESModule: () => ({ FluxionNativeMemory: adapter, FluxionMemoryStore,
        PlacesUtils, PrivateBrowsingUtils: { isWindowPrivate: () => isPrivate } }) },
    });
    for (const file of ["core/settings.js", "core/index-scheduler.js", "core/memory-policy.js",
      "core/memory-content.js", "core/memory-ranking.js", "core/memory-grounding.js", "fluxion-memory.js"]) {
      vm.runInContext(fs.readFileSync(path.join(__dirname, "../chrome", file), "utf8"), ctx, { filename: file });
    }
    return window.FluxionMemory;
  }
  return { adapter, native, state, prefs, operations, errors, chromeWindow, tensorToSQLBindable, store: FluxionMemoryStore,
    factoryCalls: () => factoryCalls,
    expireTimers() { const pending = [...timers.values()]; timers.clear(); pending.forEach(callback => callback()); },
  };
}

test("Memory emits immediate grounded keyword and enriched partials while native connection is stalled", async () => {
  const f = fixture();
  const main = f.chromeWindow(); await main.enable(); await settle();
  f.state.keywords = [{ uri: "https://example.test/keyword", title: "Plant guide", time: 1000000, accessCount: 1 }];
  f.state.enrichedResults.lexical = [{ url: "https://example.test/enriched", title: "Plant biology", lastVisit: 1000 }];
  const wait = deferred(); f.state.beforeInit = wait.promise;
  const partials = [];
  const result = main.search("plant", "", { onPartial: partial => partials.push(partial) });
  assert.equal(partials.length, 2);
  assert.equal(partials[0].results[0].url, "https://example.test/keyword");
  assert.ok(partials[1].results.some(row => row.url === "https://example.test/enriched"));
  assert.ok(partials[0].answer);
  assert.equal(f.state.searchCalls, 1, "enriched SQL did not start independently");
  await settle(); f.expireTimers();
  const final = await result;
  assert.equal(final.state, "lexical");
  assert.equal(final.results.length, 2);
  assert.equal(f.state.inferenceCalls, 0);
  wait.resolve(); await settle();
});

test("timed-out native inference retains one shared slot across windows and never publishes late vectors", async () => {
  const f = fixture(); const main = f.chromeWindow(), companion = f.chromeWindow();
  await main.enable(); await settle();
  const wait = deferred(); f.state.beforeInference = wait.promise;
  f.state.nativeResults = [{ url: "https://example.test/late", title: "Plant cell", distance: 0.05 }];
  const first = main.search("photosynthesis"); await settle();
  assert.equal(f.state.inferenceCalls, 1);
  f.expireTimers(); const final = await first;
  assert.equal(final.results.length, 0);
  for (let n = 0; n < 5; n++) await companion.search(`new query ${n}`);
  assert.equal(f.state.inferenceCalls, 1);
  wait.resolve(); await settle();
  assert.equal(final.results.length, 0);
  f.state.beforeInference = null;
  const successful = await main.search("photosynthesis");
  assert.equal(f.state.inferenceCalls, 2);
  assert.equal(successful.state, "ready");
  assert.equal(successful.results[0].url, "https://example.test/late");
});

test("partial and final Memory responses respect private, disabled and deletion revision boundaries", async () => {
  const f = fixture(); const main = f.chromeWindow(), privateWindow = f.chromeWindow({ isPrivate: true });
  const partials = [];
  await privateWindow.search("private", "", { onPartial: value => partials.push(value) });
  await main.search("disabled", "", { onPartial: value => partials.push(value) });
  assert.equal(f.state.searchCalls, 0);
  assert.equal(f.state.inferenceCalls, 0);
  assert.equal(partials.length, 0);
  await main.enable(); await settle();
  const wait = deferred(); f.state.beforeEnriched = wait.promise;
  const pending = main.search("plant", "", { onPartial: value => partials.push(value) });
  const count = partials.length;
  f.store.revision++;
  f.prefs.set("fluxion.memory.enabled", false);
  wait.resolve();
  const result = await pending;
  assert.equal(result.state, "disabled");
  assert.equal(result.results.length, 0);
  assert.equal(partials.length, count);
});

test("full chrome exclusion sentinel crosses the native converter realm and updates only blocked rows", async () => {
  const f = fixture(new Map([["fluxion.memory.excludedDomains", '["excluded.example"]']]));
  assert.throws(() => f.tensorToSQLBindable(new Float32Array([1, 0, 0])), /Invalid tensor format/);
  assert.deepEqual(Array.from(f.tensorToSQLBindable([1, 0, 0])), [1, 0, 0]);
  f.state.exclusionRows = [
    { rowid: 7, url: "https://excluded.example/article" },
    { rowid: 8, url: "https://allowed.example/article" },
  ];
  await f.chromeWindow().enable();
  await settle();
  assert.equal(f.state.cachedWrites.length, 2, "native exclusion sweep did not complete its delete+sentinel write");
  const [remove, insert] = f.state.cachedWrites;
  assert.match(remove.sql, /^DELETE FROM vec_history/);
  assert.equal(remove.parameters.rowid, 7);
  assert.match(insert.sql, /^INSERT INTO vec_history/);
  assert.equal(insert.parameters.rowid, 7);
  assert.deepEqual(Array.from(insert.parameters.vector), [1, 0, 0]);
  assert.deepEqual(f.errors, []);
});

test("exclusions purge native evidence from another window even when hardware gate returns no connection", async () => {
  const f = fixture();
  const main = f.chromeWindow(), companion = f.chromeWindow();
  f.state.qualified = false;
  assert.equal(await main.enable(), "lexical");
  await settle();
  assert.equal(await f.native.getConnection(), null);
  f.state.exclusionRows = [{ rowid: 9, url: "https://excluded.example/article" }];
  await companion.setExcludedDomains(["excluded.example"]);
  assert.equal(f.state.cachedWrites.length, 2);
  assert.equal(f.state.cachedWrites[1].parameters.rowid, 9);
  assert.deepEqual(Array.from(f.state.cachedWrites[1].parameters.vector), [1, 0, 0]);
  assert.equal(f.factoryCalls(), 1);
  assert.deepEqual(f.errors, []);
});

test("private-window exclusion processing never opens native semantic storage", async () => {
  const f = fixture(new Map([["fluxion.memory.enabled", true]]));
  const privateWindow = f.chromeWindow({ isPrivate: true });
  await privateWindow.setExcludedDomains(["excluded.example"]);
  assert.equal(f.factoryCalls(), 0);
  assert.equal(f.operations.length, 0);
});

test("explicit domain exclusion reports native cleanup failure instead of claiming success", async () => {
  const f = fixture();
  const main = f.chromeWindow();
  await main.enable(); await settle();
  f.state.exclusionRows = [{ rowid: 9, url: "https://excluded.example/article" }];
  f.state.failExclusion = true;
  await assert.rejects(main.setExcludedDomains(["excluded.example"]), /native exclusion disk unavailable/);
  assert.deepEqual(f.state.ownedExclusions, [["excluded.example"]]);
  await assert.rejects(main.excludeDomain("another.example"), /native exclusion disk unavailable/);
  assert.deepEqual(f.state.ownedExclusions[1], ["excluded.example", "another.example"]);
  assert.deepEqual(f.errors, [], "explicit cleanup must reject to its caller, not swallow the failure");
});

test("an explicit exclusion edit performs a fresh sweep after an older blocked-row snapshot commits", async () => {
  const f = fixture(new Map([["fluxion.memory.excludedDomains", '["old.example"]']]));
  const main = f.chromeWindow();
  f.state.exclusionRows = [{ rowid: 1, url: "https://old.example/page" }, { rowid: 2, url: "https://new.example/page" }];
  const wait = deferred(); f.state.beforeCached = wait.promise;
  await main.enable(); await settle();
  const edit = main.setExcludedDomains(["old.example", "new.example"]);
  await settle();
  assert.equal(f.state.ownedExclusions.length, 0, "edit completed while the older sweep remained pending");
  f.state.beforeCached = null;
  wait.resolve(); await edit;
  const inserts = f.state.cachedWrites.filter(write => write.sql.startsWith("INSERT"));
  assert.deepEqual(inserts.map(write => write.parameters.rowid), [1, 1, 2]);
  assert.deepEqual(f.state.ownedExclusions, [["old.example", "new.example"]]);
  assert.deepEqual(f.errors, []);
});

test("full Memory chrome clears actual native storage from a window with no local manager", async () => {
  const f = fixture();
  const main = f.chromeWindow(), companion = f.chromeWindow();
  await main.enable();
  assert.equal(f.factoryCalls(), 1);
  assert.equal(f.state.vectors, 2);
  await companion.setEmbeddingProvider("disabled");
  assert.equal(f.state.vectors, 0);
  assert.equal(f.state.mapping, 0);
  assert.equal(f.state.enriched, 0);
  assert.equal(f.prefs.get("browser.ml.enable"), false);
  await main.setEmbeddingProvider("gecko-local");
  assert.equal(f.state.vectors, 0, "enabling resurrected native vectors");
  f.state.vectors = f.state.mapping = f.state.enriched = 3;
  await companion.clearAndDisable();
  assert.equal(f.state.vectors, 0);
  assert.equal(f.state.mapping, 0);
  assert.equal(f.prefs.get("fluxion.memory.enabled"), false);
  await main.enable();
  assert.equal(f.state.vectors, 0);
  assert.equal(f.factoryCalls(), 1);
});

test("native counts read storage even when the feature gate is disabled", async () => {
  const f = fixture();
  const window = f.chromeWindow();
  const counts = await window.embeddingVectorCounts();
  assert.equal(counts.native, 2, "null gated connection was mistaken for empty storage");
  assert.equal(f.prefs.get("browser.ml.enable"), undefined);
});

test("AI-off browser windows do not import or initialize the native semantic manager", () => {
  const f = fixture();
  f.chromeWindow();
  assert.equal(f.factoryCalls(), 0);
  assert.equal(f.operations.length, 0);
});

test("cross-window enable queues behind a complete pending opt-out", async () => {
  const f = fixture();
  const main = f.chromeWindow(), companion = f.chromeWindow();
  await main.enable();
  const wait = deferred(); f.state.beforeWrite = wait.promise;
  const writing = f.native.updateVectorDB(); await settle();
  const optOut = companion.clearAndDisable(); await settle();
  const reenable = main.enable(); await settle();
  assert.equal(f.prefs.get("fluxion.memory.enabled"), false);
  assert.equal(f.prefs.get("browser.ml.enable"), false);
  assert.equal(f.adapter.pending(), true);
  wait.resolve(); await writing; await optOut; await reenable;
  assert.equal(f.state.vectors, 0);
  assert.equal(f.state.mapping, 0);
  assert.equal(f.prefs.get("fluxion.memory.enabled"), true);
  assert.equal(f.prefs.get("browser.ml.enable"), true);
});

test("purge drains exclusion-sweep mutations too and cannot race a late sentinel insert", async () => {
  const f = fixture(new Map([["fluxion.memory.enabled", true]]));
  const wait = deferred();
  const sweep = f.adapter.runMutation(async () => {
    await wait.promise;
    f.state.vectors++;
    f.operations.push("exclusion sentinel inserted");
  });
  await settle();
  const deleting = f.adapter.purge(); await settle();
  assert.equal(f.operations.includes("DELETE FROM vec_history"), false);
  wait.resolve(); await sweep; await deleting;
  assert.equal(f.state.vectors, 0);
  assert.ok(f.operations.indexOf("exclusion sentinel inserted") < f.operations.indexOf("DELETE FROM vec_history"));
});

test("purge drains native embedding writes and rejects new work until deletion finishes", async () => {
  const f = fixture(new Map([["fluxion.memory.enabled", true]]));
  const native = f.adapter.getManager();
  const wait = deferred(); f.state.beforeWrite = wait.promise;
  const write = native.updateVectorDB(); await settle();
  const deleting = f.adapter.purge(); await settle();
  await native.updateVectorDB();
  assert.equal(f.state.writes, 1);
  assert.equal(f.operations.some(sql => sql.startsWith("DELETE")), false);
  wait.resolve(); await write; await deleting;
  assert.equal(f.state.vectors, 0);
  assert.equal(f.state.mapping, 0);
  assert.ok(f.operations.indexOf("background write") < f.operations.indexOf("DELETE FROM vec_history"));
  assert.equal(f.adapter.pending(), false);
});

test("startup lifecycle completes before storage-only cleanup opens the database", async () => {
  const f = fixture();
  const wait = deferred(); f.state.beforeInit = wait.promise;
  const deleting = f.adapter.purge(); await settle();
  assert.equal(f.operations.includes("storage opened"), false);
  wait.resolve(); await deleting;
  assert.ok(f.operations.indexOf("manager initialized") < f.operations.indexOf("storage opened"));
  assert.equal(f.state.vectors, 0);
});

test("concurrent storage consumers share one fully initialized native connection", async () => {
  const f = fixture();
  const wait = deferred(); f.state.beforeStorage = wait.promise;
  let completed = 0;
  const first = f.adapter.storageConnection().then(connection => { completed++; return connection; });
  const second = f.adapter.storageConnection().then(connection => { completed++; return connection; });
  const counts = f.adapter.vectorCount();
  await settle();
  assert.equal(f.state.storageOpens, 1);
  assert.equal(completed, 0);
  assert.equal(f.state.storageReady, false);
  wait.resolve();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a, b);
  assert.equal(f.state.storageReady, true);
  assert.equal(await counts, 2);
  assert.equal(await f.adapter.storageConnection(), a);
  assert.equal(f.state.storageOpens, 1);
});

test("failed shared native storage initialization rejects all callers and permits a clean retry", async () => {
  const f = fixture();
  const wait = deferred(); f.state.beforeStorage = wait.promise; f.state.failStorage = true;
  const first = assert.rejects(f.adapter.storageConnection(), /native storage open failed/);
  const second = assert.rejects(f.adapter.storageConnection(), /native storage open failed/);
  await settle();
  assert.equal(f.state.storageOpens, 1);
  wait.resolve(); await Promise.all([first, second]);
  f.state.failStorage = false;
  f.state.beforeStorage = null;
  await f.adapter.storageConnection();
  assert.equal(f.state.storageOpens, 2);
  assert.equal(f.state.storageReady, true);
});

test("failed native purge quarantines re-enable and recovers before reads after restart", async () => {
  const f = fixture(); const window = f.chromeWindow();
  f.state.failDelete = true;
  await assert.rejects(window.clearAndDisable(), /native disk unavailable/);
  assert.equal(f.prefs.get("fluxion.memory.nativePendingRemoval"), true);
  await assert.rejects(window.enable(), /native disk unavailable/);
  assert.equal(f.prefs.get("fluxion.memory.enabled"), false);
  assert.equal(f.prefs.get("browser.ml.enable"), false);
  const restarted = fixture(f.prefs);
  const nextWindow = restarted.chromeWindow();
  await nextWindow.enable();
  assert.equal(restarted.state.vectors, 0);
  assert.equal(restarted.state.mapping, 0);
  assert.equal(restarted.prefs.get("fluxion.memory.nativePendingRemoval"), false);
  assert.equal(restarted.prefs.get("browser.ml.enable"), true);
});

test("timed-out native drain stays quarantined and retry still waits for the late writer", async () => {
  const f = fixture(new Map([["fluxion.memory.enabled", true]]));
  const native = f.adapter.getManager();
  const wait = deferred(); f.state.beforeWrite = wait.promise;
  const writing = native.updateVectorDB(); await settle();
  const deleting = f.adapter.purge();
  const rejected = assert.rejects(deleting, /waiting for background work/);
  f.expireTimers(); await rejected;
  assert.equal(f.adapter.pending(), true);
  const retry = f.adapter.purge(); await settle();
  assert.equal(f.operations.some(sql => sql.startsWith("DELETE")), false);
  wait.resolve(); await writing; await retry;
  assert.equal(f.state.vectors, 0);
  assert.equal(f.adapter.pending(), false);
});
