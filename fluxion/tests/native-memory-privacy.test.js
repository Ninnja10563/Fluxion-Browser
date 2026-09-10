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
    beforeStorage: null, beforeExclusionQuery: null, failStorage: false, storageOpens: 0, storageReady: false,
    beforeInference: null, inferenceCalls: 0, searchCalls: 0, beforeEnriched: null,
    nativeResults: [], keywords: [], windows: [], upserts: [], pruneCalls: 0, candidateURLs: [], beforeCandidates: null,
    embeddedCandidates: [], boundaryFailure: false, boundaryCalls: 0, enrichedResults: { lexical: [], semantic: [] } };
  // Model the relevant native converter contract in a separate ESM-like
  // realm: Array.isArray crosses realms, instanceof Float32Array does not.
  const tensorToSQLBindable = vm.runInNewContext(`value => {
    if (Array.isArray(value)) value = new Float32Array(value);
    if (!(value instanceof Float32Array)) throw new Error("Invalid tensor format");
    return value;
  }`);
  let uuid = 0;
  const Services = { uuid: { generateUUID: () => `fixture-${++uuid}` }, env: { get: () => "" }, obs: { addObserver() {}, removeObserver() {} }, prefs: {
    getPrefType: key => !prefs.has(key) ? 0 : typeof prefs.get(key) === "string" ? 32 : 128,
    getBoolPref: (key, fallback) => prefs.get(key) ?? fallback,
    getStringPref: (key, fallback) => prefs.get(key) ?? fallback,
    setBoolPref: (key, value) => prefs.set(key, value),
    setStringPref: (key, value) => prefs.set(key, value),
    clearUserPref: key => prefs.delete(key),
    savePrefFile() {}, addObserver() {}, removeObserver() {},
  } };
  const db = {
    async execute(sql) {
      operations.push(sql);
      if (sql.includes("SELECT url_hash, url FROM places.moz_places")) {
        if (state.beforeCandidates) await state.beforeCandidates;
        return state.candidateURLs.map(value => ({ getResultByName: key => value[key] }));
      }
      if (sql.startsWith("DELETE")) {
        assert.equal(prefs.get("browser.ml.enable"), false, "cleanup reopened the model gate");
        if (state.failDelete) throw new Error("native disk unavailable");
        if (sql.endsWith("vec_history")) state.vectors = 0;
        if (sql.endsWith("vec_history_mapping")) state.mapping = 0;
      }
      if (sql.startsWith("SELECT count")) return [{ getResultByName: () => state.vectors }];
      if (sql.includes("SELECT map.rowid")) {
        if (state.beforeExclusionQuery) await state.beforeExclusionQuery;
        return state.exclusionRows.map(row => ({ getResultByName: name => row[name] }));
      }
      return [];
    },
    async executeCached(sql, parameters) {
      if (state.beforeCached) await state.beforeCached;
      if (state.failExclusion) throw new Error("native exclusion disk unavailable");
      state.cachedWrites.push({ sql, parameters });
      return [{ getResultByName: () => 77 }];
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
    async updateVectorDB(connection, additions = []) {
      state.embeddedCandidates.push(...additions);
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
    FluxionMemoryPolicy: require("../chrome/core/memory-policy.js"),
    ChromeUtils: { importESModule: uri => uri.includes("PlacesUtils") ? { PlacesUtils: { tensorToSQLBindable } } :
      uri.includes("FluxionUrlbarMemory") ? { FluxionUrlbarMemory: { ensurePolicyBoundary() {
        state.boundaryCalls++;
        if (state.boundaryFailure) throw new Error("native provider boundary unavailable");
      } } } : ({ getPlacesSemanticHistoryManager() { factoryCalls++; return native; } }) },
  });
  // Only adapt ES-module linkage for Node20's VM; execute the complete shipped
  // module body, not extracted/reimplemented privacy methods.
  const source = fs.readFileSync(path.join(__dirname, "../modules/FluxionNativeMemory.sys.mjs"), "utf8")
    .replace(/^import .*;\n/gm, "")
    .replace("export const FluxionNativeMemory", "globalThis.FluxionNativeMemory");
  vm.runInContext(source, context, { filename: "FluxionNativeMemory.sys.mjs" });
  const adapter = context.FluxionNativeMemory;
  const policyContext = vm.createContext({ Services, Cu: { reportError: error => errors.push(error) },
    FluxionNativeMemory: adapter, FluxionMemoryPolicy: require("../chrome/core/memory-policy.js") });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../modules/FluxionExclusionPolicy.sys.mjs"), "utf8")
    .replace(/^import .*;\n/gm, "").replace("export const FluxionExclusionPolicy", "globalThis.FluxionExclusionPolicy"), policyContext);
  const FluxionExclusionPolicy = policyContext.FluxionExclusionPolicy;
  const FluxionMemoryStore = {
    revision: 0,
    async pruneExisting() { state.pruneCalls++; },
    async upsert(page) { state.upserts.push(page); return true; },
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
    state.windows.push(window);
    const PlacesUtils = { tensorToSQLBindable, history: {
      getNewQuery: () => ({}), getNewQueryOptions: () => ({}), executeQuery: () => ({ root: {
        get childCount() { return state.keywords.length; }, getChild: index => state.keywords[index],
      } }),
    } };
    const ctx = vm.createContext({ window, Services, URL, Cc: {}, Ci: { nsINavHistoryQueryOptions: {} },
      Cu: { reportError: error => errors.push(error) },
      ChromeUtils: { importESModule: () => ({ FluxionNativeMemory: adapter, FluxionMemoryStore, FluxionExclusionPolicy,
        PlacesUtils, PrivateBrowsingUtils: { isWindowPrivate: () => isPrivate } }) },
    });
    for (const file of ["core/settings.js", "core/index-scheduler.js", "core/memory-policy.js",
      "core/memory-content.js", "core/memory-search.js", "core/memory-context.js", "core/memory-ranking.js", "core/memory-grounding.js", "fluxion-memory.js"]) {
      vm.runInContext(fs.readFileSync(path.join(__dirname, "../chrome", file), "utf8"), ctx, { filename: file });
    }
    return window.FluxionMemory;
  }
  return { adapter, native, state, prefs, operations, errors, chromeWindow, tensorToSQLBindable, store: FluxionMemoryStore,
    factoryCalls: () => factoryCalls,
    expireTimers() { const pending = [...timers.values()]; timers.clear(); pending.forEach(callback => callback()); },
  };
}

