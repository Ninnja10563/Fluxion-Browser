"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

require(path.resolve(__dirname, "../chrome/core/tab-sleeping.js"));
const policy = globalThis.FluxionTabSleepingPolicy;

const eligible = {
  now: 1_000_000,
  lastAccessed: 1_000,
  minimumIdleMs: 300_000,
};

test("sleep intervals are constrained to supported persisted values", () => {
  assert.equal(policy.normaliseMinutes("15"), 15);
  assert.equal(policy.normaliseMinutes(0), 0);
  assert.equal(policy.normaliseMinutes(7), 30);
  assert.equal(policy.nextCheckDelay(5), 60_000);
  assert.equal(policy.nextCheckDelay(0), 0);
});

test("old inactive ordinary tabs become eligible", () => {
  assert.equal(policy.canSleep({}, eligible), true);
  assert.equal(policy.canSleep({}, { ...eligible, lastAccessed: 900_000 }), false);
});

test("sleeping never targets protected or active tab states", () => {
  for (const reason of [
    "privateWindow", "selected", "pinned", "closing", "busy", "discarded",
    "split", "playingAudio", "sharing",
  ]) {
    assert.equal(policy.canSleep({}, { ...eligible, [reason]: true }), false, reason);
  }
});
