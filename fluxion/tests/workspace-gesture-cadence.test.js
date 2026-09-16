"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const source = fs.readFileSync(require.resolve("../chrome/fluxion-workspace-gesture-verification.js"), "utf8");
const start = source.indexOf("  function continuousMomentum("), end = source.indexOf("  const move =", start);
function fixture() {
  const routed = [];
  const api = vm.runInNewContext(`${source.slice(start, end)}; ({ continuousMomentum, continuousCadence })`, {
    wheel: (...args) => routed.push(args),
    assert(value, message) { if (!value) throw Error(message); },
    setTimeout() { throw Error("Continuous burst must not yield to timers"); },
  });
  return { ...api, routed };
}
test("continuous momentum fixture synchronously routes all twelve native-flagged events without timer yields", () => {
  const h = fixture(), point = { x: 120, y: 400 };
  assert.equal(h.continuousMomentum(point), undefined);
  assert.equal(h.routed.length, 12);
  for (const args of h.routed) assert.deepEqual(args, [point, 60, 0, true]);
  assert.match(source, /continuousMomentum\(point\);\s*await Promise\.resolve\(\);/);
  assert.match(source, /report\.events\.length === 13 && report\.events\.every\(event => event\.trusted && event\.cancelled/);
});
test("cadence evidence accepts a continuous burst but rejects the recorded CI idle-boundary crossing", () => {
  const h = fixture();
  const events = Array.from({ length: 13 }, (_, i) => ({ at: i * 25 }));
  const result = h.continuousCadence(events, 220);
  assert.equal(result.maxGapMs, 25); assert.equal(result.events, 13); assert.equal(result.idleBoundaryMs, 220);
  const actual = [4552.875125,4565.10575,4602.840916666666,4640.814916666666,4690.769375000001,
    4717.347416666666,4948.396166666666,5057.711125,5107.669,5183.33775,5242.899916666665,5272.845083333334,5343.672];
  assert.throws(() => h.continuousCadence(actual.map(at => ({ at })), 220), /crossed the 220ms idle boundary: 231/);
  assert.throws(() => h.continuousCadence(events.slice(1), 220), /invalid cadence/);
  assert.throws(() => h.continuousCadence(events.map((event, i) => ({ at: i === 8 ? NaN : event.at })), 220), /invalid cadence/);
});