test("native provider boundary failure closes model gates before constructing a manager without changing deletion intent", () => {
  const f = fixture(new Map([["fluxion.memory.enabled", true], ["browser.ml.enable", true],
    ["places.semanticHistory.featureGate", true], ["places.semanticHistory.initialized", true],
    ["places.semanticHistory.removeOnStartup", false]]));
  f.state.boundaryFailure = true;
  assert.throws(() => f.adapter.getManager(), /boundary unavailable/);
  assert.equal(f.factoryCalls(), 0);
  assert.equal(f.prefs.get("browser.ml.enable"), false);
  assert.equal(f.prefs.get("places.semanticHistory.featureGate"), false);
  assert.equal(f.prefs.has("places.semanticHistory.initialized"), false);
  assert.equal(f.prefs.get("places.semanticHistory.removeOnStartup"), false);
  assert.equal(f.adapter.pending(), false);
});

test("provider boundary is rechecked on existing manager but cannot prevent explicit pending purge", async () => {
  const f = fixture(new Map([["fluxion.memory.enabled", true]]));
  f.adapter.getManager();
  f.state.boundaryFailure = true;
  assert.throws(() => f.adapter.getManager(), /boundary unavailable/);
  assert.equal(f.factoryCalls(), 1);
  await f.adapter.purge();
  assert.equal(f.state.vectors, 0);
  assert.equal(f.state.mapping, 0);
});

