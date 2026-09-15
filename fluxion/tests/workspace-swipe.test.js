"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const swipe = require("../chrome/core/workspace-swipe.js");
const push = (gesture, deltaX, deltaY, time, deltaMode = 0) => gesture.push({ deltaX, deltaY, time, deltaMode });

test("horizontal threshold switches once; constant and decaying inertia stay in that gesture", () => {
  const gesture = swipe.create();
  assert.deepEqual(push(gesture, 5, 0, 0), { consume: false, direction: 0 });
  assert.deepEqual(push(gesture, 20, 2, 10), { consume: true, direction: 0 });
  assert.deepEqual(push(gesture, 31, 1, 20), { consume: true, direction: 1 });
  for (let i = 1; i < 50; i++) assert.deepEqual(push(gesture, i < 30 ? 25 : 2, 0, 20 + i * 30), { consume: true, direction: 0 });
  assert.deepEqual(push(gesture, -56, 1, 2000), { consume: true, direction: -1 });
});

test("vertical and diagonal scrolling remain uncancelled even if later momentum turns horizontal", () => {
  for (const [x, y] of [[1, 16], [24, 24], [32, 24], [0, -25]]) {
    const gesture = swipe.create();
    assert.deepEqual(push(gesture, x, y, 0), { consume: false, direction: 0 });
    assert.deepEqual(push(gesture, 100, 0, 50), { consume: false, direction: 0 });
    assert.deepEqual(push(gesture, 56, 0, 300), { consume: true, direction: 1 });
  }
});

test("tiny initial diagonals do not lock out a subsequent clear horizontal swipe", () => {
  for (const direction of [-1, 1]) {
    const gesture = swipe.create();
    assert.deepEqual(push(gesture, direction * 8, 8, 0), { consume: false, direction: 0 });
    assert.deepEqual(push(gesture, direction * 12, 8, 20), { consume: false, direction: 0 });
    assert.deepEqual(push(gesture, direction * 36, 0, 40), { consume: true, direction });
  }
});

test("deliberate reverse gestures work without waiting for idle, but small sign bounce does not switch", () => {
  for (const direction of [-1, 1]) {
    const gesture = swipe.create();
    assert.equal(push(gesture, direction * 60, 0, 0).direction, direction);
    for (let i = 1; i < 12; i++) assert.equal(push(gesture, i % 2 ? -direction * 2 : direction * 2, 0, i * 10).direction, 0);
    assert.equal(push(gesture, -direction * 28, 0, 130).direction, 0);
    assert.equal(push(gesture, -direction * 28, 0, 150).direction, -direction);
    assert.equal(push(gesture, direction * 60, 0, 170).direction, direction);
  }
});

test("a new strong impulse after a decayed tail permits a same-direction gesture without inertia repeats", () => {
  for (const direction of [-1, 1]) {
    const gesture = swipe.create();
    assert.equal(push(gesture, direction * 60, 0, 0).direction, direction);
    for (const [index, delta] of [30, 20, 12, 4, 2].entries()) assert.equal(push(gesture, direction * delta, 0, 20 + index * 20).direction, 0);
    assert.equal(push(gesture, direction * 60, 0, 120).direction, direction);
    assert.equal(push(gesture, direction * 60, 0, 140).direction, 0);
  }
});

test("irregular same-direction inertia, small sign noise and brief weak rebounds cannot create extra switches", () => {
  for (const direction of [-1, 1]) {
    const gesture = swipe.create();
    assert.equal(push(gesture, direction * 60, 0, 0).direction, direction);
    const deltas = [68, 59, 42, 46, 32, 20, 22, 7, 4, 3, 2, 1, 8, 4, 2, -2, 2, -1, 1];
    for (const [index, delta] of deltas.entries()) assert.equal(push(gesture, direction * delta, 0, 20 + index * 20).direction, 0);
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
