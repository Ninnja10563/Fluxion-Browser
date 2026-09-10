"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function fixture() {
  let finishFlush;
  const flushing = new Promise(resolve => { finishFlush = resolve; });
  const events = new Map();
  const attributes = new Map();
  const preferences = new Map();
  const prefObservers = new Map();
  const setPref = (key, value) => {
    preferences.set(key, value);
    prefObservers.get(key)?.observe();
  };
  const calls = { prepare: 0, discard: 0 };
  const tab = {
    linkedBrowser: { getAttribute: () => "" }, linkedPanel: "panel", lastAccessed: 1,
    hasAttribute: key => attributes.has(key),
    setAttribute: (key, value) => attributes.set(key, value),
    removeAttribute: key => attributes.delete(key),
  };
  const gBrowser = {
    tabs: [tab], selectedTab: {},
    tabContainer: { addEventListener() {}, dispatchEvent() {} },
    prepareDiscardBrowser() { calls.prepare += 1; return flushing; },
    discardBrowser(target, force) {
      assert.equal(target, tab);
      assert.equal(force, false);
      calls.discard += 1;
      return true;
    },
  };
  const window = {
    setTimeout: () => 1, clearTimeout() {},
    addEventListener: (type, callback) => events.set(type, callback),
  };
  const context = vm.createContext({
    window, gBrowser,
    ChromeUtils: { importESModule: () => ({ PrivateBrowsingUtils: { isWindowPrivate: () => false } }) },
    Services: {
      env: { get: () => "" },
      prefs: {
        getIntPref: (key, fallback) => preferences.get(key) ?? fallback,
        setIntPref: setPref,
        addObserver: (key, observer) => prefObservers.set(key, observer),
        removeObserver: key => prefObservers.delete(key),
        setStringPref() {}, savePrefFile() {},
      },
    },
    Cu: { reportError: error => { throw error; } },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
  });
  for (const name of ["core/tab-sleeping.js", "fluxion-tab-sleeping.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../chrome", name), "utf8"), context);
  }
  return { controller: window.FluxionTabSleeping, tab, calls, finishFlush, gBrowser, attributes, preferences,
    setPref: value => setPref("fluxion.tabs.sleepMinutes", value),
    unload: () => events.get("unload")() };
}

for (const [name, change] of [
  ["audio starts", f => { f.tab.soundPlaying = true; }],
  ["picture-in-picture starts", f => { f.tab.pictureinpicture = true; }],
  ["capture starts", f => { f.tab.sharingState = { camera: true }; }],
  ["tab becomes pinned", f => { f.tab.pinned = true; }],
  ["tab enters split view", f => { f.tab.splitview = {}; }],
  ["tab is selected", f => { f.gBrowser.selectedTab = f.tab; }],
  ["navigation starts", f => { f.attributes.set("busy", "true"); }],
  ["Never is selected", f => f.controller.setMinutes(0)],
  ["another window selects Never", f => f.preferences.set("fluxion.tabs.sleepMinutes", 0)],
  ["another window changes and restores the interval", f => { f.setPref(0); f.setPref(30); }],
  ["tab moves to another window", f => { f.gBrowser.tabs = []; }],
  ["browser is replaced", f => { f.tab.linkedBrowser = {}; }],
  ["window closes", f => f.unload()],
]) {
  test(`sleep cancels when ${name} during SessionStore flushing`, async () => {
    const f = fixture();
    const pending = f.controller.sleep(f.tab);
    assert.equal(f.calls.prepare, 1);
    change(f);
    f.finishFlush();
    assert.equal(await pending, false);
    assert.equal(f.calls.discard, 0);
  });
}

test("concurrent sleep calls flush and discard an eligible tab only once", async () => {
  const f = fixture();
  const pending = f.controller.sleep(f.tab);
  assert.equal(await f.controller.sleep(f.tab), false);
  assert.equal(f.calls.prepare, 1);
  f.finishFlush();
  assert.equal(await pending, true);
  assert.equal(f.calls.discard, 1);
  assert.equal(f.attributes.get("fluxion-sleeping"), "true");
});