test("cold excluded native candidates and unsafe hash collisions get only sentinels while safe neighbors reach the embedder", async () => {
  const f = fixture(), api = f.chromeWindow();
  await api.enable(); await api.setExcludedDomains(["excluded.invalid"]);
  f.state.candidateURLs = [{ url_hash: 1, url: "https://excluded.invalid/new" },
    { url_hash: 2, url: "https://safe.invalid/article" }, { url_hash: 3, url: "https://safe.invalid/collision" },
    { url_hash: 3, url: "https://excluded.invalid/collision" }, { url_hash: 4, url: "https://safe.invalid/%61ccount" }];
  const candidates = [1, 2, 3, 4, 5].map(url_hash => ({ url_hash, content: `candidate ${url_hash}` }));
  await f.native.updateVectorDB(await f.native.getConnection(), candidates, []);
  assert.deepEqual(f.state.embeddedCandidates.map(row => row.url_hash), [2]);
  const sentinelWrites = f.state.cachedWrites.filter(write => write.sql.includes("INSERT OR REPLACE INTO vec_history"));
  assert.equal(sentinelWrites.length, 3);
  for (const write of sentinelWrites) assert.deepEqual(Array.from(write.parameters.vector), [1, 0, 0]);
  assert.deepEqual(candidates.map(row => row.url_hash), [1, 2, 3, 4, 5], "Do not mutate Gecko's source batch");
});

test("candidate lookup rechecks latest exclusions and malformed policy never reaches model or sentinel writes", async () => {
  for (const invalid of [false, true]) {
    const f = fixture(), api = f.chromeWindow(); await api.enable();
    f.state.candidateURLs = [{ url_hash: 1, url: "https://excluded.invalid/new" }];
    const wait = deferred(); f.state.beforeCandidates = wait.promise;
    const operation = f.native.updateVectorDB(await f.native.getConnection(), [{ url_hash: 1, content: "private words" }], []);
    await settle();
    f.prefs.set("fluxion.memory.exclusionPolicy", invalid ? "{" : JSON.stringify({ version: 1, directDomains: ["excluded.invalid"], lists: [] }));
    wait.resolve(); await operation;
    assert.equal(f.state.embeddedCandidates.length, 0);
    assert.equal(f.state.cachedWrites.length, invalid ? 0 : 2);
  }
});

test("committed exclusion waits for already-running native embedding before its final scrub and success", async () => {
  const f = fixture(), api = f.chromeWindow(); await api.enable(); await settle();
  f.state.candidateURLs = [{ url_hash: 1, url: "https://later-excluded.invalid/article" }];
  const wait = deferred(); f.state.beforeWrite = wait.promise;
  const writing = f.native.updateVectorDB(await f.native.getConnection(), [{ url_hash: 1, content: "previously permitted" }], []);
  await settle();
  let completed = false;
  const saving = api.setExcludedDomains(["later-excluded.invalid"]).then(() => { completed = true; });
  await settle();
  assert.equal(completed, false);
  assert.equal(f.state.ownedExclusions.length, 0);
  f.state.exclusionRows = [{ rowid: 77, url: "https://later-excluded.invalid/article" }];
  wait.resolve(); await writing; await saving;
  assert.equal(completed, true);
  assert.equal(f.state.cachedWrites.filter(write => write.sql.includes("INSERT INTO vec_history")).length, 1);
  assert.deepEqual(f.state.ownedExclusions, [["later-excluded.invalid"]]);
});

test("a stalled native write makes exclusion save fail truthfully while still deleting owned evidence", async () => {
  const f = fixture(), api = f.chromeWindow(); await api.enable(); await settle();
  const wait = deferred(); f.state.beforeWrite = wait.promise;
  const writing = f.native.updateVectorDB(); await settle();
  const saving = api.setExcludedDomains(["excluded.invalid"]);
  const rejected = assert.rejects(saving, /waiting for background work/);
  await settle(); f.expireTimers(); await rejected;
  assert.deepEqual(f.state.ownedExclusions, [["excluded.invalid"]]);
  wait.resolve(); await writing;
});

