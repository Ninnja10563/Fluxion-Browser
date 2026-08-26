"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  GROUP_COLORS,
  normaliseGroupName,
  projectTabRows,
} = require("../chrome/core/tab-groups.js");

test("normalises concise tab-group names", () => {
  assert.equal(normaliseGroupName("  API   research  "), "API research");
  assert.equal(normaliseGroupName(" "), "");
  assert.equal(normaliseGroupName("x".repeat(60)).length, 40);
  assert.ok(GROUP_COLORS.includes("gray"));
});

test("projects native groups once while preserving tab order", () => {
  const group = { id: "docs", label: "Documentation" };
  const tabs = [
    { id: "a", workspaceId: "build" },
    { id: "b", workspaceId: "build", group },
    { id: "c", workspaceId: "build", group },
    { id: "d", workspaceId: "life" },
  ];
  const rows = projectTabRows(tabs, "build");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].tab.id, "a");
  assert.equal(rows[1].group, group);
  assert.deepEqual(rows[1].tabs.map(tab => tab.id), ["b", "c"]);
});

test("keeps pinned tabs outside native groups and filters cross-workspace members", () => {
  const group = { id: "mixed" };
  const tabs = [
    { id: "pinned", workspaceId: "focus", group, pinned: true },
    { id: "focus", workspaceId: "focus", group },
    { id: "life", workspaceId: "life", group },
  ];
  const rows = projectTabRows(tabs, "focus");
  assert.deepEqual(rows.map(row => row.kind), ["tab", "group"]);
  assert.deepEqual(rows[1].tabs.map(tab => tab.id), ["focus"]);
});
