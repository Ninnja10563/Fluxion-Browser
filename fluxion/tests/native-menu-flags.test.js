"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "../chrome/fluxion-chrome.js"), "utf8");
function fixture() {
  const context = vm.createContext({ XUL: "xul", document: { createElementNS() {
    const attrs = new Map();
    return { attrs, setAttribute: (name, value) => attrs.set(name, String(value)), removeAttribute: name => attrs.delete(name) };
  } } });
  vm.runInContext(source.slice(source.indexOf("  function setNativeMenuFlag("), source.indexOf("  const on =")) +
    "\nglobalThis.createMenu = xul;", context);
  return context;
}
test("native menu factory omits false boolean attributes without changing labels or ARIA false values", () => {
  const f = fixture();
  for (const value of [false, "false", undefined]) {
    const item = f.createMenu("menuitem", { checked: value, disabled: value, label: "false", "aria-expanded": "false" });
    assert.equal(item.attrs.has("checked"), false);
    assert.equal(item.attrs.has("disabled"), false);
    assert.equal(item.attrs.get("label"), "false");
    assert.equal(item.attrs.get("aria-expanded"), "false");
  }
  const checked = f.createMenu("menuitem", { checked: true, disabled: "true" });
  assert.equal(checked.attrs.get("checked"), "true");
  assert.equal(checked.attrs.get("disabled"), "true");
});
test("native menu updates remove stale checked and disabled flags instead of writing false text", () => {
  const f = fixture(), item = f.createMenu("menuitem", { checked: true, disabled: true });
  for (const name of ["checked", "disabled"]) {
    f.setNativeMenuFlag(item, name, false);
    assert.equal(item.attrs.has(name), false);
    f.setNativeMenuFlag(item, name, true);
    assert.equal(item.attrs.get(name), "true");
    f.setNativeMenuFlag(item, name, false);
    assert.equal(item.attrs.has(name), false);
  }
});
