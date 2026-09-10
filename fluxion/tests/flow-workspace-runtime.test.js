"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "../chrome/fluxion-chrome.js"), "utf8");
function block(start, end) {
  const begin = source.indexOf(start), finish = source.indexOf(end, begin);
  assert.ok(begin >= 0 && finish > begin);
  return source.slice(begin, finish);
}
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

function selectionFixture() {
  const listeners = new Map(), errors = [];
  const a = { id: "a", parentNode: {}, hidden: false }, b = { id: "b", parentNode: {}, hidden: true };
  let selected = a;
  const gBrowser = { tabs: [a, b], tabContainer: {}, showTab: tab => { tab.hidden = false; },
    hideTab: tab => { tab.hidden = true; } };
  Object.defineProperty(gBrowser, "selectedTab", { get: () => selected, set(tab) {
    selected = tab; listeners.get("TabSelect")?.();
  } });
  const context = vm.createContext({ gBrowser, window: {}, workspaces: [{ id: "a" }, { id: "b" }],
    currentWorkspace: "a", sessionRestoreSettled: true, workspaceSwitchDepth: 0, workspaceSelectionQueued: false,
    privateWindow: false, PREF_CURRENT: "current", Cu: { reportError: error => errors.push(error) },
    storedTabWorkspace: tab => tab.id, tabWorkspace: tab => tab.id,
    rememberWorkspaceTab() {}, scheduleRender() {}, preferredWorkspaceTab: (_id, tabs) => tabs[0],
    Services: { prefs: { setStringPref() {} } }, SessionStore: { setCustomWindowValue() {} },
    FluxionWorkspaceTabs: { WINDOW_VALUE_KEY: "workspace" },
    on(_target, type, listener) { listeners.set(type, listener); },
  });
  vm.runInContext(block("  function switchWorkspace(", "  function cycleWorkspace(") +
    block('  on(gBrowser.tabContainer, "TabSelect", () => {', '  for (const eventName of [\n    "TabSelect", "SplitViewCreated"'), context);
  return { context, gBrowser, a, b, errors, emit: type => listeners.get(type)?.() };
}

test("native selection and late SessionStore restoration reveal the selected tab's workspace", async () => {
  const f = selectionFixture();
  f.gBrowser.selectedTab = f.b;
  await settle();
  assert.equal(f.context.currentWorkspace, "b");
  assert.equal(f.b.hidden, false); assert.equal(f.a.hidden, true);
  f.context.switchWorkspace("a");
  f.b.id = "a";
  f.gBrowser.selectedTab = f.b;
  await settle();
  f.b.id = "b"; f.emit("SSTabRestored"); await settle();
  assert.equal(f.context.currentWorkspace, "b");
  assert.ok(f.gBrowser.selectedTab === f.b);
  assert.deepEqual(f.errors, []);
});

test("initial restoration and intentional workspace transitions are not overridden by queued selection", async () => {
  const f = selectionFixture();
  f.context.sessionRestoreSettled = false;
  f.gBrowser.selectedTab = f.b; await settle();
  assert.equal(f.context.currentWorkspace, "a");
  f.context.sessionRestoreSettled = true;
  f.emit("SSTabRestored");
  f.context.switchWorkspace("a");
  await settle();
  assert.equal(f.context.currentWorkspace, "a");
  assert.ok(f.gBrowser.selectedTab === f.a);
  assert.equal(f.context.workspaceSwitchDepth, 0);
  f.gBrowser.selectedTab = f.b;
  f.b.parentNode = null;
  await settle();
  assert.equal(f.context.currentWorkspace, "a");
});

test("Flow Recently Closed uses the same selection reconciliation as native undo-close", async () => {
  const f = selectionFixture();
  f.context.closedTabs = () => [{ sourceIndex: 0 }];
  f.context.SessionStore.undoCloseTab = (_window, index) => {
    assert.equal(index, 0);
    f.gBrowser.selectedTab = f.b;
    return f.b;
  };
  vm.runInContext(block("  function reopenClosedTab(", "  function populateRecentlyClosedPopup("), f.context);
  assert.ok(f.context.reopenClosedTab(0) === f.b);
  await settle();
  assert.equal(f.context.currentWorkspace, "b");
  assert.equal(f.b.hidden, false);
  assert.equal(f.context.reopenClosedTab(9), null);
});

