"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), vm = require("node:vm");
const source = fs.readFileSync(require.resolve("../chrome/fluxion-peek.js"), "utf8");
const policySource = fs.readFileSync(require.resolve("../chrome/core/peek.js"), "utf8");
function fixture() {
  class Events {
    constructor() { this.events = new Map(); }
    addEventListener(type, fn) { this.events.set(type, [...(this.events.get(type) || []), fn]); }
    removeEventListener(type, fn) { this.events.set(type, (this.events.get(type) || []).filter(item => item !== fn)); }
    emit(type, target) { for (const fn of [...(this.events.get(type) || [])]) fn({ type, target }); }
    dispatchEvent(event) { this.emit(event.type, this); }
  }
  const window = new Events(), tabContainer = new Events(), tabs = [], removals = [], splits = [], selections = [];
  const add = () => {
    const attrs = new Map(), tab = { parentNode: tabContainer, ownerGlobal: window, linkedBrowser: {}, workspace: "one",
      hasAttribute: key => attrs.has(key), setAttribute: (key, value) => attrs.set(key, value), removeAttribute: key => attrs.delete(key) };
    tabs.push(tab); return tab;
  };
  const original = add(), other = add(); let selected = original;
  const gBrowser = { tabs, tabContainer,
    get selectedTab() { return selected; },
    set selectedTab(tab) { if (selected !== tab) { selected = tab; selections.push(tab); tabContainer.emit("TabSelect", tab); } },
    getTabForBrowser: browser => tabs.find(tab => tab.parentNode && tab.linkedBrowser === browser),
    addTrustedTab: add,
    removeTab(tab, options) {
      removals.push({ tab, options });
      tab.duringClose?.();
      if (tab.throwClose) throw Error("native close failed");
      if (tab.cancelClose || tab.deferClose) return;
      commit(tab);
    },
    removeTabs(items, options) { for (const tab of items) this.removeTab(tab, options); },
  };
  function commit(tab) {
    tab.closing = true; tabContainer.emit("TabClose", tab); tab.parentNode = null;
    if (selected === tab) gBrowser.selectedTab = other;
  }
  Object.assign(window, { document: { getElementById: () => null },
    FluxionUI: { setTabWorkspace: (tab, value) => { tab.workspace = value; }, tabWorkspace: tab => tab.workspace,
      createSplitView: (a, b) => { splits.push([a, b]); } },
    openLinkIn(url, where, params) { const tab = add(); params.resolveOnNewTabCreated(tab.linkedBrowser); },
    gContextMenu: { linkURL: "https://example.org/peek", browser: original.linkedBrowser,
      _getGlobalHistoryOptions: () => ({}), _openLinkInParameters: options => options },
  });
  const context = vm.createContext({ window, gBrowser, SessionStore: { persistTabAttribute() {} },
    Services: { prefs: { setStringPref() {}, savePrefFile() {} }, env: { get: () => "" } },
    CustomEvent: class { constructor(type) { this.type = type; } }, URL });
  vm.runInContext(policySource + source, context);
  return { window, api: window.FluxionPeek, original, other, gBrowser, tabContainer, removals, splits, selections, commit,
    open() { window.FluxionPeek.openContextLink(); return tabs.at(-1); }, context };
}

test("canceled Peek close retains its source, marker, selection and Open Beside capability", () => {
  const f = fixture(), peek = f.open(); peek.cancelClose = true;
  assert.equal(f.api.close(peek), true, "handled attempt prevents an ordinary-tab fallback retry");
  assert.equal(f.removals.length, 1);
  assert.equal(f.gBrowser.selectedTab, peek, "cancellation must not navigate back to the source first");
  assert.equal(f.api.isPeek(peek), true); assert.ok(peek.parentNode);
  assert.equal(f.api.openBeside(), true, "default active Peek and its original source both survive");
  assert.deepEqual(f.splits, [[f.original, peek]]);
  assert.equal(f.api.isPeek(peek), false);
});

