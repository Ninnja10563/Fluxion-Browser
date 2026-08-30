"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const TabDrop = require("../chrome/core/tab-drop.js");

const rect = { left: 100, top: 200, width: 200, height: 100 };

test("top and bottom edge drops remain precise reorder operations", () => {
  assert.deepEqual(TabDrop.classify({ clientX: 200, clientY: 210, rect, canSplit: true }), {
    action: "reorder", position: "before",
  });
  assert.deepEqual(TabDrop.classify({ clientX: 200, clientY: 290, rect, canSplit: true }), {
    action: "reorder", position: "after",
  });
});

test("center drop creates a spatially ordered side-by-side split", () => {
  assert.deepEqual(TabDrop.classify({ clientX: 130, clientY: 250, rect, canSplit: true }), {
    action: "split", orientation: "side-by-side", position: "before",
  });
  assert.deepEqual(TabDrop.classify({ clientX: 270, clientY: 250, rect, canSplit: true }), {
    action: "split", orientation: "side-by-side", position: "after",
  });
});

test("Shift changes the center target to a top or bottom stacked split", () => {
  assert.deepEqual(TabDrop.classify({
    clientX: 200, clientY: 240, rect, canSplit: true, stacked: true,
  }), { action: "split", orientation: "stacked", position: "before" });
  assert.deepEqual(TabDrop.classify({
    clientX: 200, clientY: 260, rect, canSplit: true, stacked: true,
  }), { action: "split", orientation: "stacked", position: "after" });
});

test("ineligible or multi-tab drags use reorder zones instead of fake split affordances", () => {
  assert.deepEqual(TabDrop.classify({ clientX: 130, clientY: 240, rect, canSplit: false }), {
    action: "reorder", position: "before",
  });
  assert.deepEqual(TabDrop.classify({ clientX: 270, clientY: 260, rect, canSplit: false }), {
    action: "reorder", position: "after",
  });
});

test("side-by-side ordering follows visual direction in RTL", () => {
  assert.equal(TabDrop.classify({
    clientX: 130, clientY: 250, rect, canSplit: true, rtl: true,
  }).position, "after");
});

test("drop labels and announcements describe the resulting geometry", () => {
  const intent = { action: "split", orientation: "stacked", position: "after" };
  assert.equal(TabDrop.shortLabel(intent), "Stack below");
  assert.equal(
    TabDrop.announcement(intent, "Reference", "Notes"),
    "Drop to place Reference below Notes in a split view.",
  );
  assert.match(
    TabDrop.announcement({ action: "reorder", position: "before" }, "A", "B"),
    /place A before B/,
  );
});

test("invalid geometry cannot produce a destructive drop intent", () => {
  assert.deepEqual(TabDrop.classify({ clientX: 1, clientY: 1, rect: { width: 0, height: 2 } }), {
    action: "none",
  });
});
