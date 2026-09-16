"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), vm = require("node:vm");
const source = fs.readFileSync(require.resolve("../chrome/fluxion-frame-verification.js"), "utf8");
const first = source.indexOf("  function sidebarMotionEvidence("), last = source.indexOf("  const routePointer", first);
assert.ok(first > 0 && last > first);
function fixture({ reduced = false, preference = false } = {}) {
  return vm.runInNewContext(`${source.slice(first, last)}; sidebarMotionEvidence`, {
    assert(value, message) { if (!value) throw Error(message); },
    window: { getComputedStyle: node => node, matchMedia: () => ({ matches: reduced }) },
    document: { documentElement: { hasAttribute: () => preference } },
  });
}
const motion = { transitionProperty: "transform, opacity, box-shadow, visibility",
  transitionDuration: "0.14s, 0.1s, 0.14s, 0s", transitionDelay: "0s, 0s, 0s, 0.14s", pointerEvents: "none" };
test("sidebar motion gate requires delayed exit visibility but immediate reveal and input release", () => {
  const verify = fixture();
  assert.equal(verify(motion, false).delays[3], .14);
  assert.equal(verify({ ...motion, transitionDelay: "0s", pointerEvents: "auto" }, true).revealed, true);
  assert.throws(() => verify({ ...motion, transitionDelay: "0s" }, false), /140ms retract/);
  assert.throws(() => verify(motion, true), /reveal immediately/);
  assert.throws(() => verify({ ...motion, pointerEvents: "auto" }, false), /intercepts/);
});
test("both reduced-motion routes reject lingering visibility delay even with near-zero duration", () => {
  for (const options of [{ reduced: true }, { preference: true }]) {
    const verify = fixture(options);
    assert.throws(() => verify({ ...motion, transitionDuration: "0.00001s" }, false), /Reduced motion/);
    assert.equal(verify({ ...motion, transitionDuration: "0.00001s", transitionDelay: "0s" }, false).reduced, true);
    assert.equal(verify({ ...motion, transitionProperty: "none", transitionDuration: "0s", transitionDelay: "0s" }, false).reduced, true);
  }
});
