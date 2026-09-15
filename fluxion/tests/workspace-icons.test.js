"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const symbols = require("../chrome/core/workspace-icons.js");
const workspaces = require("../chrome/core/workspaces.js");

test("workspace symbols preserve every serialized choice across session restoration", () => {
  assert.deepEqual(Object.keys(symbols.icons), [...workspaces.ICONS]);
  assert.deepEqual(symbols.choices, [
    ["circle", "Compass"], ["diamond", "Code"], ["square", "Briefcase"],
    ["arc", "Leaf"], ["grid", "Open book"],
  ]);
  const saved = workspaces.ICONS.map((icon, index) => ({ id: `space-${index}`, name: `Space ${index}`, icon, accent: "slate" }));
  for (const [index, restored] of workspaces.parseWorkspaces(JSON.stringify(saved)).entries()) {
    assert.equal(restored.icon, saved[index].icon);
    assert.equal(symbols.get(restored.icon).label, symbols.choices[index][1]);
  }
});

test("workspace SVG definitions are inert fixed geometry with a consistent inline treatment", () => {
  assert.equal(symbols.viewBox, "0 0 24 24");
  assert.equal(symbols.attributes.width, "18");
  assert.equal(symbols.attributes.height, "18");
  assert.equal(symbols.attributes.stroke, "currentColor");
  assert.equal(symbols.attributes.fill, "none");
  assert.equal(symbols.attributes["stroke-width"], "2");
  assert.equal(symbols.attributes["aria-hidden"], "true");
  assert.equal(symbols.attributes.focusable, "false");
  const allowed = { path: ["d"], circle: ["cx", "cy", "r"], rect: ["width", "height", "x", "y", "rx"] };
  for (const icon of Object.values(symbols.icons)) {
    assert.ok(icon.shapes.length >= 2);
    for (const { tag, attributes } of icon.shapes) {
      assert.ok(Object.hasOwn(allowed, tag), `inert SVG element: ${tag}`);
      for (const [name, value] of Object.entries(attributes)) {
        assert.ok(allowed[tag].includes(name), `${tag}.${name}`);
        assert.equal(typeof value, "string");
        assert.match(value, name === "d" ? /^[MmLlHhVvCcSsQqTtAaZz\d.\s,+-]+$/ : /^\d+(?:\.\d+)?$/);
      }
    }
  }
});

test("imported or prototype-shaped symbol IDs cannot become SVG definitions", () => {
  for (const value of [undefined, null, "", "__proto__", "constructor", "toString", "<svg onload=alert(1)>", {}, ["arc"]]) {
    assert.equal(symbols.get(value), symbols.icons.circle);
  }
  for (const id of workspaces.ICONS) assert.equal(symbols.get(id), symbols.icons[id]);
});

test("shared symbols cannot be mutated by one window or settings consumer", () => {
  const assertDeepFrozen = value => {
    if (!value || typeof value !== "object") return;
    assert.ok(Object.isFrozen(value));
    for (const item of Object.values(value)) assertDeepFrozen(item);
  };
  assertDeepFrozen(symbols);
  assert.throws(() => { symbols.get("arc").shapes[0].attributes.d = "M0 0"; }, TypeError);
  assert.throws(() => { symbols.choices[0][1] = "Changed"; }, TypeError);
  assert.throws(() => { symbols.attributes.fill = "red"; }, TypeError);
});
