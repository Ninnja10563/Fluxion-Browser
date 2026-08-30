"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Recovery = require("../chrome/core/session-recovery.js");

function normalSnapshot(overrides = {}) {
  const tabs = [
    { url: Recovery.URLS.groupA, workspace: "build", group: "Recovery Lab" },
    { url: Recovery.URLS.groupB, workspace: "build", group: "Recovery Lab" },
    { url: Recovery.URLS.splitA, workspace: "build", split: "pair-a" },
    { url: Recovery.URLS.splitB, workspace: "build", split: "pair-a" },
    { url: Recovery.URLS.pinned, workspace: "build", pinned: true },
  ];
  return { currentWorkspace: "build", isPrivate: false, tabs, ...overrides };
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
