"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), vm = require("node:vm");
const source = fs.readFileSync(require.resolve("../chrome/fluxion-frame-verification.js"), "utf8");
const begin = source.indexOf("  function nativeFullscreenEdgePoint("), end = source.indexOf("  function sidebarSurfaceEvidence(", begin);
const helpers = source.slice(begin, end);
const check = (value, message) => { if (!value) throw Error(message); };

test("native fullscreen hit coordinates survive Gecko device-pixel rounding inside a one-pixel edge", () => {
  const point = vm.runInNewContext(`${helpers}; nativeFullscreenEdgePoint`, { assert: check });
  const box = { left: 0, right: 1920, top: 0, bottom: 1, width: 1920, height: 1 };
  assert.equal(Math.round((box.top + box.height / 2) * 1), box.bottom, "previous midpoint misses the exclusive bottom boundary");
  for (const scale of [1, 1.25, 1.5, 2, 3]) {
    const result = point(box, scale), rounded = Math.round(result.y * scale) / scale;
    assert.equal(result.y, 0); assert.ok(rounded >= box.top && rounded < box.bottom);
  }
  assert.throws(() => point({ ...box, top: .1, bottom: .2, height: .1 }, 1), /no addressable/);
  assert.throws(() => point(box, 0), /invalid/);
});

test("fullscreen readiness waits for stable active painted presentation rather than early size flags", async () => {
  let now = 0, checks = 0;
  const window = { fullScreen: true, outerWidth: 1920, outerHeight: 1080, innerWidth: 1920, innerHeight: 1080,
    screenX: 0, screenY: 0, performance: { now: () => now },
    windowUtils: { isMozAfterPaintPending: true, isCompositorPaused: true, isWindowFullyOccluded: false } };
  const focus = { activeWindow: null }, document = { hasFocus: () => focus.activeWindow === window };
  const settle = vm.runInNewContext(`${helpers}; settleFullscreenPresentation`, { window, document, Services: { focus }, assert: check,
    wait: async condition => {
      for (let attempt = 0; attempt < 50; attempt++) {
        now += 100; checks++;
        if (now === 300) window.innerHeight = 1079;
        if (now === 1400) { focus.activeWindow = window; window.windowUtils.isCompositorPaused = false; }
        if (now === 1700) window.windowUtils.isMozAfterPaintPending = false;
        if (condition()) return;
      }
      throw Error("bounded fixture timeout");
    } });
  const evidence = await settle(true);
  assert.equal(evidence.elapsed, 1700); assert.ok(checks >= 17); assert.ok(evidence.stableForMs >= 1000);
  assert.equal(evidence.pendingPaint, false); assert.equal(evidence.compositorPaused, false);
});
