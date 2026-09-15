"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const swipe = require("../chrome/core/workspace-swipe.js");
const push = (gesture, deltaX, deltaY, time, deltaMode = 0) => gesture.push({ deltaX, deltaY, time, deltaMode });

test("horizontal threshold switches once; the entire inertia tail and direction reversal stay in that gesture", () => {
  const gesture = swipe.create();
  assert.deepEqual(push(gesture, 5, 0, 0), { consume: false, direction: 0 });
  assert.deepEqual(push(gesture, 20, 2, 10), { consume: true, direction: 0 });
  assert.deepEqual(push(gesture, 31, 1, 20), { consume: true, direction: 1 });
  for (let i = 1; i < 50; i++) assert.deepEqual(push(gesture, i < 30 ? 25 : -50, 0, 20 + i * 30), { consume: true, direction: 0 });
  assert.deepEqual(push(gesture, -56, 1, 2000), { consume: true, direction: -1 });
});

test("vertical and diagonal scrolling remain uncancelled even if later momentum turns horizontal", () => {
  for (const [x, y] of [[1, 10], [10, 10], [13, 10], [0, -25]]) {
    const gesture = swipe.create();
    assert.deepEqual(push(gesture, x, y, 0), { consume: false, direction: 0 });
    assert.deepEqual(push(gesture, 100, 0, 50), { consume: false, direction: 0 });
    assert.deepEqual(push(gesture, 56, 0, 300), { consume: true, direction: 1 });
  }
});

test("a rejected gesture cannot become a switch when its modifier or popup is released", () => {
  const gesture = swipe.create();
  push(gesture, 20, 0, 0);
  gesture.block(10);
  assert.deepEqual(push(gesture, 100, 0, 50), { consume: false, direction: 0 });
  assert.deepEqual(push(gesture, 56, 0, 300), { consume: true, direction: 1 });
});

test("line units are normalized; unsupported, corrupt and nonfinite input cannot switch", () => {
  assert.equal(push(swipe.create(), 4, 0, 0, 1).direction, 1);
  for (const [x, y, mode, time] of [[100, 0, 2, 0], [NaN, 0, 0, 0], [100, Infinity, 0, 0], [100, 0, 0, NaN]]) {
    assert.deepEqual(push(swipe.create(), x, y, time, mode), { consume: false, direction: 0 });
  }
});

test("workspace adjacency preserves ordering and never wraps at either boundary", () => {
  const workspaces = [{ id: "one" }, { id: "two" }, { id: "three" }];
  assert.equal(swipe.adjacent(workspaces, "one", 1), "two");
  assert.equal(swipe.adjacent(workspaces, "three", -1), "two");
  for (const [id, direction] of [["one", -1], ["three", 1], ["missing", 1], ["one", 0]]) assert.equal(swipe.adjacent(workspaces, id, direction), null);
  assert.equal(swipe.adjacent([{ id: "one" }], "one", 1), null);
  assert.equal(swipe.adjacent([], "one", 1), null);
});
