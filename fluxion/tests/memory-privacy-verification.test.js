"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const settle = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
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
      setStringPref: (name, value) => prefs.set(name, value), savePrefFile() {},
    } },
    ChromeUtils: { importESModule(name) {
      imports.push(name);
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
  assert.equal(f.imports.length, 1);
  f.startup._placesBrowserInitComplete = true;
  f.tick(); await settle();
  assert.equal(f.opened(), 1);
  const report = JSON.parse(f.prefs.get("fluxion.memory.privacy.report"));
  assert.equal(report.placesStartupComplete, true);
  assert.match(f.prefs.get("fluxion.memory.privacy.error"), /test stopped after verified startup barrier/);
  assert.equal(f.prefs.has("fluxion.memory.privacy.health"), false);
});

test("unfinished Places startup fails the privacy gate without opening another window", async () => {
  const f = fixture(); await settle();
  f.tick(21000); await settle();
  assert.equal(f.opened(), 0);
  assert.match(f.prefs.get("fluxion.memory.privacy.error"), /Places startup did not finish/);
  assert.equal(f.prefs.has("fluxion.memory.privacy.health"), false);
});