test("shipped generic close dispatcher does not retry a canceled Peek without temporary-tab semantics", () => {
  const f = fixture(), peek = f.open(); peek.cancelClose = true;
  const chrome = fs.readFileSync(require.resolve("../chrome/fluxion-chrome.js"), "utf8");
  const begin = chrome.indexOf("  function closeTabs(tabs,"), end = chrome.indexOf("  function vectorGlyph", begin);
  assert.ok(begin >= 0 && end > begin); vm.runInContext(chrome.slice(begin, end), f.context);
  f.context.closeTabs([peek], { animate: false });
  assert.equal(f.removals.length, 1);
  assert.equal(f.removals[0].options.skipSessionStore, true);
  assert.equal(f.removals[0].options.skipPermitUnload, undefined);
  assert.equal(f.api.openBeside(peek), true);
});

test("nested TabSelect during native permitUnload neither recurses nor forgets canceled state", () => {
  const f = fixture(), peek = f.open(); peek.cancelClose = true;
  peek.duringClose = () => { f.gBrowser.selectedTab = f.other; };
  f.api.close(peek, { returnToSource: false });
  assert.equal(f.removals.length, 1);
  assert.equal(f.gBrowser.selectedTab, f.other, "a genuine nested selection is not undone");
  assert.equal(f.api.openBeside(peek), true);
  assert.deepEqual(f.splits, [[f.original, peek]]);
});

test("successful close clears state and returns to a live source only after native commitment", () => {
  const f = fixture(), peek = f.open();
  peek.duringClose = () => assert.equal(f.gBrowser.selectedTab, peek);
  assert.equal(f.api.close(peek), true);
  assert.equal(f.removals.length, 1); assert.equal(f.gBrowser.selectedTab, f.original);
  assert.equal(f.api.close(), false); assert.equal(f.api.openBeside(peek), false);
});

test("direct or deferred native TabClose clears Peek ownership without a second removal", () => {
  for (const deferred of [false, true]) {
    const f = fixture(), peek = f.open();
    if (deferred) { peek.deferClose = true; f.api.close(peek); assert.equal(f.api.isPeek(peek), true); }
    f.commit(peek);
    assert.equal(f.removals.length, deferred ? 1 : 0);
    assert.equal(f.api.close(), false); assert.equal(f.api.openBeside(peek), false);
  }
});

test("native failures release the in-flight guard but retain the recoverable Peek source", () => {
  const f = fixture(), peek = f.open(); peek.throwClose = true;
  assert.throws(() => f.api.close(peek), /native close failed/);
  peek.throwClose = false; peek.cancelClose = true;
  assert.equal(f.api.close(peek), true); assert.equal(f.removals.length, 2);
  assert.equal(f.api.openBeside(peek), true);
});

test("closing one Peek cannot forget a newer active Peek, and a missing source browser is ignored", () => {
  const f = fixture(), first = f.open(); first.cancelClose = true;
  const second = f.open();
  f.commit(first);
  second.cancelClose = true;
  assert.equal(f.api.close(), true);
  assert.equal(f.removals.at(-1).tab, second);
  second.cancelClose = false; f.original.linkedBrowser = null;
  f.api.close(second);
  assert.equal(f.gBrowser.selectedTab, f.other);
});

test("successful close does not select a detached or other-window source", () => {
  for (const adopted of [false, true]) {
    const f = fixture(), peek = f.open();
    if (adopted) {
      f.gBrowser.tabs.splice(f.gBrowser.tabs.indexOf(f.original), 1);
      f.original.parentNode = { otherWindow: true };
    } else f.original.parentNode = null;
    f.api.close(peek);
    assert.equal(f.gBrowser.selectedTab, f.other);
    assert.equal(f.removals.length, 1);
  }
});

test("automatic departure that is canceled leaves the Peek available for subsequent promotion", () => {
  const f = fixture(), peek = f.open(); peek.cancelClose = true;
  f.gBrowser.selectedTab = f.other;
  assert.equal(f.removals.length, 1);
  assert.equal(f.api.isPeek(peek), true);
  assert.equal(f.api.promote(), true, "cancellation retained the active default target");
  assert.equal(f.api.isPeek(peek), false);
  f.gBrowser.selectedTab = f.original;
  assert.equal(f.removals.length, 1, "promoted tab is no longer auto-closed");
});

test("ordinary tabs are not consumed and unload releases native listeners", () => {
  const f = fixture();
  assert.equal(f.api.close(f.original), false); assert.equal(f.removals.length, 0);
  f.window.emit("unload", f.window);
  assert.equal(f.tabContainer.events.get("TabSelect").length, 0);
  assert.equal(f.tabContainer.events.get("TabClose").length, 0);
});
