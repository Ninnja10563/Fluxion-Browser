"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { markerPlan, preferredTab } = require("../chrome/core/workspace-tabs.js");

const tab = (id, workspace, options = {}) => ({ id, workspace, ...options });

test("remembered workspace tabs beat native recency without mutating order", () => {
  const tabs = [
    tab("first", "build", { remembered: true, lastAccessed: 10 }),
    tab("recent", "build", { lastAccessed: 200 }),
    tab("other", "focus", { remembered: true, lastAccessed: 300 }),
  ];
  assert.equal(preferredTab(tabs, "build").id, "first");
  assert.deepEqual(tabs.map(item => item.id), ["first", "recent", "other"]);
});

test("native recency provides a deterministic fallback for unvisited workspaces", () => {
  const tabs = [
    tab("old", "focus", { lastAccessed: 20 }),
    tab("new", "focus", { lastAccessed: 90 }),
    tab("closing", "focus", { remembered: true, closing: true, lastAccessed: 100 }),
  ];
  assert.equal(preferredTab(tabs, "focus").id, "new");
  assert.equal(preferredTab(tabs, "missing"), null);
});

test("marker plans leave exactly one active page in the selected workspace", () => {
  const first = tab("first", "build", { remembered: true });
  const second = tab("second", "build");
  const other = tab("other", "focus", { remembered: true });
  assert.deepEqual(markerPlan([first, second, other], "build", second), [
    { tab: first, remembered: false },
    { tab: second, remembered: true },
  ]);
  assert.deepEqual(markerPlan([first], "focus", first), []);
});
