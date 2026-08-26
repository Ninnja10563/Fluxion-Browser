"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  canSplit,
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
