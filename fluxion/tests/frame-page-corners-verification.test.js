"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), vm = require("node:vm");
const source = fs.readFileSync(require.resolve("../chrome/fluxion-frame-verification.js"), "utf8");
function fixture() {
  const first = source.indexOf("  function pageCornerEvidence("), last = source.indexOf("  const routePointer", first);
  assert.ok(first > 0 && last > first);
  const stack = { borderTopLeftRadius: "8px", borderTopRightRadius: "8px", borderBottomRightRadius: "8px", borderBottomLeftRadius: "8px", overflowX: "clip", overflowY: "clip" };
  const container = { backgroundColor: "rgb(31, 31, 31)", id: "container" };
  const box = { left: 4, top: 4, width: 800, height: 600 };
  const browser = { closest: selector => selector === ".browserStack" ? stack : container, contains: node => node === browser };
  const state = { corner: container, center: browser };
  const verify = vm.runInNewContext(`${source.slice(first, last)}; pageCornerEvidence`, {
    assert(value, message) { if (!value) throw Error(message); }, rect: () => box,
    window: { getComputedStyle: node => node },
    document: { elementFromPoint: x => x < 10 ? state.corner : state.center },
  });
  return { run: () => verify(browser, "actual-browser-fullscreen"), stack, browser, state };
}
test("page corner evidence requires actual remote-content clip as well as eight-pixel styling", () => {
  const f = fixture();
  assert.equal(f.run().cornerHit, "container");
  f.state.corner = f.browser;
  assert.throws(f.run, /escapes the rounded/);
});
test("page corner evidence rejects square fullscreen overrides, visible overflow and an obscured page", () => {
  for (const change of [f => { f.stack.borderTopLeftRadius = "0px"; },
    f => { f.stack.overflowX = "visible"; }, f => { f.state.center = {}; }]) {
    const f = fixture(); change(f); assert.throws(f.run, /square|unclipped|obscured/);
  }
});
