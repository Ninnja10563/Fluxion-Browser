"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { IndexScheduler } = require("../chrome/core/index-scheduler.js");

function harness(options = {}) {
  let now = 0;
  let nextTimer = 1;
  const timers = new Map();
  const runs = [];
  const scheduler = new IndexScheduler({
    now: () => now,
    setTimer: callback => { const id = nextTimer++; timers.set(id, callback); return id; },
    clearTimer: id => timers.delete(id),
    run: async value => { runs.push(value); },
    quietMs: 100,
    retryMs: 50,
    ...options,
  });
  return {
    scheduler, runs,
    advance(milliseconds) { now += milliseconds; },
    async fire() {
      const entry = timers.entries().next().value;
      assert.ok(entry, "expected a scheduled timer");
      timers.delete(entry[0]);
      await entry[1]();
      await Promise.resolve();
    },
    timerCount: () => timers.size,
  };
}

test("deduplicates pages and waits for a quiet period", async () => {
  const task = harness();
  task.scheduler.enqueue("page", "old");
  task.scheduler.enqueue("page", "new");
  assert.equal(task.scheduler.status().queued, 1);
  task.advance(50);
  await task.fire();
  assert.deepEqual(task.runs, []);
  task.advance(50);
  await task.fire();
  assert.deepEqual(task.runs, ["new"]);
});

test("policy pauses preserve queued work and resume on wake", async () => {
  let allowed = false;
  const task = harness({ canRun: () => ({ ok: allowed, reason: "battery", retryIn: 50 }) });
  task.scheduler.enqueue("page");
  task.advance(100);
  await task.fire();
  assert.equal(task.scheduler.status().queued, 1);
  assert.equal(task.scheduler.status().deferReason, "battery");
  allowed = true;
  task.scheduler.wake();
  await task.fire();
  assert.deepEqual(task.runs, ["page"]);
});

test("an explicit hold survives time and resumes only for its owner", async () => {
  const task = harness();
  task.scheduler.defer("packaged-test", 1000);
  task.scheduler.enqueue("page");
  task.advance(100);
  await task.fire();
  assert.deepEqual(task.runs, []);
  assert.equal(task.scheduler.resume("another-owner"), false);
  assert.equal(task.scheduler.status().deferReason, "packaged-test");
  assert.equal(task.scheduler.resume("packaged-test"), true);
  await task.fire();
  assert.deepEqual(task.runs, ["page"]);
});

test("serialises jobs even when more work arrives during a run", async () => {
  let release;
  const started = [];
  const task = harness({
    run: value => new Promise(resolve => { started.push(value); release = resolve; }),
  });
  task.scheduler.enqueue("one");
  task.advance(100);
  const first = task.scheduler.pump();
  task.scheduler.enqueue("two");
  assert.deepEqual(started, ["one"]);
  assert.equal(task.scheduler.status().running, true);
  release();
  await first;
  assert.equal(task.timerCount(), 1);
  await task.fire();
  assert.deepEqual(started, ["one", "two"]);
});

test("bounds the queue and discards oldest superseded work", () => {
  const task = harness({ maxQueue: 3 });
  for (const key of ["one", "two", "three", "four"]) task.scheduler.enqueue(key);
  assert.equal(task.scheduler.status().queued, 3);
  assert.deepEqual([...task.scheduler.queue.keys()], ["two", "three", "four"]);
  task.scheduler.destroy();
  assert.equal(task.timerCount(), 0);
});
