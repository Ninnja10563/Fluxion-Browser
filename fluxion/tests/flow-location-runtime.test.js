"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../chrome/fluxion-chrome.js"), "utf8");
function block(start, end) {
  const first = source.indexOf(start), last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first, `Missing shipped boundaries: ${start}`);
  return source.slice(first, last);
}
function fixture() {
  const tabs = Array.from({ length: 4 }, (_, id) => ({ id, parentNode: {}, linkedBrowser: {}, closing: false }));
  const tabElements = new Map(tabs.slice(0, 3).map(tab => [tab, { isConnected: true, tab }]));
  const refreshes = [], frames = [], registrations = [], removals = [], unload = [];
  let renders = 0;
  const window = { requestAnimationFrame: callback => frames.push(callback) };
  const gBrowser = { selectedTab: tabs[0], getTabForBrowser: browser => tabs.find(tab => tab.linkedBrowser === browser),
    addTabsProgressListener: listener => registrations.push(listener), removeTabsProgressListener: listener => removals.push(listener) };
  const context = vm.createContext({ window, gBrowser, tabElements, dirtyTabs: new Set(), closingTabs: new Set(),
    structureDirty: false, renderQueued: false, selectionDirty: false, pointerCloseHold: null,
    flowMenuSession: null, renderDeferredForClose: false, updateWindowTitle() {}, syncHeldTabSelection() {},
    refreshFlowSelection: () => true, render: () => { renders++; },
    refreshTabElement: (tab, item) => refreshes.push({ tab, item }),
    on(target, type, listener, options) {
      assert.equal(target, window); assert.equal(type, "unload"); assert.equal(options.once, true); unload.push(listener);
    },
  });
  // Integrate the actual shipped location listener with the real content-only
  // scheduling branch. Row rendering is a recorder: native URL/tooltips are
  // verified separately by the packaged browser gate.
  vm.runInContext(block("  function scheduleRender(", "  const popupSet =") +
    block("  const flowProgressListener =", '  on(gBrowser.tabContainer, "TabSelect", () => {'), context);
  assert.equal(registrations.length, 1);
  const listener = registrations[0];
  return { tabs, tabElements, frames, refreshes, removals, unload, listener,
    location(tab, progress = { isTopLevel: true }) { listener.onLocationChange(tab.linkedBrowser, progress); },
    flush() { while (frames.length) frames.shift()(); }, get renders() { return renders; } };
}
test("selected and background top-level locations refresh only their existing rows without rebuilding", () => {
  const f = fixture(), identities = new Map(f.tabElements);
  f.location(f.tabs[0]); f.location(f.tabs[1]); f.flush();
  assert.deepEqual(f.refreshes.map(item => item.tab), f.tabs.slice(0, 2));
  for (const item of f.refreshes) assert.equal(item.item, identities.get(item.tab));
  assert.equal(f.renders, 0);
  assert.equal(f.refreshes.some(item => item.tab === f.tabs[2]), false);
});
test("repeated same-document location notifications coalesce into one target refresh per frame", () => {
  const f = fixture();
  for (let index = 0; index < 50; index++) f.location(f.tabs[1]);
  assert.equal(f.frames.length, 1); f.flush();
  assert.equal(f.refreshes.length, 1); assert.equal(f.refreshes[0].tab, f.tabs[1]);
  f.location(f.tabs[1]); f.flush();
  assert.equal(f.refreshes.length, 2); assert.equal(f.renders, 0);
});
test("subframes, missing progress, closing, detached, unknown and unrendered tabs do not schedule work", () => {
  const f = fixture();
  f.location(f.tabs[0], { isTopLevel: false }); f.location(f.tabs[0], null);
  f.tabs[1].closing = true; f.location(f.tabs[1]);
  f.tabs[2].parentNode = null; f.location(f.tabs[2]);
  f.listener.onLocationChange({}, { isTopLevel: true });
  f.location(f.tabs[3]);
  assert.equal(f.frames.length, 0); assert.equal(f.refreshes.length, 0); assert.equal(f.renders, 0);
});
test("a row detached before its scheduled location refresh is not rendered", () => {
  const f = fixture(); f.location(f.tabs[1]);
  f.tabs[1].parentNode = null; f.tabElements.get(f.tabs[1]).isConnected = false; f.flush();
  assert.equal(f.refreshes.length, 0); assert.equal(f.renders, 0);
});
test("unload unregisters the exact installed progress listener", () => {
  const f = fixture(); assert.equal(f.unload.length, 1);
  f.unload[0](); assert.deepEqual(f.removals, [f.listener]);
});
