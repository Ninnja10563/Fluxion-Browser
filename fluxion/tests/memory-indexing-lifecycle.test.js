"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), vm = require("node:vm");
const { IndexScheduler } = require("../chrome/core/index-scheduler.js");
const source = fs.readFileSync(require.resolve("../chrome/fluxion-memory.js"), "utf8");
const activityEvents = ["keydown", "pointerdown", "touchstart", "wheel"];
const settle = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function eventTarget(extra = {}) {
  const listeners = new Map();
  return Object.assign(extra, {
    addEventListener(name, callback) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(callback);
    },
    removeEventListener(name, callback) { listeners.get(name)?.delete(callback); },
    emit(name) { for (const callback of [...listeners.get(name) || []]) callback({ type: name }); },
    count(name) { return listeners.get(name)?.size || 0; },
  });
}
function environment(initialEnabled = false) {
  const values = new Map([["fluxion.memory.enabled", initialEnabled], ["fluxion.memory.embeddingProvider", "disabled"]]);
  const prefObservers = new Map(), observers = new Map();
  const add = (map, key, callback) => { if (!map.has(key)) map.set(key, new Set()); map.get(key).add(callback); };
  const remove = (map, key, callback) => map.get(key)?.delete(callback);
  const prefs = {
    getBoolPref: (name, fallback) => values.has(name) ? values.get(name) : fallback,
    getStringPref: (name, fallback) => values.has(name) ? values.get(name) : fallback,
    setBoolPref(name, value) { const old = values.get(name); values.set(name, value); if (old !== value) this.notify(name); },
    setStringPref(name, value) { const old = values.get(name); values.set(name, value); if (old !== value) this.notify(name); },
    clearUserPref: name => values.delete(name), savePrefFile() {},
    addObserver: (name, callback) => add(prefObservers, name, callback),
    removeObserver: (name, callback) => remove(prefObservers, name, callback),
    notify(name) { for (const callback of [...prefObservers.get(name) || []]) callback.observe(null, "nsPref:changed", name); },
  };
  const Services = { prefs, env: { get: () => "" }, obs: {
    addObserver: (callback, name) => add(observers, name, callback),
    removeObserver: (callback, name) => remove(observers, name, callback),
  } };
  return { Services, prefObservers, observers,
    enable: value => prefs.setBoolPref("fluxion.memory.enabled", value),
    window({ privateWindow = false } = {}) {
      let now = 0, nextTimer = 0;
      const timers = new Map(), progress = new Set(), batteryRequests = [], policies = new Set(), errors = [];
      const counts = { activity: 0, idleService: 0, pruned: 0, extracted: 0, stored: 0, battery: 0 };
      const browser = { currentURI: { spec: "https://ordinary.example/page" }, getAttribute: () => "", browsingContext: { currentWindowGlobal: {
        getActor() { return { async sendQuery() { counts.extracted++; return {
          url: browser.currentURI.spec, title: "Ordinary page", text: "Readable page evidence. ".repeat(10),
        }; } }; },
      } } };
      const tab = { linkedBrowser: browser, hasAttribute: () => false, group: null };
      const gBrowser = { selectedTab: tab, getTabForBrowser: candidate => candidate === browser ? tab : null,
        addTabsProgressListener: listener => progress.add(listener), removeTabsProgressListener: listener => progress.delete(listener) };
      const window = eventTarget({ gBrowser, FluxionUI: { tabWorkspace: () => "focus", workspaces: () => [{ id: "focus", name: "Focus" }] },
        navigator: { getBattery() { counts.battery++; const request = deferred(); batteryRequests.push(request); return request.promise; } },
        setTimeout(callback, delay = 0) { const id = ++nextTimer; timers.set(id, { callback, due: now + delay }); return id; },
        clearTimeout: id => timers.delete(id),
        requestIdleCallback(callback) { const id = ++nextTimer; timers.set(id, { callback, due: now }); return id; },
        cancelIdleCallback: id => timers.delete(id),
        CustomEvent: class { constructor(type) { this.type = type; } }, dispatchEvent(event) { this.emit(event.type); },
      });
      const store = { revision: 0, async pruneExisting() { counts.pruned++; }, async upsert() { counts.stored++; return true; },
        async clear() {}, async clearVectors() {} };
      const imports = {
        "resource://gre/modules/PlacesUtils.sys.mjs": { PlacesUtils: {} },
        "resource://gre/modules/PrivateBrowsingUtils.sys.mjs": { PrivateBrowsingUtils: { isWindowPrivate: () => privateWindow } },
        "resource://fluxion/modules/FluxionMemoryStore.sys.mjs": { FluxionMemoryStore: store },
        "resource://fluxion/modules/FluxionNativeMemory.sys.mjs": { FluxionNativeMemory: {
          pending: () => false, recover: async () => {}, runControl: callback => callback(), purge: async () => {},
        } },
        "resource://fluxion/modules/FluxionExclusionPolicy.sys.mjs": { FluxionExclusionPolicy: {
          subscribe(callback) { policies.add(callback); return () => policies.delete(callback); }, snapshot: () => ({ valid: true }),
        } },
      };
      const context = vm.createContext({ window, Services,
        ChromeUtils: { importESModule(uri) { if (!imports[uri]) throw Error(`Unexpected import: ${uri}`); return imports[uri]; } },
        Cc: { "@mozilla.org/widget/useridleservice;1": { getService() { counts.idleService++; return { idleTime: 5000 }; } } },
        Ci: { nsIUserIdleService: {}, nsIWebProgressListener: { STATE_STOP: 1, STATE_IS_NETWORK: 2 } },
        Cu: { reportError: error => errors.push(error) },
        FluxionIndexScheduler: { IndexScheduler: class extends IndexScheduler {
          constructor(options) { super({ ...options, now: () => now }); }
          notifyActivity() { counts.activity++; super.notifyActivity(); }
        } },
        FluxionMemoryPolicy: { readPolicy: () => ({ valid: true }), effectiveDomains: () => [], canIndexPage: () => true },
        FluxionMemoryContent: { normalisePage: page => page, embeddingText: page => page.text },
        FluxionSettings: { normaliseEmbeddingProvider: value => value },
      });
      vm.runInContext(source, context);
      return { window, progress, counts, batteryRequests, policies, errors, timers, browser,
        loaded() { for (const listener of progress) listener.onStateChange(browser, { isTopLevel: true }, null, 3); },
        async advance(milliseconds) {
          now += milliseconds;
          for (let step = 0; step < 30; step++) {
            const ready = [...timers].find(([, timer]) => timer.due <= now);
            if (!ready) break;
            timers.delete(ready[0]); ready[1].callback(); await settle();
          }
        },
      };
    },
  };
}

