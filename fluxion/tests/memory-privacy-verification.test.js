"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const settle = () => new Promise(resolve => setImmediate(resolve));
function fixture({ semanticRegistered = false, legacySemanticRegistered = false, missingPlaces = false } = {}) {
  // Firefox 155's base provider derives its registry name from the class.
  class UrlbarProvider { get name() { return this.constructor.name; } }
  class UrlbarProviderPlaces extends UrlbarProvider {}
  class UrlbarProviderSemanticHistorySearch extends UrlbarProvider {}
  const providers = new Map();
  for (const provider of [
    ...(!missingPlaces ? [new UrlbarProviderPlaces()] : []),
    ...(semanticRegistered ? [new UrlbarProviderSemanticHistorySearch()] : []),
    ...(legacySemanticRegistered ? [{ name: "SemanticHistorySearch" }] : []),
  ]) providers.set(provider.name, provider);
  const startup = { _placesBrowserInitComplete: false };
  const prefs = new Map(), timers = [], imports = [];
  let opened = 0, now = 0;
  const window = {
    FluxionMemory: { enabled: () => false },
    setTimeout(callback) { timers.push(callback); },
    // Stop the fixture at its first externally visible action after readiness.
    // No seeding, database behavior or production verification is simulated.
    OpenBrowserWindow() { opened++; throw new Error("test stopped after verified startup barrier"); },
  };
  const context = vm.createContext({ window,
    SessionStore: { promiseAllWindowsRestored: Promise.resolve() },
    Date: { now: () => now }, Cu: { reportError() {} },
    Services: { env: { get: () => "1" }, wm: { getEnumerator: () => [] }, prefs: {
      getBoolPref: (name, fallback) => prefs.get(name) ?? fallback,
      setBoolPref: (name, value) => prefs.set(name, value),
      clearUserPref: name => prefs.delete(name),
      setStringPref: (name, value) => prefs.set(name, value), savePrefFile() {},
    } },
    ChromeUtils: { importESModule(name) {
      imports.push(name);
      if (name.endsWith("UrlbarProvidersManager.sys.mjs")) return { ProvidersManager: { getInstanceForSap() {
        return { getProvider: name => providers.get(name) };
      } } };
      assert.match(name, /PlacesBrowserStartup/);
      return { PlacesBrowserStartup: startup };
    } },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../chrome/fluxion-memory-privacy-verification.js"), "utf8"), context);
  return { startup, prefs, imports, opened: () => opened,
    tick(milliseconds = 50) { now += milliseconds; timers.splice(0).forEach(callback => callback()); },
  };
}

test("native privacy verification waits for Places startup before companion or semantic storage", async () => {
  const f = fixture(); await settle();
  assert.equal(f.opened(), 0);
  assert.equal(f.prefs.get("fluxion.memory.privacy.stage"), "waiting-for-places-startup");
  f.tick(); await settle();
  assert.equal(f.opened(), 0);
  assert.equal(f.imports.length, 2);
  assert.ok(f.imports.every(name => !name.includes("SemanticHistoryManager")));
  f.startup._placesBrowserInitComplete = true;
  f.tick(); await settle();
  assert.equal(f.opened(), 1);
  const report = JSON.parse(f.prefs.get("fluxion.memory.privacy.report"));
  assert.equal(report.placesStartupComplete, true);
  assert.match(f.prefs.get("fluxion.memory.privacy.error"), /test stopped after verified startup barrier/);
  assert.equal(f.prefs.has("fluxion.memory.privacy.health"), false);
});

test("privacy gate rejects unfiltered semantic providers or missing ordinary Places before any storage or companion", async () => {
  for (const option of ["semanticRegistered", "legacySemanticRegistered", "missingPlaces"]) {
    const f = fixture({ [option]: true }); await settle();
    assert.equal(f.opened(), 0);
    assert.match(f.prefs.get("fluxion.memory.privacy.error"), /native semantic provider was not isolated/);
    const report = JSON.parse(f.prefs.get("fluxion.memory.privacy.report"));
    const registry = report.checks.find(check => check.label === "native-provider-registry");
    assert.equal(registry.semanticPresent, option === "semanticRegistered");
    assert.equal(registry.legacySemanticPresent, option === "legacySemanticRegistered");
    assert.equal(registry.ordinaryPlacesRetained, option !== "missingPlaces");
    assert.equal(f.prefs.has("fluxion.memory.privacy.health"), false);
  }
});

test("unfinished Places startup fails the privacy gate without opening another window", async () => {
  const f = fixture(); await settle();
  f.tick(21000); await settle();
  assert.equal(f.opened(), 0);
  assert.match(f.prefs.get("fluxion.memory.privacy.error"), /Places startup did not finish/);
  assert.equal(f.prefs.has("fluxion.memory.privacy.health"), false);
});

async function completionFixture({ nativeFailure = false, closeFailure = false, flushFailure = false } = {}) {
  const source = fs.readFileSync(path.join(__dirname, "../chrome/fluxion-memory-privacy-verification.js"), "utf8");
  const start = source.indexOf("  async function closeCompanions() {");
  assert.ok(start > 0);
  const completion = source.slice(start, source.lastIndexOf("})(window);"));
  const events = [], prefs = new Map();
  let flushed = false;
  const target = name => ({ closed: false, close() {
    events.push(name);
    if (closeFailure && name === "private-close") throw Error("private companion close failed");
    this.closed = true;
  } });
  await vm.runInNewContext(completion, {
    companion: target("normal-close"), privateCompanion: target("private-close"),
    prefix: "privacy", report: { checks: [] }, Cu: { reportError() {} },
    run: () => nativeFailure ? Promise.reject(Error("native assertion failed")) : Promise.resolve(),
    waitFor: async predicate => assert.ok(predicate()),
    Services: { prefs: {
      setStringPref(key, value) { events.push(key); prefs.set(key, value); },
      clearUserPref: key => prefs.delete(key),
      savePrefFile() {
        events.push("flush");
        if (flushFailure && !flushed) { flushed = true; throw Error("pref flush failed"); }
      },
    } },
  });
  return { events, prefs };
}

test("privacy verifier closes owned companions before persisting success", async () => {
  const result = await completionFixture();
  assert.deepEqual(result.events, ["private-close", "normal-close", "privacy.report", "privacy.health", "flush"]);
  assert.equal(result.prefs.has("privacy.error"), false);
});

test("privacy cleanup failure cannot pass and does not hide the native assertion", async () => {
  const cleanup = await completionFixture({ closeFailure: true });
  assert.equal(cleanup.prefs.has("privacy.health"), false);
  assert.match(cleanup.prefs.get("privacy.error"), /private companion close failed/);
  assert.ok(cleanup.events.includes("normal-close"));
  const both = await completionFixture({ closeFailure: true, nativeFailure: true });
  assert.match(both.prefs.get("privacy.error"), /native assertion failed/);
  assert.equal(both.prefs.has("privacy.health"), false);
});

test("privacy success-pref flush failure clears the marker before error persistence", async () => {
  const result = await completionFixture({ flushFailure: true });
  assert.equal(result.prefs.has("privacy.health"), false);
  assert.match(result.prefs.get("privacy.error"), /pref flush failed/);
});