test("policy corruption while a native exclusion query waits never scrubs every vector or invents startup deletion", async () => {
  const f = fixture(), api = f.chromeWindow();
  await api.enable(); await settle();
  assert.equal(f.prefs.get("places.semanticHistory.removeOnStartup"), false);
  f.state.exclusionRows = [{ rowid: 1, url: "https://blocked.example/guide" }, { rowid: 2, url: "https://safe.example/guide" }];
  const pause = deferred(); f.state.beforeExclusionQuery = pause.promise;
  const edit = api.setExcludedDomains(["blocked.example"]);
  await settle();
  f.prefs.set("places.semanticHistory.initialized", true);
  f.prefs.set("fluxion.memory.exclusionPolicy", "\u0000");
  assert.equal(api.exclusionPolicy().valid, false); // Reconcile actual policy subscription.
  assert.equal(f.prefs.get("browser.ml.enable"), false);
  assert.equal(f.prefs.get("places.semanticHistory.featureGate"), false);
  assert.equal(f.prefs.get("places.semanticHistory.removeOnStartup"), false);
  assert.equal(f.prefs.has("places.semanticHistory.initialized"), false);
  pause.resolve(); await edit;
  assert.deepEqual(f.state.cachedWrites, []);
  assert.equal(f.state.vectors, 2);
  // An existing explicit opt-out's persisted deletion intent stays in force.
  const optedOut = fixture(new Map([["fluxion.memory.exclusionPolicy", "{"], ["places.semanticHistory.removeOnStartup", true]]));
  optedOut.chromeWindow().exclusionPolicy();
  assert.equal(optedOut.prefs.get("places.semanticHistory.removeOnStartup"), true);
});

test("named lists migrate legacy domains atomically and preserve direct ownership when a list is disabled", async () => {
  const legacy = '["direct.example"]';
  const f = fixture(new Map([["fluxion.memory.excludedDomains", legacy]]));
  const main = f.chromeWindow(), second = f.chromeWindow();
  const initial = main.exclusionPolicy();
  assert.equal(initial.legacy, true);
  assert.equal(f.prefs.has("fluxion.memory.exclusionPolicy"), false, "reading legacy policy must not persist migration");
  const created = await main.saveExclusionList({ name: "Health", enabled: true, domains: ["medical.example"] }, initial.revision);
  assert.equal(created.lists.length, 1);
  assert.equal(f.prefs.get("fluxion.memory.excludedDomains"), legacy, "legacy migration record changed");
  assert.deepEqual(Array.from(second.excludedDomains()), ["direct.example", "medical.example"]);
  await main.excludeDomain("medical.example");
  const latest = second.exclusionPolicy();
  await second.saveExclusionList({ ...latest.lists[0], enabled: false }, latest.revision);
  assert.deepEqual(Array.from(main.excludedDomains()), ["direct.example", "medical.example"], "explicit exclusion must stay direct even when already in a list");
  await main.setExcludedDomains(["direct.example"], main.exclusionPolicy().revision);
  assert.deepEqual(Array.from(main.excludedDomains()), ["direct.example"]);
  assert.equal(main.exclusionPolicy().lists.length, 1, "editing direct entries erased lists");
  const before = main.exclusionPolicy();
  await main.deleteExclusionList(before.lists[0].id, before.revision);
  assert.equal(main.exclusionPolicy().lists.length, 0);
  assert.equal(f.state.upserts.length, 0, "list disable/delete must never resurrect removed evidence");
});

