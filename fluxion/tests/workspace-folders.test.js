"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const core = require("../chrome/core/tab-groups.js");
const source = fs.readFileSync(path.join(__dirname, "../chrome/fluxion-chrome.js"), "utf8");
const record = (extra = {}) => ({ id: "folder-1", workspaceId: "work", label: "Research", collapsed: false, groupId: "", ...extra });

test("folder records roundtrip with bounded, validated data and safe malformed input", () => {
  const folders = [record({ collapsed: true })];
  assert.deepEqual(core.normaliseFolders(JSON.stringify(folders)), folders);
  assert.deepEqual(core.normaliseFolders("{"), []);
  assert.deepEqual(core.normaliseFolders([null, {}, record(), record()]), [record()]);
  for (const label of [{ title: "Do not stringify" }, ["Nested"], true, 123]) {
    assert.deepEqual(core.normaliseFolders([record({ label })]), []);
  }
  assert.equal(core.normaliseFolders(Array.from({ length: 150 }, (_, id) => record({ id: `f${id}` }))).length, 100);
});

test("native folder names, collapsed state and workspace follow native groups; empty folders survive last-tab removal", () => {
  const tab = { workspaceId: "work", userContextId: 7 };
  const group = { id: "g1", label: "Reference", collapsed: true, tabs: [tab] };
  const folders = core.synchroniseFolders([record({ groupId: "g1" })], [group], t => t.workspaceId, () => "f2");
  assert.equal(folders[0].label, "Reference");
  assert.equal(folders[0].collapsed, true);
  assert.deepEqual(core.synchroniseFolders(folders, [], t => t.workspaceId, () => "f2"), folders);
  tab.workspaceId = "school";
  assert.equal(core.synchroniseFolders(folders, [group], t => t.workspaceId, () => "f2")[0].workspaceId, "school");
  assert.equal(tab.userContextId, 7);
});

test("native reordering preserves empty folder slots and ignores mixed-workspace transient groups", () => {
  const a = { id: "a", label: "A", tabs: [{ workspaceId: "work" }] };
  const b = { id: "b", label: "B", tabs: [{ workspaceId: "work" }] };
  const records = [record({ id: "a", groupId: "a" }), record(), record({ id: "b", groupId: "b" })];
  assert.deepEqual(core.synchroniseFolders(records, [b, a], t => t.workspaceId, () => "new").map(f => f.id), ["b", "folder-1", "a"]);
  assert.deepEqual(core.synchroniseFolders([], [{ ...a, tabs: [...a.tabs, { workspaceId: "school" }] }], t => t.workspaceId, () => "new"), []);
});

function fixture(saved = "") {
  let serial = 0, stored = saved, rendered = 0, answer = "Research";
  const window = {};
  const gBrowser = { tabGroups: [], clearMultiSelectedTabs() {}, addTabGroup(tabs, options) {
    const group = { id: `native-${++serial}`, label: options.label, tabs: [...tabs], collapsed: false,
      addTabs(items) { this.tabs.push(...items); } };
    this.tabGroups.push(group); return group;
  } };
  const ctx = vm.createContext({ window, gBrowser, FluxionTabGroups: core,
    workspaceFolders: [], foldersLoaded: false, sessionRestoreSettled: true,
    workspaces: [{ id: "work" }, { id: "school" }], currentWorkspace: "work",
    Services: { uuid: { generateUUID: () => `folder-${++serial}` } },
    SessionStore: { getCustomWindowValue: () => stored, setCustomWindowValue(_window, key, value) {
      assert.equal(key, core.FOLDERS_WINDOW_KEY); stored = value;
    } }, Cu: { reportError(error) { throw error; } },
    askGroupName: () => answer, tabWorkspace: tab => tab.workspace,
    scheduleRender() { rendered++; },
  });
  vm.runInContext(source.slice(source.indexOf("  function loadWorkspaceFolders()"), source.indexOf("  function createEmptyFolderElement(")), ctx);
  return { ctx, gBrowser, get stored() { return stored; }, get rendered() { return rendered; }, setAnswer(value) { answer = value; } };
}

test("workspace menu creates a genuinely empty persistent folder, cancel creates nothing", () => {
  const f = fixture();
  f.ctx.createWorkspaceFolder("work");
  assert.equal(f.gBrowser.tabGroups.length, 0);
  assert.equal(JSON.parse(f.stored)[0].label, "Research");
  assert.equal(f.rendered, 1);
  const restored = fixture(f.stored); restored.ctx.loadWorkspaceFolders();
  assert.equal(restored.ctx.workspaceFolders.length, 1);
  f.setAnswer(null); f.ctx.createWorkspaceFolder("work");
  assert.equal(f.ctx.workspaceFolders.length, 1);
});

test("unknown restored workspace IDs are retained instead of being silently assigned to the active space", () => {
  const f = fixture(JSON.stringify([record({ workspaceId: "temporarily-unavailable" })]));
  f.ctx.syncWorkspaceFolders();
  assert.equal(f.ctx.workspaceFolders[0].workspaceId, "temporarily-unavailable");
});

test("explicit workspace deletion migrates empty folders to its actual chosen destination", () => {
  const f = fixture(JSON.stringify([record()]));
  Object.assign(f.ctx, { storedTabWorkspace: tab => tab.workspace, setWorkspaceTabActive() {},
    setTabWorkspace: (tab, id) => { tab.workspace = id; } });
  f.gBrowser.tabs = [];
  const start = source.indexOf("  function migrateWorkspaceTabs("), end = source.indexOf("  function deleteWorkspace(", start);
  vm.runInContext(source.slice(start, end), f.ctx);
  f.ctx.migrateWorkspaceTabs("work", "school");
  assert.equal(JSON.parse(f.stored)[0].workspaceId, "school");
  assert.equal(f.ctx.currentWorkspace, "school");
  f.ctx.migrateWorkspaceTabs("school", "unknown");
  assert.equal(JSON.parse(f.stored)[0].workspaceId, "school");
});

test("moving into an empty folder materialises one native group without replacing tabs or crossing workspaces", () => {
  const f = fixture(JSON.stringify([record({ collapsed: true })]));
  f.ctx.loadWorkspaceFolders();
  const tab = { parentNode: {}, workspace: "work", userContextId: 12 };
  const wrong = { parentNode: {}, workspace: "school" };
  const pinned = { parentNode: {}, workspace: "work", pinned: true };
  f.ctx.moveTabsToFolder([tab, tab, wrong, pinned], "folder-1");
  assert.equal(f.gBrowser.tabGroups.length, 1);
  assert.equal(f.gBrowser.tabGroups[0].tabs.length, 1);
  assert.equal(f.gBrowser.tabGroups[0].tabs[0], tab);
  assert.equal(tab.userContextId, 12);
  assert.equal(f.gBrowser.tabGroups[0].collapsed, true);
  assert.equal(JSON.parse(f.stored)[0].groupId, f.gBrowser.tabGroups[0].id);
  f.ctx.moveTabsToFolder([wrong], "folder-1");
  assert.equal(f.gBrowser.tabGroups.length, 1);
});

test("workspace context menu exposes creation and folder section precedes divider", () => {
  assert.match(source, /appendAction\(workspaceMenu, "New Folder…", \(\) => createWorkspaceFolder\(contextWorkspace\)\)/);
  assert.match(source, /workspaceHeading, folderTabs, workspaceDivider, tabScroll/);
  assert.match(source, /label: "Move to Folder"/);
  assert.match(source, /Rename Folder…/);
});
