"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "../chrome/fluxion-chrome.js"), "utf8");
const WORKSPACE = "fluxion-workspace", ACTIVE = "fluxion-workspace-active";
function block(start, end) {
  const first = source.indexOf(start), last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first);
  return source.slice(first, last);
}
function fixture(count = 1000, privateWindow = false) {
  const reads = [], writes = [], errors = [], mutations = [], listeners = new Map(), switches = [];
  const tabs = Array.from({ length: count }, (_, id) => ({
    id, parentNode: {}, saved: { [WORKSPACE]: "focus", [ACTIVE]: id === 0 ? "true" : "" },
    attrs: { [WORKSPACE]: "focus", ...(id === 0 ? { [ACTIVE]: "" } : {}) },
    getAttribute(key) { return this.attrs[key] ?? ""; },
    hasAttribute(key) { return Object.hasOwn(this.attrs, key); },
    setAttribute(key, value) { this.attrs[key] = value; mutations.push([id, key, value]); },
    toggleAttribute(key, value) { if (value) this.attrs[key] = ""; else delete this.attrs[key]; mutations.push([id, key, value]); },
  }));
  const SessionStore = {
    getCustomTabValue(tab, key) {
      reads.push([tab.id, key]);
      const failure = tab.readFailures?.[key];
      if (failure?.length && failure.shift()) throw Error(`read ${key}`);
      return tab.saved[key] ?? "";
    },
    setCustomTabValue(tab, key, value) {
      writes.push([tab.id, key, value]);
      if (tab.writeFails) throw Error(`write ${key}`);
      tab.saved[key] = value;
    },
    deleteCustomTabValue(tab, key) { writes.push([tab.id, key, "delete"]); delete tab.saved[key]; },
  };
  const gBrowser = { tabs, selectedTab: tabs[0], tabContainer: {} };
  const context = vm.createContext({ SessionStore, gBrowser, privateWindow,
    TAB_WORKSPACE: WORKSPACE, TAB_WORKSPACE_ACTIVE: ACTIVE,
    currentWorkspace: "focus", workspaces: [{ id: "focus" }, { id: "build" }],
    sessionRestoreSettled: true, workspaceSwitchDepth: 0, workspaceSelectionQueued: false,
    window: { closed: false }, Cu: { reportError: error => errors.push(error.message) },
    FluxionWorkspaceTabs: require("../chrome/core/workspace-tabs.js"),
    switchWorkspace(id) { switches.push(id); },
    on(target, type, listener) { assert.equal(target, gBrowser.tabContainer); listeners.set(type, listener); },
  });
  // No stubbed workspace accessor: run all persistence functions and the actual
  // native selection/restore subscriptions, including deferred reconciliation.
  vm.runInContext(block("  function storedTabWorkspace(tab) {", "  function preferredWorkspaceTab(") +
    block("  function reconcileSelectedWorkspace() {", "  function cycleWorkspace(") +
    block('  on(gBrowser.tabContainer, "TabSelect", () => {', '  for (const eventName of [\n    "TabSelect", "SplitViewCreated"'), context);
  return { context, tabs, gBrowser, reads, writes, errors, mutations, switches,
    emit: type => listeners.get(type)(),
    countReads: key => reads.filter(entry => entry[1] === key).length,
    clear() { reads.length = writes.length = errors.length = mutations.length = 0; },
  };
}
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

test("1000-tab authoritative marker pass reads each candidate workspace once", () => {
  const h = fixture();
  h.context.rememberWorkspaceTab(h.tabs[800]);
  assert.equal(h.countReads(WORKSPACE), 1002); // Target resolution + plan guard + N candidates.
  assert.equal(h.countReads(ACTIVE), 1000);
  assert.deepEqual(h.writes, [[0, ACTIVE, "delete"], [800, ACTIVE, "true"]]);
  h.clear(); h.context.rememberWorkspaceTab(h.tabs[800]);
  assert.equal(h.countReads(WORKSPACE), 1002);
  assert.equal(h.countReads(ACTIVE), 1000);
  assert.deepEqual(h.writes, []);
});

test("actual native selection retains both authoritative passes with bounded workspace reads", async () => {
  const h = fixture(); h.gBrowser.selectedTab = h.tabs[800]; h.emit("TabSelect");
  assert.equal(h.countReads(WORKSPACE), 1003);
  assert.equal(h.countReads(ACTIVE), 1000);
  await settle();
  assert.equal(h.countReads(WORKSPACE), 2006);
  assert.equal(h.countReads(ACTIVE), 2000);
  assert.equal(h.writes.length, 2);
});

