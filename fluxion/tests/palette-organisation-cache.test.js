"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const organisation = require("../chrome/core/tab-organisation.js");
const source = fs.readFileSync(require.resolve("../chrome/fluxion-palette.js"), "utf8");
const extract = (begin, end) => source.slice(source.indexOf(begin), source.indexOf(end, source.indexOf(begin)));
function fixture() {
  let workspace = "research", calls = 0, parses = 0, onConfirm = () => true;
  const groups = [], confirmations = [];
  const makeTab = index => ({ label: `React guide ${index}`, workspace: "research", parentNode: {}, pinned: false,
    group: null, splitview: null, linkedBrowser: { currentURI: { spec: `https://react.example.test/guide/${index}` } }, getAttribute: () => "" });
  const tabs = Array.from({ length: 6 }, (_, index) => makeTab(index));
  const context = vm.createContext({ organisationCache: null, gBrowser: { tabs },
    layer: { hidden: false, remove() {} }, style: { remove() {} }, cleanup: [],
    URL: function(value) { parses++; return new URL(value); },
    FluxionTabOrganisation: { suggestGroup: records => { calls++; return organisation.suggestGroup(records); } },
    ui: { currentWorkspace: () => workspace, tabWorkspace: tab => tab.workspace,
      createSuggestedGroup: (...args) => groups.push(args) },
    Services: { prompt: { confirm: (...args) => { confirmations.push(args); return onConfirm(); } } },
    window: { clearTimeout() {}, requestAnimationFrame() {}, FluxionSplitViews: { SIDE_BY_SIDE: "side-by-side" } },
    document: { activeElement: null }, activeIndex: 0, visibleItems: [], lastFocus: null, mode: "all",
    splitSource: null, pendingSplitOrientation: "side-by-side", askBrowser: null, compareBrowsers: [],
    placesTimer: 0, memoryRequest: 0, aiRequest: 0, askController: null,
    input: { value: "", removeAttribute() {} }, render() {}, on: (_target, _event, fn) => { context.unload = fn; } });
  vm.runInContext(extract("  function sameOrganisationRecord(", "  function commandItems()") +
    extract("  function open(nextMode", "  function openSplitPicker(") +
    extract("  function close()", '  on(input, "input"') +
    extract('  on(window, "unload",', "  window.FluxionPalette ="), context);
  return { context, tabs, groups, confirmations, makeTab, calls: () => calls, parses: () => parses,
    suggestion: () => context.organisationSuggestion(), apply: () => context.applyOrganisationSuggestion(),
    setWorkspace: value => { workspace = value; }, confirm: fn => { onConfirm = fn; } };
}

test("open palette reuses grouping analysis and URL parsing only while exact ordered live metadata agrees", () => {
  const f = fixture(), first = f.suggestion();
  assert.ok(first); assert.equal(f.calls(), 1); assert.equal(f.parses(), 6);
  for (let i = 0; i < 20; i++) assert.equal(f.suggestion(), first);
  assert.equal(f.calls(), 1); assert.equal(f.parses(), 6);
  f.tabs[2].label = "Changed title with no native notification";
  assert.notEqual(f.suggestion(), first); assert.equal(f.calls(), 2); assert.equal(f.parses(), 7);
});

test("all grouping-relevant changes and tab ownership/order invalidate without relying on event delivery", () => {
  for (const mutate of [
    f => { f.tabs[0].label = "Different title"; },
    f => { f.tabs[0].linkedBrowser.currentURI.spec = "https://other.example.test/new"; },
    f => { f.tabs[0].pinned = true; }, f => { f.tabs[0].group = {}; }, f => { f.tabs[0].splitview = {}; },
    f => { f.tabs[0].workspace = "elsewhere"; }, f => { f.tabs[0].closing = true; },
    f => { f.tabs.shift().parentNode = null; }, f => f.tabs.push(f.makeTab(7)), f => f.tabs.reverse(),
    f => { f.context.gBrowser.tabs = f.tabs.map((tab, i) => i ? tab : { ...tab }); },
    f => f.setWorkspace("elsewhere"),
  ]) {
    const f = fixture(); f.suggestion(); mutate(f); f.suggestion();
    assert.equal(f.calls(), 2);
  }
  const empty = fixture(); empty.tabs.splice(0); assert.equal(empty.suggestion(), null);
  assert.equal(empty.suggestion(), null); assert.equal(empty.calls(), 1, "cache a genuine no-suggestion result too");
});

test("shipped close, reopen and unload clear retained tab references; closed palettes never cache", () => {
  const f = fixture(); f.suggestion(); assert.ok(f.context.organisationCache);
  f.context.close(); assert.equal(f.context.organisationCache, null);
  f.suggestion(); f.suggestion(); assert.equal(f.calls(), 3); assert.equal(f.context.organisationCache, null);
  f.context.open("all"); f.suggestion(); assert.ok(f.context.organisationCache);
  f.context.open("all"); assert.equal(f.context.organisationCache, null);
  f.suggestion(); f.context.unload(); assert.equal(f.context.organisationCache, null);
  const other = fixture(); other.suggestion(); assert.equal(other.calls(), 1, "windows do not share cached tabs");
});

test("confirmation uses fresh live metadata rather than the palette's old suggestion", () => {
  const f = fixture(); f.suggestion(); f.context.close();
  f.tabs[0].label = "Revised consent title";
  f.apply();
  assert.equal(f.groups.length, 1); assert.match(f.confirmations[0][2], /Revised consent title/);
  assert.equal(f.calls(), 3, "fresh analysis before and after native confirmation");
  assert.equal(f.context.organisationCache, null);
});

test("native confirmation cancellation or nested-loop target changes cannot apply a stale group", () => {
  for (const mutate of [
    f => { f.tabs[0].label = "Changed during consent"; },
    f => { f.tabs[0].linkedBrowser.currentURI.spec = "https://elsewhere.test/"; },
    f => { f.tabs[0].pinned = true; }, f => { f.tabs[0].group = {}; }, f => { f.tabs[0].splitview = {}; },
    f => { f.tabs[0].workspace = "elsewhere"; }, f => { f.tabs.shift().parentNode = null; },
    f => f.setWorkspace("elsewhere"),
  ]) {
    const f = fixture(); f.suggestion(); f.context.close(); f.confirm(() => { mutate(f); return true; });
    f.apply(); assert.equal(f.confirmations.length, 1); assert.deepEqual(f.groups, []);
  }
  const canceled = fixture(); canceled.context.close(); canceled.confirm(() => false); canceled.apply();
  assert.equal(canceled.calls(), 1); assert.deepEqual(canceled.groups, []);
});
