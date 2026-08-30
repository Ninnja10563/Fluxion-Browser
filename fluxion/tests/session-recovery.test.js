"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Recovery = require("../chrome/core/session-recovery.js");

function normalSnapshot(overrides = {}) {
  const tabs = [
    { url: Recovery.URLS.groupA, workspace: "build", group: "Recovery Lab" },
    { url: Recovery.URLS.groupB, workspace: "build", group: "Recovery Lab" },
    {
      url: Recovery.URLS.splitA, workspace: "build", split: "pair-a",
      splitOrientation: "stacked", active: true, selected: true,
    },
    { url: Recovery.URLS.splitB, workspace: "build", split: "pair-a", splitOrientation: "stacked" },
    { url: Recovery.URLS.pinned, workspace: "build", pinned: true },
    { url: Recovery.URLS.focusIdle, workspace: "focus" },
    { url: Recovery.URLS.focusActive, workspace: "focus", active: true },
  ];
  return {
    currentWorkspace: "build",
    isPrivate: false,
    workspaces: Recovery.EXPECTED_WORKSPACE_LIST.map(workspace => ({ ...workspace })),
    tabs,
    ...overrides,
  };
}

test("normal recovery requires workspaces, pins, groups, and native split identity", () => {
  assert.deepEqual(Recovery.validateNormal(normalSnapshot()), { ok: true, reasons: [] });
  const broken = normalSnapshot();
  broken.tabs = broken.tabs.filter(tab => tab.url !== Recovery.URLS.groupB);
  broken.tabs.find(tab => tab.url === Recovery.URLS.splitB).split = "different-pair";
  const result = Recovery.validateNormal(broken);
  assert.equal(result.ok, false);
  assert.match(result.reasons.join("\n"), /missing .*group-b/);
  assert.match(result.reasons.join("\n"), /native tab group/);
  assert.match(result.reasons.join("\n"), /native split pair/);
});

test("normal recovery requires the persisted stacked split orientation", () => {
  const broken = normalSnapshot();
  broken.tabs.find(tab => tab.url === Recovery.URLS.splitB).splitOrientation = "side-by-side";
  const result = Recovery.validateNormal(broken);
  assert.equal(result.ok, false);
  assert.match(result.reasons.join("\n"), /stacked split orientation/);
});

test("normal recovery requires one remembered active page per workspace", () => {
  const broken = normalSnapshot();
  broken.tabs.find(tab => tab.url === Recovery.URLS.focusActive).active = false;
  broken.tabs.find(tab => tab.url === Recovery.URLS.focusIdle).active = true;
  broken.tabs.find(tab => tab.url === Recovery.URLS.splitA).selected = false;
  const result = Recovery.validateNormal(broken);
  assert.equal(result.ok, false);
  assert.match(result.reasons.join("\n"), /focus active page/);
  assert.match(result.reasons.join("\n"), /active Build page was not selected/);
});

test("normal recovery requires workspace names, symbols, accents, and order", () => {
  const broken = normalSnapshot();
  broken.workspaces[2].accent = "rose";
  broken.workspaces.reverse();
  const result = Recovery.validateNormal(broken);
  assert.equal(result.ok, false);
  assert.match(result.reasons.join("\n"), /workspace names, symbols, accents, or order/);
});

test("private tabs are rejected from a post-private normal restoration", () => {
  const snapshot = normalSnapshot();
  snapshot.tabs.push({ url: Recovery.URLS.privateOnly, workspace: "build" });
  assert.equal(Recovery.validateNormal(snapshot).ok, true);
  const isolated = Recovery.validateNormal(snapshot, { requirePrivateAbsence: true });
  assert.equal(isolated.ok, false);
  assert.match(isolated.reasons[0], /private tab leaked/);
  assert.equal(Recovery.validatePrivateAbsence(snapshot).ok, false);
  assert.deepEqual(Recovery.validatePrivateAbsence({
    isPrivate: false,
    tabs: [{ url: "about:blank" }],
  }), { ok: true, reasons: [] });
});

test("private mode requires empty private-state Browser Memory results", () => {
  assert.deepEqual(Recovery.validatePrivate({
    isPrivate: true, memoryState: "private", memoryResults: 0, memoryEnabled: false,
  }), { ok: true, reasons: [] });
  const result = Recovery.validatePrivate({
    isPrivate: false, memoryState: "ready", memoryResults: 2, memoryEnabled: true,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reasons.length, 4);
});