test("disabled Memory has zero indexing hooks, battery requests, extraction and scheduled work while retaining privacy cleanup", async () => {
  const e = environment(), f = e.window();
  await settle();
  for (let index = 0; index < 10000; index++) for (const name of activityEvents) f.window.emit(name);
  f.loaded(); await f.advance(60000);
  assert.equal(f.progress.size, 0);
  assert.ok(activityEvents.every(name => f.window.count(name) === 0));
  assert.equal(e.observers.get("memory-pressure")?.size || 0, 0);
  assert.deepEqual(f.counts, { activity: 0, idleService: 0, pruned: 1, extracted: 0, stored: 0, battery: 0 });
  assert.equal(f.timers.size, 0);
  assert.equal(f.policies.size, 1, "Privacy policy observation remains installed");
  assert.equal(e.observers.get("places-semantichistorymanager-update-complete").size, 1);
});

test("enabled private windows never acquire indexing resources, including after cross-window preference changes", async () => {
  const e = environment(true), f = e.window({ privateWindow: true });
  e.enable(false); e.enable(true); await settle();
  for (const name of activityEvents) f.window.emit(name);
  f.loaded(); await f.advance(60000);
  assert.equal(f.progress.size, 0);
  assert.ok(activityEvents.every(name => f.window.count(name) === 0));
  assert.deepEqual(f.counts, { activity: 0, idleService: 0, pruned: 0, extracted: 0, stored: 0, battery: 0 });
  assert.equal(f.timers.size, 0);
});

