"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const colors = require("../chrome/core/colors.js");
const source = fs.readFileSync(require.resolve("../chrome/fluxion-colors-verification.js"), "utf8");
const start = source.indexOf("  function checkboxEvidence("), end = source.indexOf("  let companion", start);
assert.ok(start > 0 && end > start);
const rgb = hex => `rgb(${[1, 3, 5].map(index => Number.parseInt(hex.slice(index, index + 2), 16)).join(", ")})`;
const evidence = vm.runInNewContext(`${source.slice(start, end)}; checkboxEvidence`, {
  FluxionColorsCore: colors, rgb,
  assert(value, message) { if (!value) throw new Error(message); },
});
function fixture(palette) {
  const style = { appearance: "auto", renderer: "", accentColor: rgb(colors.palette(palette).accent),
    getPropertyValue(name) { return name === "-moz-theme" ? this.renderer : ""; } };
  const box = { left: 600, top: 300, width: 15, height: 15 };
  const node = { checked: true, disabled: false, getBoundingClientRect: () => box };
  let hit = node;
  const target = { getComputedStyle: () => style,
    document: { getElementById: id => id === "fluxion-colors-enabled" ? node : null, elementFromPoint: () => hit } };
  return { target, node, style, box, cover() { hit = {}; }, run: () => evidence(target, palette, "fixture") };
}
test("native checkbox gate checks public native appearance, visible checked control and derived accessible accent", () => {
  for (const palette of [{ base: "#202d36", accent: "#ff6bb5" }, { base: "#ddd7cd", accent: "#603d1c" },
    { base: "#ffffff", accent: "#ffffff" }]) {
    const f = fixture(palette), result = f.run();
    assert.equal(result.projectedAccent, colors.palette(palette).accent);
    assert.equal(result.renderer, ""); assert.equal(result.checked, true);
    assert.match(result.rendererEvidence, /unavailable through string CSSOM/);
  }
});
test("native checkbox gate rejects stale accent, custom drawing and obscured controls", () => {
  for (const mutate of [f => { f.style.accentColor = "rgb(0, 120, 255)"; },
    f => { f.style.appearance = "none"; }, f => { f.node.checked = false; }, f => { f.node.disabled = true; },
    f => { f.box.height = 0; }, f => f.cover()]) {
    const f = fixture({ base: "#202d36", accent: "#ff6bb5" }); mutate(f);
    assert.throws(f.run, /Settings checkbox|Settings control/);
  }
});
test("native workspace checkbox capture pairs visible preview with cancellation back to saved palette", () => {
  const runner = fs.readFileSync(require.resolve("../scripts/verify-macos-colors.sh"), "utf8");
  assert.match(source, /preview\.update\(\{[\s\S]*darkAccent: workspacePalette\.accent/);
  assert.match(source, /finally \{ preview\.clear\(\); \}/);
  assert.match(source, /checkboxEvidence\(window, expected\.dark, "workspace-preview-cancelled"\)/);
  assert.match(source, /capture\("capture-colors-workspace-settings"\)/);
  assert.match(source, /native-captures-for-visual-review/);
  assert.match(runner, /for action in[^\n]*capture-colors-workspace-settings/);
});
