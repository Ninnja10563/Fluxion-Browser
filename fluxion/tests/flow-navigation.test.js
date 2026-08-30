"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Navigation = require("../chrome/core/flow-navigation.js");

test("vertical Flow navigation wraps and supports Home and End", () => {
  assert.equal(Navigation.rovingIndex(5, 0, "ArrowUp"), 4);
  assert.equal(Navigation.rovingIndex(5, 4, "ArrowDown"), 0);
  assert.equal(Navigation.rovingIndex(5, 3, "Home"), 0);
  assert.equal(Navigation.rovingIndex(5, 1, "End"), 4);
});

test("workspace navigation uses horizontal arrow keys", () => {
  assert.equal(Navigation.rovingIndex(3, 1, "ArrowLeft", "horizontal"), 0);
  assert.equal(Navigation.rovingIndex(3, 1, "ArrowRight", "horizontal"), 2);
  assert.equal(Navigation.rovingIndex(3, 1, "ArrowDown", "horizontal"), 1);
});

test("empty and invalid collections never yield a focus target", () => {
  assert.equal(Navigation.rovingIndex(0, 0, "ArrowDown"), -1);
  assert.equal(Navigation.rovingIndex(-2, 9, "End"), -1);
});

test("handled keys are orientation-specific", () => {
  assert.equal(Navigation.handlesRovingKey("ArrowDown"), true);
  assert.equal(Navigation.handlesRovingKey("ArrowRight"), false);
  assert.equal(Navigation.handlesRovingKey("ArrowRight", "horizontal"), true);
  assert.equal(Navigation.handlesRovingKey("Enter", "horizontal"), false);
});