test("a previously enabled ordinary profile installs one indexing lifecycle at startup", async () => {
  const e = environment(true), f = e.window();
  await settle();
  assert.equal(f.progress.size, 1);
  assert.ok(activityEvents.every(name => f.window.count(name) === 1));
  assert.equal(f.counts.battery, 1); assert.equal(f.counts.idleService, 1);
  assert.equal(f.counts.pruned, 1);
  f.loaded(); await f.advance(4000);
  assert.equal(f.counts.extracted, 1); assert.equal(f.counts.stored, 1);
  f.window.emit("unload");
  e.Services.prefs.notify("fluxion.memory.enabled");
  assert.equal(f.progress.size, 0); assert.equal(f.counts.battery, 1);
});

test("cross-window opt-in attaches once and preserves queued idle extraction; opt-out immediately detaches and clears", async () => {
  const e = environment(), first = e.window(), second = e.window();
  e.enable(true); e.Services.prefs.notify("fluxion.memory.enabled");
  for (const f of [first, second]) {
    assert.equal(f.progress.size, 1);
    assert.ok(activityEvents.every(name => f.window.count(name) === 1));
    assert.equal(f.counts.battery, 1);
    f.loaded();
    await f.advance(3999); assert.equal(f.counts.extracted, 0);
    f.window.emit("wheel");
    await f.advance(3999); assert.equal(f.counts.extracted, 0);
    await f.advance(1); assert.equal(f.counts.extracted, 1); assert.equal(f.counts.stored, 1);
    f.loaded(); assert.equal(f.window.FluxionMemory.indexingStatus().queued, 1);
  }
  e.enable(false);
  for (const f of [first, second]) {
    assert.equal(f.progress.size, 0); assert.equal(f.timers.size, 0);
    assert.ok(activityEvents.every(name => f.window.count(name) === 0));
    assert.equal(f.window.FluxionMemory.indexingStatus().queued, 0);
    const before = f.counts.activity;
    f.window.emit("wheel"); assert.equal(f.counts.activity, before);
    await f.advance(60000); assert.equal(f.counts.extracted, 1);
  }
});

test("late battery promises cannot attach after opt-out, replace a new opt-in, or outlive the window", async () => {
  const e = environment(), f = e.window();
  const stale = eventTarget({ charging: false, level: 0.01 });
  const current = eventTarget({ charging: false, level: 0.1 });
  e.enable(true); e.enable(false); e.enable(true);
  f.batteryRequests[0].resolve(stale); await settle();
  assert.equal(stale.count("chargingchange"), 0); assert.equal(stale.count("levelchange"), 0);
  f.batteryRequests[1].resolve(current); await settle();
  assert.equal(current.count("chargingchange"), 1); assert.equal(current.count("levelchange"), 1);
  f.loaded(); await f.advance(4000);
  assert.equal(f.counts.extracted, 0);
  assert.equal(f.window.FluxionMemory.indexingStatus().deferReason, "low-battery");
  current.charging = true; current.emit("chargingchange"); await f.advance(0);
  assert.equal(f.counts.extracted, 1, "Current battery state wakes the existing idle scheduler");
  e.enable(false);
  assert.equal(current.count("chargingchange"), 0); assert.equal(current.count("levelchange"), 0);
  e.enable(true);
  f.window.emit("unload");
  const afterUnload = eventTarget({ charging: true, level: 1 });
  f.batteryRequests[2].resolve(afterUnload); await settle();
  assert.equal(afterUnload.count("chargingchange"), 0);
  assert.equal(f.progress.size, 0); assert.equal(f.timers.size, 0);
  assert.equal(e.prefObservers.get("fluxion.memory.enabled").size, 0);
  assert.equal(f.policies.size, 0);
  assert.equal(e.observers.get("memory-pressure").size, 0);
  assert.equal(e.observers.get("places-semantichistorymanager-update-complete").size, 0);
  assert.deepEqual(f.errors, []);
});

test("battery rejection belongs only to its active opt-in generation", async () => {
  const e = environment(), f = e.window();
  e.enable(true); e.enable(false);
  f.batteryRequests[0].reject(Error("obsolete battery request")); await settle();
  assert.deepEqual(f.errors, []);
  e.enable(true);
  const currentError = Error("current battery unavailable");
  f.batteryRequests[1].reject(currentError); await settle();
  assert.deepEqual(f.errors, [currentError]);
  f.loaded(); await f.advance(4000);
  assert.equal(f.counts.extracted, 1, "Unsupported battery reporting does not prevent otherwise safe indexing");
  f.window.emit("unload");
});