test("queued cross-window stale policy edits reject before any write or cleanup", async () => {
  const f = fixture(), main = f.chromeWindow(), second = f.chromeWindow();
  const revision = main.exclusionPolicy().revision;
  const pause = deferred();
  f.store.deleteBlocked = async values => { f.state.ownedExclusions.push(Array.from(values)); await pause.promise; };
  const first = main.saveExclusionList({ name: "Health", enabled: true, domains: ["medical.example"] }, revision);
  await settle();
  assert.deepEqual(Array.from(second.excludedDomains()), ["medical.example"], "new exclusion was not visible before delayed deletion");
  const saved = f.prefs.get("fluxion.memory.exclusionPolicy");
  const rejected = assert.rejects(second.setExcludedDomains(["other.example"], revision), error => error.code === "POLICY_CONFLICT");
  pause.resolve(); await first; await rejected;
  assert.equal(f.prefs.get("fluxion.memory.exclusionPolicy"), saved);
  assert.deepEqual(f.state.ownedExclusions, [["medical.example"]]);
});

test("invalid canonical policy blocks runtime results/extraction and permits only explicit revision-checked recovery", async () => {
  const f = fixture(new Map([["fluxion.memory.enabled", true], ["fluxion.memory.exclusionPolicy", "\u0000"]]));
  const api = f.chromeWindow();
  f.state.keywords = [{ uri: "https://example.org/guide", title: "Guide" }];
  let actorCalls = 0;
  await api.indexBrowser({ currentURI: { spec: "https://example.org/guide" }, browsingContext: { currentWindowGlobal: {
    getActor() { actorCalls++; throw Error("should not extract"); },
  } } });
  assert.equal(actorCalls, 0);
  assert.equal((await api.search("guide")).state, "policy-error");
  assert.equal(f.state.searchCalls, 0); assert.equal(f.state.inferenceCalls, 0);
  const snapshot = api.exclusionPolicy(); assert.equal(snapshot.valid, false);
  assert.throws(() => f.adapter.getManager(), /Repair the exclusion policy/);
  assert.equal(f.factoryCalls(), 0, "corrupt policy constructed a Gecko manager that could erase existing data");
  await assert.rejects(api.setExcludedDomains([]), /needs recovery/);
  const recovered = await api.resetExclusionPolicy(snapshot.revision);
  assert.equal(recovered.valid, true); assert.equal(recovered.lists.length, 0);
});

test("private windows cannot migrate, reset, or change any exclusion policy", async () => {
  const f = fixture(new Map([["fluxion.memory.excludedDomains", '["direct.example"]']]));
  const api = f.chromeWindow({ isPrivate: true });
  const previous = [...f.prefs], revision = api.exclusionPolicy().revision;
  assert.equal(api.exclusionPolicy().readOnly, true);
  for (const call of [() => api.saveExclusionList({ name: "Private", enabled: true, domains: [] }, revision),
    () => api.deleteExclusionList("missing", revision), () => api.resetExclusionPolicy(revision),
    () => api.setExcludedDomains([]), () => api.excludeDomain("another.example")]) await assert.rejects(call(), /private window/);
  assert.deepEqual([...f.prefs], previous); assert.equal(f.state.ownedExclusions.length, 0);
});

test("excluded domain limit rejects new entries atomically after normalization but permits duplicates at capacity", async () => {
  const f = fixture(), api = f.chromeWindow();
  const domains = Array.from({ length: 200 }, (_, index) => `site${index}.example`);
  const saved = await api.setExcludedDomains(domains);
  assert.equal(saved.length, 200);
  const previous = f.prefs.get("fluxion.memory.excludedDomains");
  const prefsBefore = [...f.prefs];
  f.state.ownedExclusions.length = 0;
  await assert.rejects(api.setExcludedDomains([...domains, "extra.example"]), /up to 200 excluded domains/);
  await assert.rejects(api.excludeDomain("extra.example"), /up to 200 excluded domains/);
  assert.equal(f.prefs.get("fluxion.memory.excludedDomains"), previous);
  assert.deepEqual([...f.prefs], prefsBefore, "rejected edit must not partially mutate any preference");
  assert.deepEqual(f.state.ownedExclusions, []);
  assert.deepEqual(f.state.cachedWrites, []);
  assert.equal(await api.excludeDomain("https://www.SITE0.example./article"), true);
  assert.equal((await api.setExcludedDomains([...domains, "https://www.SITE1.example./article"])).length, 200);
  assert.equal(f.prefs.get("fluxion.memory.excludedDomains"), previous);
  assert.equal(f.state.ownedExclusions.length, 2, "valid normalized duplicate edits retain normal cleanup semantics");
});

