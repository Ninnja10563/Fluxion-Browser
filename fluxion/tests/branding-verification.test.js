"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../chrome/fluxion-branding-verification.js"), "utf8");
function helper(start, end, extra = {}) {
  const first = source.indexOf(start), last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first);
  const sandbox = vm.createContext({ assert(value, message) { if (!value) throw Error(message); }, ...extra });
  vm.runInContext(source.slice(first, last), sandbox);
  return sandbox;
}
test("native branding evidence requires exact resolved product and safety wording, allowing Fluent isolation", () => {
  const report = { strings: {} }, h = helper("  function requireProductString(", "  const painted", {
    report, plain: value => String(value).replace(/[\u2066-\u2069]/g, ""),
  });
  h.requireProductString("quit", "Quit \u2068Fluxion\u2069", "Quit Fluxion");
  assert.equal(report.strings.quit, "Quit Fluxion");
  assert.throws(() => h.requireProductString("quit", "Quit Firefox", "Quit Fluxion"), /Native branded string/);
  assert.throws(() => h.requireProductString("warning", "Fluxion is on guard", "You turned off protections"), /lost meaning/);
  assert.throws(() => h.requireProductString("legal", "Fluxion trademark", "Firefox and the Firefox logos are trademarks of the Mozilla Foundation."), /lost meaning/);
});
test("native mark evidence rejects opaque app tiles, blank images and malformed pixel dimensions", () => {
  const h = helper("  function validateMarkPixels(", "  function validateNativeArt("), pixels = new Uint8ClampedArray(40 * 40 * 4);
  for (let y = 8; y < 32; y++) for (let x = 8; x < 32; x++) pixels[(y * 40 + x) * 4 + 3] = 255;
  const evidence = h.validateMarkPixels(pixels, 40, 40);
  assert.equal(evidence.visible, 576);
  assert.equal(evidence.transparent, 1024);
  const tile = pixels.slice(); tile[3] = 255;
  assert.throws(() => h.validateMarkPixels(tile, 40, 40), /opaque app-tile corner/);
  assert.throws(() => h.validateMarkPixels(new Uint8ClampedArray(pixels.length), 40, 40), /empty/);
  assert.throws(() => h.validateMarkPixels(pixels, 64, 64), /dimensions/);
  const mostlyOpaque = new Uint8ClampedArray(pixels.length).fill(255);
  for (const index of [3, 39 * 4 + 3, 39 * 40 * 4 + 3, pixels.length - 1]) mostlyOpaque[index] = 0;
  assert.throws(() => h.validateMarkPixels(mostlyOpaque, 40, 40), /transparent background/);
});
test("native resource evidence requires exact supplied mark bytes and separate security-state badges", () => {
  const h = helper("  function validateNativeArt(", "  async function artwork("), mark = "fixturePNG";
  const image = '<image href="data:image/png;base64,fixturePNG"/>';
  h.validateNativeArt("chrome://branding/content/about-logo.svg", `<svg>${image}</svg>`, mark);
  h.validateNativeArt("chrome://browser/skin/trustpanel-graphic-warning.svg", `<svg>${image}<path d="M0 0"/></svg>`, mark);
  h.validateNativeArt("chrome://browser/skin/trustpanel-graphic-disabled.svg", `<svg>${image}<circle r="3"/></svg>`, mark);
  assert.throws(() => h.validateNativeArt("about-logo.svg", '<svg><image href="wrong.png"/></svg>', mark), /exact|supplied/);
  assert.throws(() => h.validateNativeArt("about-logo.svg", `<svg aria-label="Firefox">${image}</svg>`, mark), /Firefox branding/);
  for (const state of ["warning", "disabled"]) {
    assert.throws(() => h.validateNativeArt(`trustpanel-graphic-${state}.svg`, `<svg>${image}</svg>`, mark), /status badge/);
  }
});
test("security evidence rejects detached or zero-size popup anchors while allowing native panel insets", () => {
  const h = helper("  function validateSecurityAnchor(", "  async function securityPanel(");
  const anchor = { left: 420, top: 28, bottom: 60, width: 28, height: 32 };
  const panel = { left: 416, top: 64, width: 400, height: 312 };
  const result = h.validateSecurityAnchor(anchor, panel);
  assert.equal(result.anchor.left, 420);
  assert.equal(result.panel.top, 64);
  assert.throws(() => h.validateSecurityAnchor(anchor, { ...panel, left: 4, top: 0 }), /detached/);
  assert.throws(() => h.validateSecurityAnchor(anchor, { ...panel, top: 130 }), /detached/);
  assert.throws(() => h.validateSecurityAnchor({ ...anchor, width: 0 }, panel), /painted bounds/);
  assert.throws(() => h.validateSecurityAnchor(anchor, { ...panel, height: 0 }), /painted bounds/);
});
