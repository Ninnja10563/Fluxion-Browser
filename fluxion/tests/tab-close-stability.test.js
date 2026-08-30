"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

require(path.resolve(__dirname, "../chrome/core/tab-close-stability.js"));
const stability = globalThis.FluxionTabCloseStability;

test("close guards add a restrained margin around the original pointer target", () => {
  assert.deepEqual(
    stability.guardRect({ left: 100, top: 40, width: 22, height: 22 }),
    { left: 96, right: 126, top: 36, bottom: 66 },
  );
});

test("the held row releases only after the pointer leaves its close target", () => {
  const guard = stability.guardRect({ left: 100, top: 40, width: 22, height: 22 });
  assert.equal(stability.shouldRelease(guard, { clientX: 111, clientY: 51 }), false);
  assert.equal(stability.shouldRelease(guard, { clientX: 96, clientY: 36 }), false);
  assert.equal(stability.shouldRelease(guard, { clientX: 95, clientY: 51 }), true);
  assert.equal(stability.shouldRelease(guard, { clientX: Number.NaN, clientY: 51 }), true);
});

test("malformed geometry cannot create an unbounded close guard", () => {
  assert.deepEqual(
    stability.guardRect({ left: "bad", top: null, width: -10, height: Infinity }, -4),
    { left: 0, right: 0, top: 0, bottom: 0 },
  );
});