test("startup prunes existing owned evidence while disabled but private windows never initiate cleanup", async () => {
  const f = fixture();
  f.chromeWindow({ isPrivate: true }); await settle();
  assert.equal(f.state.pruneCalls, 0);
  f.chromeWindow(); await settle();
  assert.equal(f.state.pruneCalls, 1);
  assert.equal(f.factoryCalls(), 0, "disabled cleanup must not initialize the native model");
  assert.equal(f.state.searchCalls, 0);
  f.chromeWindow({ isPrivate: true }); await settle();
  assert.equal(f.state.pruneCalls, 1);
});

test("encoded sensitive indexing is rejected before extraction and again after actor evidence arrives", async () => {
  const f = fixture(), api = f.chromeWindow();
  await api.setEmbeddingProvider("disabled"); await api.enable();
  let actorCalls = 0;
  let extractedURL = "https://example.org/%61ccount";
  const browser = { currentURI: { spec: extractedURL }, browsingContext: { currentWindowGlobal: {
    getActor: () => ({ sendQuery: async () => {
      actorCalls++;
      return { url: extractedURL, title: "Evidence", text: "Long readable evidence. ".repeat(10) };
    } }),
  } } };
  f.state.windows[0].gBrowser.getTabForBrowser = () => null;
  await api.indexBrowser(browser);
  assert.equal(actorCalls, 0); assert.equal(f.state.upserts.length, 0);
  browser.currentURI.spec = "https://example.org/article";
  await api.indexBrowser(browser);
  assert.equal(actorCalls, 1); assert.equal(f.state.upserts.length, 0);
  extractedURL = browser.currentURI.spec;
  await api.indexBrowser(browser);
  assert.equal(actorCalls, 2); assert.equal(f.state.upserts.length, 1);
  assert.equal(f.state.upserts[0].url, extractedURL);
});

test("all Memory result sources and partial snapshots omit encoded sensitive evidence", async () => {
  const f = fixture(), api = f.chromeWindow();
  await api.enable(); await settle();
  const blocked = "https://example.org/guide%252fbilling";
  const safe = source => `https://example.org/guide-${source}`;
  f.state.keywords = [blocked, safe("places")].map(uri => ({ uri, title: "Guide", time: 1000000, accessCount: 1 }));
  f.state.enrichedResults.lexical = [blocked, safe("owned-keyword")].map(url => ({ url, title: "Guide", lastVisit: 1000 }));
  f.state.enrichedResults.semantic = [blocked, safe("owned-semantic")].map(url => ({ url, title: "Guide", distance: 0.1 }));
  f.state.nativeResults = [blocked, safe("native")].map(url => ({ url, title: "Guide", distance: 0.1 }));
  const partials = [];
  const result = await api.search("guide", "", { onPartial: value => partials.push(value) });
  assert.equal(f.state.inferenceCalls, 1);
  assert.equal(result.results.length, 4);
  assert.deepEqual(new Set(result.results.map(row => row.url)), new Set([safe("places"), safe("owned-keyword"), safe("owned-semantic"), safe("native")]));
  assert.ok(partials.length >= 2);
  for (const snapshot of [...partials, result]) {
    assert.equal(snapshot.results.some(row => row.url === blocked), false);
    assert.equal(JSON.stringify(snapshot.answer).includes(blocked), false);
  }
});

