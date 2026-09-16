"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const source = fs.readFileSync(require.resolve("../chrome/fluxion-product-chrome-verification.js"), "utf8");
const start = source.indexOf("  async function updateIndicatorGeometry("), end = source.indexOf("  async function run()", start);
function fixture({ hidden = true, error = false } = {}) {
  const indicator = { hidden, getAttribute: () => "idle" }, labels = [], report = {};
  const verify = vm.runInNewContext(`${source.slice(start, end)}; updateIndicatorGeometry`, {
    document: { getElementById: id => id === "fluxion-update-indicator" ? indicator : null },
    window: { requestAnimationFrame: fn => fn() }, report,
    assert(value, message) { if (!value) throw Error(message); }, painted: node => !node.hidden,
    rect: () => ({ width: 30, height: 30 }), geometry(label) {
      assert.equal(indicator.hidden, false); labels.push(label); if (error) throw Error("overlap detected");
    },
  });
  return { verify, indicator, labels, report };
}
test("native indicator fixture measures the actual visible control then restores its original visibility", async () => {
  for (const hidden of [true, false]) {
    const h = fixture({ hidden }); await h.verify("800");
    assert.equal(h.indicator.hidden, hidden);
    assert.deepEqual(h.labels, ["800-update-indicator-geometry-only"]);
    assert.equal(h.report.updateIndicatorGeometry[0].state, "idle");
    assert.match(h.report.updateIndicatorGeometry[0].fixture, /no update offer or installation exercised/);
  }
});
test("native toolbar overlap failure cannot leave an idle update icon visible", async () => {
  const h = fixture({ error: true }); await assert.rejects(h.verify("1280"), /overlap detected/);
  assert.equal(h.indicator.hidden, true); assert.equal(h.report.updateIndicatorGeometry, undefined);
});