test("saved ownership remains authoritative; empty and invalid records are repaired", () => {
  const h = fixture(3);
  h.tabs[0].saved[WORKSPACE] = "build";
  h.tabs[1].saved[WORKSPACE] = ""; h.tabs[1].attrs[WORKSPACE] = "build";
  h.tabs[2].saved[WORKSPACE] = "deleted";
  assert.equal(h.context.tabWorkspace(h.tabs[0]), "build");
  assert.equal(h.context.tabWorkspace(h.tabs[1]), "build");
  assert.equal(h.context.tabWorkspace(h.tabs[2]), "focus");
  assert.equal(h.countReads(WORKSPACE), 3);
  assert.deepEqual(h.writes, [[1, WORKSPACE, "build"], [2, WORKSPACE, "focus"]]);
  assert.equal(h.tabs[0].attrs[WORKSPACE], "build");
  h.clear(); h.context.setTabWorkspace(h.tabs[0], "focus");
  assert.equal(h.countReads(WORKSPACE), 1, "public explicit setter always performs a fresh read");
});

test("failed first read retains fresh setter recovery, repeated failure never blindly overwrites", () => {
  const h = fixture(2);
  h.tabs[0].attrs[WORKSPACE] = "build";
  h.tabs[0].readFailures = { [WORKSPACE]: [true, false] };
  assert.equal(h.context.tabWorkspace(h.tabs[0]), "build");
  assert.equal(h.countReads(WORKSPACE), 2);
  assert.equal(h.tabs[0].saved[WORKSPACE], "build");
  h.clear(); h.tabs[1].attrs[WORKSPACE] = "build";
  h.tabs[1].readFailures = { [WORKSPACE]: [true, true] };
  assert.equal(h.context.tabWorkspace(h.tabs[1]), "build");
  assert.equal(h.countReads(WORKSPACE), 2);
  assert.equal(h.tabs[1].saved[WORKSPACE], "focus");
  assert.deepEqual(h.writes, []); assert.equal(h.errors.length, 1);
});

test("failed writes do not cache success and later calls observe fresh restored values", () => {
  const h = fixture(1), tab = h.tabs[0];
  tab.saved[WORKSPACE] = ""; tab.attrs[WORKSPACE] = "build"; tab.writeFails = true;
  h.context.tabWorkspace(tab);
  assert.equal(h.errors.length, 1); assert.equal(tab.saved[WORKSPACE], "");
  tab.writeFails = false; h.context.tabWorkspace(tab);
  assert.equal(tab.saved[WORKSPACE], "build");
  tab.saved[WORKSPACE] = "focus";
  assert.equal(h.context.tabWorkspace(tab), "focus");
  assert.equal(h.countReads(WORKSPACE), 3);
});

test("deferred pass repairs late duplicate markers and observes changed restored ownership", async () => {
  const h = fixture(4); h.gBrowser.selectedTab = h.tabs[2]; h.emit("TabSelect");
  h.tabs[1].saved[ACTIVE] = "true";
  await settle();
  assert.equal(h.tabs[1].saved[ACTIVE], undefined);
  assert.equal(h.tabs[2].saved[ACTIVE], "true");
  h.emit("SSTabRestored"); h.tabs[2].saved[WORKSPACE] = "build";
  await settle();
  assert.deepEqual(h.switches, ["build"]);
});

test("rapid selections, detached targets and intentional transitions keep reconciliation guards", async () => {
  const h = fixture(4);
  h.gBrowser.selectedTab = h.tabs[1]; h.emit("TabSelect");
  h.gBrowser.selectedTab = h.tabs[2]; h.emit("TabSelect"); await settle();
  assert.equal(h.tabs.filter(tab => tab.saved[ACTIVE] === "true").length, 1);
  assert.equal(h.tabs[2].saved[ACTIVE], "true");
  h.emit("SSTabRestored"); h.tabs[2].parentNode = null; h.clear(); await settle();
  assert.deepEqual(h.reads, []);
  h.gBrowser.selectedTab = h.tabs[3]; h.context.workspaceSwitchDepth = 1;
  h.emit("SSTabRestored"); await settle(); assert.deepEqual(h.reads, []);
});

test("separate window instances and other workspaces retain independent in-memory markers", () => {
  const normal = fixture(3), privateWindow = fixture(3, true);
  normal.tabs[1].saved[WORKSPACE] = "build"; normal.tabs[1].saved[ACTIVE] = "true";
  normal.context.rememberWorkspaceTab(normal.tabs[2]);
  assert.equal(normal.tabs[1].saved[ACTIVE], "true");
  assert.equal(privateWindow.tabs[0].saved[ACTIVE], "true");
  privateWindow.context.rememberWorkspaceTab(privateWindow.tabs[1]);
  assert.equal(privateWindow.tabs[1].saved[ACTIVE], "true");
  assert.equal(normal.tabs[2].saved[ACTIVE], "true");
  const tab = normal.tabs[2]; tab.parentNode = null; normal.clear();
  assert.equal(normal.context.rememberWorkspaceTab(tab), false);
  assert.deepEqual(normal.reads, []);
});