test("native exclusion mutations replace encoded sensitive vectors without changing safe neighbors", async () => {
  const f = fixture();
  f.state.exclusionRows = [
    { rowid: 1, url: "https://example.org/%61ccount" },
    { rowid: 2, url: "https://example.org/docs%255cwallet" },
    { rowid: 3, url: "https://example.org/accounting" },
    { rowid: 4, url: "https://example.org/caf%C3%A9" },
  ];
  await f.chromeWindow().enable(); await settle();
  assert.deepEqual(f.state.cachedWrites.map(write => write.parameters.rowid), [1, 1, 2, 2]);
  for (const write of f.state.cachedWrites.filter(item => item.sql.startsWith("INSERT"))) {
    assert.deepEqual(Array.from(write.parameters.vector), [1, 0, 0]);
  }
  assert.equal(f.state.mapping, 2, "sentinel replacement must not delete mapping rows");
  assert.deepEqual(f.errors, []);
});

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

test("indexing captures workspace/group before deferred extraction and does not rewrite that context on movement", async () => {
  const f = fixture(), api = f.chromeWindow();
  f.prefs.set("fluxion.memory.embeddingProvider", "disabled");
  await api.setEmbeddingProvider("disabled");
  await api.enable();
  const window = f.state.windows[0], extracted = deferred();
  const browser = { currentURI: { spec: "https://example.org/article" },
    browsingContext: { currentWindowGlobal: { getActor: () => ({ sendQuery: () => extracted.promise }) } } };
  const tab = { workspace: "school", group: { label: "Research" }, linkedBrowser: browser };
  let names = [{ id: "school", name: "School" }, { id: "dev", name: "Development" }];
  window.FluxionUI.workspaces = () => names;
  window.FluxionUI.tabWorkspace = target => target.workspace;
  window.gBrowser.getTabForBrowser = () => tab;
  const pending = api.indexBrowser(browser);
  tab.workspace = "dev"; tab.group.label = "Project";
  names = [{ id: "dev", name: "Renamed development" }];
  extracted.resolve({ url: browser.currentURI.spec, title: "Readable article", text: "This is sufficiently long article evidence about plants and scientific research to be indexed by Browser Memory." });
  await pending;
  assert.equal(f.state.upserts.length, 1);
  assert.equal(f.state.upserts[0].workspace, "school");
  assert.equal(f.state.upserts[0].savedWorkspaceName, "School");
  assert.equal(f.state.upserts[0].tabGroup, "Research");
});

test("runtime shows saved context separately and refreshes duplicate live contexts on final snapshot", async () => {
  const f = fixture(), api = f.chromeWindow();
  await api.setEmbeddingProvider("disabled"); await api.enable();
  const window = f.state.windows[0], url = "https://example.org/guide";
  let names = [{ id: "dev", name: "Development" }, { id: "personal", name: "Personal" }];
  window.FluxionUI.workspaces = () => names;
  window.FluxionUI.tabWorkspace = tab => tab.workspace;
  window.gBrowser.tabs = [
    { workspace: "dev", group: { label: "Now" }, linkedBrowser: { currentURI: { spec: url } } },
    { workspace: "personal", linkedBrowser: { currentURI: { spec: url } } },
    { workspace: "personal", linkedBrowser: { currentURI: { spec: url } } },
  ];
  f.state.enrichedResults.lexical = [{ url, title: "Guide", workspace: "school", savedWorkspaceName: "School", group: "Research", indexedAt: 1 }];
  const deferredResult = deferred(), partials = [];
  f.state.beforeEnriched = deferredResult.promise;
  const pending = api.search("guide", "dev", { onPartial: response => partials.push(response) });
  await settle();
  assert.equal(partials.at(-1).results[0].openContexts.length, 2);
  names = [{ id: "dev", name: "Renamed" }];
  window.gBrowser.tabs.splice(1);
  deferredResult.resolve();
  const result = await pending;
  assert.equal(result.results[0].workspace, "school");
  assert.equal(result.results[0].savedContext.workspaceName, "School");
  assert.equal(result.results[0].openContexts.length, 1);
  assert.equal(result.results[0].openContexts[0].workspaceName, "Renamed");
  assert.deepEqual(Array.from(result.answer.evidence[0].contextLabels), ["Saved in School", "Saved group: Research", "Open here in Renamed / Now"]);
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
  await assert.rejects(privateWindow.setExcludedDomains(["excluded.example"]), /private window/);
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
