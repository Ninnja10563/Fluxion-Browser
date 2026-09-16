"use strict";
// CPU-only identical-harness comparison. This does not benchmark Gecko discard,
// page execution, process memory, OS idle power, or end-to-end input latency.
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { readFileSync } = require("node:fs");
const { performance } = require("node:perf_hooks");
const vm = require("node:vm");
const BASELINE = "eca27212472017d3b174dc4d158a7709b0ed5e0a";
const sources = {
  baseline: execFileSync("git", ["show", `${BASELINE}:fluxion/chrome/fluxion-tab-sleeping.js`], { encoding: "utf8" }),
  current: readFileSync(require.resolve("../chrome/fluxion-tab-sleeping.js"), "utf8"),
};
const policy = readFileSync(require.resolve("../chrome/core/tab-sleeping.js"), "utf8");

function setupFixture(count, privateWindow) {
  const counters = { tabListReads: 0, ownershipLookups: 0, prepares: 0, discards: 0, timers: 0 };
  const now = 2_000_000;
  const tabs = Array.from({ length: count }, () => ({ parentNode: {}, linkedBrowser: { getAttribute: () => "" },
    linkedPanel: "panel", lastAccessed: now, hasAttribute: () => false }));
  const owned = new Map(tabs.map(tab => [tab.linkedBrowser, tab]));
  const gBrowser = {
    get tabs() { counters.tabListReads++; return tabs; },
    selectedTab: tabs[0], tabContainer: { addEventListener() {} },
    getTabForBrowser(browser) { counters.ownershipLookups++; return owned.get(browser); },
    prepareDiscardBrowser() { counters.prepares++; },
    discardBrowser() { counters.discards++; return true; },
  };
  const window = { setTimeout() { counters.timers++; return 1; }, clearTimeout() {}, addEventListener() {} };
  Date.now = () => now;
  Object.assign(globalThis, { window, gBrowser, benchmarkCounters: counters,
    ChromeUtils: { importESModule: () => ({ PrivateBrowsingUtils: { isWindowPrivate: () => privateWindow } }) },
    Services: { env: { get: () => "" }, prefs: { getIntPref: (_key, fallback) => fallback,
      addObserver() {}, removeObserver() {}, setStringPref() {}, savePrefFile() {} } },
    Cu: { reportError(error) { throw error; } },
  });
}

function fixture(source, count, privateWindow = false) {
  // Arrays and helpers must share the measured code's realm: spreading a host
  // array inside a VM otherwise measures the VM boundary instead of this work.
  const context = vm.createContext({});
  vm.runInContext(`(${setupFixture.toString()})(${count}, ${privateWindow});`, context);
  vm.runInContext(policy, context); vm.runInContext(source, context);
  return { controller: context.window.FluxionTabSleeping, counters: context.benchmarkCounters };
}

(async () => {
  console.log(JSON.stringify({ benchmark: "sleeping-scheduler", baseline: BASELINE,
    node: process.version, platform: process.platform, arch: process.arch,
    scope: "same-VM corpus; alternating order; CPU-only; no native/browser-speed claim" }));
  for (const count of [200, 1000, 3000]) {
    const fixtures = Object.fromEntries(Object.entries(sources).map(([name, source]) => [name, fixture(source, count)]));
    const samples = { baseline: [], current: [] }, work = {};
    for (const [name, f] of Object.entries(fixtures)) {
      assert.equal(await f.controller.run(), 0);
      assert.equal(f.counters.prepares, 0); assert.equal(f.counters.discards, 0);
      work[name] = { ...f.counters };
    }
    assert.equal(work.baseline.tabListReads, count + 1);
    assert.equal(work.current.tabListReads, 1);
    assert.equal(work.current.ownershipLookups, count);
    for (let repeat = 0; repeat < 24; repeat++) {
      for (const name of repeat % 2 ? ["current", "baseline"] : ["baseline", "current"]) {
        const start = performance.now();
        assert.equal(await fixtures[name].controller.run(), 0);
        if (repeat >= 4) samples[name].push(performance.now() - start);
      }
    }
    for (const name of ["baseline", "current"]) {
      const sorted = samples[name].sort((a, b) => a - b);
      console.log(JSON.stringify({ baseline: BASELINE, scenario: "recent-ineligible-tabs", count, name,
        samples: sorted.length, p50: sorted[Math.ceil(sorted.length * .5) - 1],
        p95: sorted[Math.ceil(sorted.length * .95) - 1], workPerSweep: work[name] }));
    }
  }
  const before = fixture(sources.baseline, 0, true), after = fixture(sources.current, 0, true);
  assert.equal(await before.controller.run(), 0); assert.equal(await after.controller.run(), 0);
  assert.equal(before.counters.timers, 1);
  assert.equal(after.counters.timers, 0);
  assert.equal(after.counters.tabListReads, 0);
  console.log(JSON.stringify({ scenario: "private-window-scheduling", baselineTimers: before.counters.timers, currentTimers: after.counters.timers }));
})().catch(error => { console.error(error); process.exitCode = 1; });
