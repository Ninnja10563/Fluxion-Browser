"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const Workspaces = require("../chrome/core/workspaces.js");
const source = fs.readFileSync(path.join(__dirname, "../chrome/fluxion-chrome.js"), "utf8");
const deletion = source.slice(source.indexOf("  function deleteWorkspace("), source.indexOf("  function switchWorkspace("));

function fixture(duringConfirmation, confirmed = true) {
  const calls = { saved: [], migrated: [], alerts: [], switched: [] };
  const context = vm.createContext({ window: {}, TAB_WORKSPACE: "workspace", currentWorkspace: "b",
    workspaces: ["a", "b", "c"].map(id => ({ id, name: id.toUpperCase(), icon: "circle", accent: "slate" })),
    FluxionWorkspaces: Workspaces,
    Services: {
      wm: { getEnumerator: () => [{ gBrowser: { tabs: [] }, FluxionUI: {
        migrateWorkspaceTabs: (...args) => calls.migrated.push(args),
      } }] },
      prompt: {
        confirm() { duringConfirmation?.(context); return confirmed; },
        alert(_window, title) { calls.alerts.push(title); },
      },
    },
    saveWorkspaces(items) { calls.saved.push(items); context.workspaces = items; },
    switchWorkspace(id) { calls.switched.push(id); },
  });
  const remove = vm.runInContext(`${deletion}\ndeleteWorkspace`, context);
  return { calls, context, remove };
}

test("delete commits against current definitions after another window adds or renames a workspace", () => {
  const f = fixture(context => {
    context.workspaces = context.workspaces.map(item => item.id === "c" ? { ...item, name: "New name" } : item);
    context.workspaces.push({ id: "d", name: "Created while confirming", icon: "arc", accent: "sage" });
  });
  assert.equal(f.remove("b"), true);
  assert.deepEqual(f.calls.saved[0].map(item => [item.id, item.name]), [["a", "A"], ["c", "New name"], ["d", "Created while confirming"]]);
  assert.deepEqual(f.calls.migrated, [["b", "c"]]);
});

test("changed migration destination or removed target aborts without writing stale state", () => {
  for (const mutate of [
    context => { context.workspaces = [context.workspaces[2], context.workspaces[1], context.workspaces[0]]; },
    context => { context.workspaces = context.workspaces.filter(item => item.id !== "b"); },
    context => { context.workspaces = context.workspaces.filter(item => item.id === "b"); },
  ]) {
    const f = fixture(mutate);
    assert.equal(f.remove("b"), false);
    assert.equal(f.calls.saved.length + f.calls.migrated.length + f.calls.switched.length, 0);
    assert.deepEqual(f.calls.alerts, ["Workspaces Changed"]);
  }
});

test("cancel does not mutate workspaces and an unprompted owned deletion keeps the normal destination", () => {
  const canceled = fixture(null, false);
  assert.equal(canceled.remove("b"), false);
  assert.equal(canceled.calls.saved.length + canceled.calls.migrated.length, 0);
  const direct = fixture(() => { throw new Error("No prompt should run"); });
  assert.equal(direct.remove("b", { confirm: false }), true);
  assert.deepEqual(direct.calls.migrated, [["b", "c"]]);
});