function buttonsFixture() {
  const document = { body: {}, documentElement: {}, activeElement: null };
  class Element {
    constructor() { this.children = []; this.listeners = {}; this.attrs = {}; this.style = { setProperty() {} }; }
    get firstChild() { return this.children[0]; }
    get isConnected() { return this === list || Boolean(this.parentNode?.isConnected); }
    append(...nodes) { for (const node of nodes) this.insertBefore(node, null); }
    insertBefore(node, before) {
      node.remove();
      this.children.splice(before ? this.children.indexOf(before) : this.children.length, 0, node);
      node.parentNode = this;
    }
    remove() {
      if (!this.parentNode) return;
      this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1); this.parentNode = null;
      if (document.activeElement === this) document.activeElement = document.body;
    }
    replaceWith(node) { this.parentNode.insertBefore(node, this); this.remove(); }
    setAttribute(name, value) { this.attrs[name] = value; }
    addEventListener(type, listener) { this.listeners[type] = listener; }
    focus() { document.activeElement = this; }
  }
  const list = new Element(), map = new Map();
  const workspaces = ["a", "b", "c"].map(id => ({ id, name: id, icon: "circle", accent: "slate" }));
  const switches = [];
  const context = vm.createContext({ document, workspaces, currentWorkspace: "a", workspaceRenderSignature: "",
    workspaceList: list, workspaceElements: map, addWorkspaceButton: {}, create: () => new Element(),
    workspaceSymbol: () => new Element(), FluxionWorkspaces: { MAX_WORKSPACES: 20 },
    FluxionFlowNavigation: require("../chrome/core/flow-navigation.js"), switchWorkspace: id => switches.push(id),
  });
  vm.runInContext(block("  function renderWorkspaces()", "  function render()"), context);
  context.renderWorkspaces();
  return { context, document, list, map, switches };
}

test("workspace metadata refresh retains focused button and label identity; reordered arrows use live indices", () => {
  const f = buttonsFixture(), b = f.map.get("b"), label = b._fluxionWorkspaceLabel;
  b.focus();
  f.context.workspaces = [f.context.workspaces[1], f.context.workspaces[2], f.context.workspaces[0]];
  f.context.workspaces[0] = { ...f.context.workspaces[0], name: "Renamed", icon: "square" };
  f.context.renderWorkspaces();
  assert.ok(f.map.get("b") === b); assert.ok(b._fluxionWorkspaceLabel === label);
  assert.ok(f.document.activeElement === b); assert.equal(label.textContent, "Renamed");
  b.listeners.keydown({ key: "ArrowRight", preventDefault() {}, stopPropagation() {} });
  assert.deepEqual(f.switches, ["c"]);
});

test("deleted workspace focus falls back only when the workspace strip owned focus", () => {
  for (const owned of [true, false]) {
    const f = buttonsFixture(), external = {};
    if (owned) f.map.get("b").focus(); else f.document.activeElement = external;
    f.context.workspaces = f.context.workspaces.filter(item => item.id !== "b");
    f.context.renderWorkspaces();
    assert.ok(f.document.activeElement === (owned ? f.map.get("a") : external));
    assert.equal(f.map.has("b"), false);
  }
});

test("Flow tab and group context keys anchor the native menu to the focused item without selecting or collapsing", () => {
  for (const grouped of [false, true]) {
    for (const key of ["ContextMenu", "F10"]) {
      const listeners = {}, popupCalls = [], focusCalls = [];
      const tab = {}, group = { collapsed: true }, oldTab = {}, oldGroup = {};
      const anchor = { closest: () => null, addEventListener: (type, listener) => { listeners[type] = listener; } };
      const context = vm.createContext({ item: anchor, heading: anchor, tab, group,
        contextTab: oldTab, contextGroup: oldGroup,
        contextMenu: { openPopup: (...args) => popupCalls.push(args) },
        groupMenu: { openPopup: (...args) => popupCalls.push(args) },
        focusFlowItem: node => focusCalls.push(node),
        FluxionFlowNavigation: require("../chrome/core/flow-navigation.js"),
        select: () => assert.fail("Opening a context menu must not select a tab"),
        scheduleRender: () => assert.fail("Opening a group menu must not rebuild its anchor"),
        activateTabAudio: () => assert.fail("Context key must not activate audio"),
      });
      const node = grouped ? "heading" : "item";
      vm.runInContext(block(`    ${node}.addEventListener("keydown", event => {`,
        `    ${node}.addEventListener("contextmenu", event => {`), context);
      let prevented = 0, stopped = 0;
      listeners.keydown({ key, shiftKey: key === "F10",
        preventDefault() { prevented++; }, stopPropagation() { stopped++; } });
      assert.equal(prevented, 1); assert.equal(stopped, 1);
      assert.deepEqual(focusCalls, [anchor]);
      assert.deepEqual(popupCalls, [[anchor, "after_start", 0, 0, true]]);
      assert.equal(context.contextTab, grouped ? oldTab : tab);
      assert.equal(context.contextGroup, grouped ? group : oldGroup);
      assert.equal(group.collapsed, true);
      popupCalls.length = 0; focusCalls.length = 0;
      listeners.keydown({ key: "F10", shiftKey: false,
        preventDefault() { assert.fail("Plain F10 belongs to native menu navigation"); },
        stopPropagation() { assert.fail("Plain F10 must propagate"); } });
      assert.equal(popupCalls.length, 0); assert.equal(focusCalls.length, 0);
    }
  }
});
