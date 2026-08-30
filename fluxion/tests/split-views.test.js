"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  canSplit,
  normaliseOrientation,
  orientationOf,
  positionLabel,
  projectSplitRows,
  splitPosition,
} = require("../chrome/core/split-views.js");

test("split eligibility rejects pinned, closing, duplicate, and already split tabs", () => {
  const first = {};
  const second = {};
  assert.equal(canSplit(first, second), true);
  assert.equal(canSplit(first, first), false);
  assert.equal(canSplit({ pinned: true }, second), false);
  assert.equal(canSplit(first, { closing: true }), false);
  assert.equal(canSplit({ splitview: {} }, second), false);
});

test("split projection preserves order and emits one row per native wrapper", () => {
  const first = { title: "Reference" };
  const second = { title: "Notes" };
  const final = { title: "Inbox" };
  const splitView = { tabs: [first, second] };
  first.splitview = splitView;
  second.splitview = splitView;

  assert.deepEqual(projectSplitRows([first, second, final]), [
    { kind: "split", splitView, tabs: [first, second] },
    { kind: "tab", tab: final },
  ]);
});

test("partial split projections degrade to an ordinary tab row", () => {
  const first = {};
  const second = {};
  const splitView = { tabs: [first, second] };
  first.splitview = splitView;
  second.splitview = splitView;

  assert.deepEqual(projectSplitRows([second]), [{ kind: "tab", tab: second }]);
});

test("split positions are one-based and stable", () => {
  const first = {};
  const second = {};
  const splitView = { tabs: [first, second] };
  assert.equal(splitPosition(first, splitView), 1);
  assert.equal(splitPosition(second, splitView), 2);
  assert.equal(splitPosition({}, splitView), 0);
});

test("split orientation accepts only the two product layouts", () => {
  assert.equal(normaliseOrientation("side-by-side"), "side-by-side");
  assert.equal(normaliseOrientation("stacked"), "stacked");
  assert.equal(normaliseOrientation("diagonal"), "side-by-side");
});

test("restored orientation can be read from either native split member", () => {
  const first = { splitOrientation: "" };
  const second = { splitOrientation: "stacked" };
  assert.equal(orientationOf({ tabs: [first, second] }), "stacked");
  assert.equal(orientationOf({ tabs: [{ splitOrientation: "invalid" }] }), "side-by-side");
});

test("split positions use spatial labels for both layouts", () => {
  assert.equal(positionLabel(1, "side-by-side"), "left");
  assert.equal(positionLabel(2, "side-by-side"), "right");
  assert.equal(positionLabel(1, "stacked"), "top");
  assert.equal(positionLabel(2, "stacked"), "bottom");
  assert.equal(positionLabel(3, "stacked", 4), "pane 3 of 4");
});
