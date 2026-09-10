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
  const state = { vectors: 2, mapping: 2, enriched: 2, failDelete: false, beforeWrite: null, beforeInit: null, writes: 0 };
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
      return [];
    },
    async executeTransaction(callback) { return callback(); },
  };
  const native = {
    enoughEntries: true,
    async getConnection() {
      if (state.beforeInit) await state.beforeInit;
      operations.push("manager initialized");
      return prefs.get("browser.ml.enable") && prefs.get("places.semanticHistory.featureGate") ? db : null;
    },
    semanticDB: { async getConnection() { operations.push("storage opened"); return db; } },
    async updateVectorDB() {
      state.writes++;
      if (state.beforeWrite) await state.beforeWrite;
      state.vectors++; state.mapping++;
      operations.push("background write");
    },
    onPagesRankChanged() {},
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
  };
  function chromeWindow() {
    const window = { navigator: {}, ...timerTools,
      addEventListener() {}, removeEventListener() {}, dispatchEvent() {}, CustomEvent: class {},
      gBrowser: { tabs: [], addTabsProgressListener() {}, removeTabsProgressListener() {} },
    };
    const ctx = vm.createContext({ window, Services, URL, Cc: {}, Ci: {},
      Cu: { reportError: error => errors.push(error) },
      ChromeUtils: { importESModule: () => ({ FluxionNativeMemory: adapter, FluxionMemoryStore,
        PlacesUtils: {}, PrivateBrowsingUtils: { isWindowPrivate: () => false } }) },
    });
    for (const file of ["core/settings.js", "core/index-scheduler.js", "core/memory-policy.js",
      "core/memory-content.js", "core/memory-ranking.js", "core/memory-grounding.js", "fluxion-memory.js"]) {
      vm.runInContext(fs.readFileSync(path.join(__dirname, "../chrome", file), "utf8"), ctx, { filename: file });
    }
    return window.FluxionMemory;
  }
  return { adapter, native, state, prefs, operations, errors, chromeWindow,
    factoryCalls: () => factoryCalls,
    expireTimers() { const pending = [...timers.values()]; timers.clear(); pending.forEach(callback => callback()); },
  };
}

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
