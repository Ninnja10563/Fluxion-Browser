"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(require.resolve("../chrome/fluxion-frame-verification.js"), "utf8");
const start = source.indexOf("  function sidebarSurfaceEvidence("), end = source.indexOf("  const rect =", start);
assert.ok(start > 0 && end > start);
const verify = vm.runInNewContext(`${source.slice(start, end)}; sidebarSurfaceEvidence`, {
  window: { getComputedStyle: style => style },
  assert(value, message) { if (!value) throw new Error(message); },
});
const style = (radius, boxShadow) => ({ borderTopLeftRadius: radius, borderTopRightRadius: radius,
  borderBottomRightRadius: radius, borderBottomLeftRadius: radius, boxShadow });
const revealed = "rgba(0, 0, 0, 0.14) 4px 0px 12px 0px, rgb(60, 61, 62) 0px 0px 0px 1px inset";

test("native surface evidence accepts flush expanded and restrained rounded revealed geometry", () => {
  assert.equal(verify(style("0px", "none"), "expanded").boxShadow, "none");
  assert.equal(verify(style("0px", "none"), "expanded-after-reveal").boxShadow, "none");
  assert.equal(verify(style("8px", revealed), "revealed").boxShadow, revealed);
});

test("native surface evidence rejects expanded decoration and missing, oversized or bright revealed shadows", () => {
  for (const candidate of [style("8px", "none"), style("0px", revealed)]) assert.throws(() => verify(candidate, "expanded"));
  for (const candidate of [style("0px", revealed), style("8px", "none"),
    style("8px", revealed.replace("1px inset", "2px inset")),
    style("8px", revealed.replace("12px", "24px")),
    style("8px", revealed.replace("0.14", "0.6")),
    { ...style("8px", revealed), borderBottomLeftRadius: "0px" },
  ]) assert.throws(() => verify(candidate, "revealed"));
});
