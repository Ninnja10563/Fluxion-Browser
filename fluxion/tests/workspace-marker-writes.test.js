"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../chrome/fluxion-chrome.js"), "utf8");
const start = source.indexOf("  function workspaceTabActive(tab) {");
const end = source.indexOf("  function preferredWorkspaceTab(", start);
assert.ok(start >= 0 && end > start);

// Run the complete shipped setter and authoritative reconciliation function,
// not copied handler logic; Gecko SessionStore is instrumented at its boundary.
function fixture(count = 1000) {
  const writes = [], errors = [], reads = [], mutations = [];
  const tabs = Array.from({ length: count }, (_, id) => ({
    id, workspace: "focus", parentNode: {}, saved: "", marker: false,
    hasAttribute: function () { return this.marker; },
    toggleAttribute: function (_name, active) { this.marker = !!active; mutations.push(this.id); },
  }));
  const SessionStore = {
    getCustomTabValue(tab) { reads.push(tab.id); if (tab.readFailure) throw new Error("marker read failed"); return tab.saved; },
    setCustomTabValue(tab, name, value) { writes.push({ id: tab.id, kind: "set", name, value }); tab.saved = value; },
    deleteCustomTabValue(tab, name) { writes.push({ id: tab.id, kind: "delete", name }); tab.saved = ""; },
  };
  const context = vm.createContext({ SessionStore, Cu: { reportError: error => errors.push(error.message) },
    TAB_WORKSPACE_ACTIVE: "fluxion-workspace-active", gBrowser: { tabs },
    tabWorkspace: tab => tab.workspace, FluxionWorkspaceTabs: require("../chrome/core/workspace-tabs.js") });
  vm.runInContext(`${source.slice(start, end)}\nglobalThis.api = { workspaceTabActive, setWorkspaceTabActive, rememberWorkspaceTab };`, context);
  return { ...context.api, tabs, writes, errors, reads, mutations };
}

test("1000-tab selection scans authoritative markers but writes only old and new selected tabs", () => {
  const h = fixture();
  h.tabs[3].saved = "true"; h.tabs[3].marker = true;
  assert.equal(h.rememberWorkspaceTab(h.tabs[800]), true);
  assert.equal(h.reads.length, 1000);
  assert.deepEqual(h.writes.map(item => [item.id, item.kind]), [[3, "delete"], [800, "set"]]);
  assert.deepEqual(h.mutations, [3, 800]);
  h.writes.length = 0; h.mutations.length = 0; h.reads.length = 0;
  h.rememberWorkspaceTab(h.tabs[800]);
  assert.equal(h.reads.length, 1000, "duplicate reconciliation still checks restored authoritative state");
  assert.deepEqual(h.writes, []); assert.deepEqual(h.mutations, []);
});

test("restored duplicate/malformed markers are repaired without trusting native attribute cache", () => {
  const h = fixture(5);
  h.tabs[0].saved = "true"; // Native attribute is missing but saved state is authoritative.
  h.tabs[1].saved = "true"; h.tabs[1].marker = true;
  h.tabs[2].saved = "false";
  h.tabs[3].saved = "corrupt"; h.tabs[3].marker = true;
  h.tabs[4].workspace = "build"; h.tabs[4].saved = "true"; h.tabs[4].marker = true;
  h.rememberWorkspaceTab(h.tabs[0]);
  assert.deepEqual(h.writes.map(item => [item.id, item.kind]), [[1, "delete"], [2, "delete"], [3, "delete"]]);
  assert.equal(h.tabs[0].marker, true);
  assert.equal(h.tabs[4].saved, "true", "other workspaces retain their remembered page");
});

test("failed marker reads report errors and retain repair writes rather than claiming success", () => {
  const h = fixture(2);
  for (const tab of h.tabs) tab.readFailure = true;
  h.rememberWorkspaceTab(h.tabs[1]);
  assert.equal(h.errors.length, 2);
  assert.deepEqual(h.writes.map(item => [item.id, item.kind]), [[0, "delete"], [1, "set"]]);
});

test("read failure preserves the boolean native marker and successful reads reconcile authoritative state", () => {
  const h = fixture(2);
  h.setWorkspaceTabActive(h.tabs[0], true);
  h.mutations.length = 0;
  h.tabs[0].readFailure = true; h.tabs[1].readFailure = true;
  assert.equal(h.workspaceTabActive(h.tabs[0]), true, "toggleAttribute produces a present boolean marker, not a true-valued string");
  assert.equal(h.workspaceTabActive(h.tabs[1]), false);
  assert.equal(h.errors.length, 2);
  assert.deepEqual(h.mutations, [], "reading unchanged native fallback never mutates it");
  h.tabs[0].readFailure = false; h.tabs[0].saved = "";
  h.tabs[1].readFailure = false; h.tabs[1].saved = "true";
  assert.equal(h.workspaceTabActive(h.tabs[0]), false);
  assert.equal(h.workspaceTabActive(h.tabs[1]), true);
  assert.deepEqual(h.mutations, [0, 1]);
  h.tabs[0].parentNode = null;
  h.reads.length = 0;
  assert.equal(h.workspaceTabActive(h.tabs[0]), false);
  assert.deepEqual(h.reads, []);
});

test("detached tabs are ignored and private in-memory reconciliation retains identical marker semantics", () => {
  const h = fixture(2);
  h.tabs[0].parentNode = null;
  h.setWorkspaceTabActive(h.tabs[0], true);
  assert.equal(h.rememberWorkspaceTab(h.tabs[0]), false);
  assert.deepEqual(h.writes, []);
  h.tabs[1].isPrivate = true;
  h.rememberWorkspaceTab(h.tabs[1]);
  assert.deepEqual(h.writes.map(item => [item.id, item.kind]), [[1, "set"]]);
  h.rememberWorkspaceTab(h.tabs[1]);
  assert.equal(h.writes.length, 1);
});
