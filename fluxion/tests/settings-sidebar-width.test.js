"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const settingsWindow = require("./settings-window-fixture.js");

function fixture() {
  let preferred = 300;
  const observers = new Map(), writes = [];
  const prefs = {
    getIntPref: (name, fallback) => name === "fluxion.sidebar.width" ? preferred : fallback,
    getStringPref: (_name, fallback) => fallback, getBoolPref: (_name, fallback) => fallback,
    setStringPref() {}, savePrefFile() {},
    addObserver(name, observer) { if (!observers.has(name)) observers.set(name, new Set()); observers.get(name).add(observer); },
    removeObserver(name, observer) { observers.get(name)?.delete(observer); },
  };
  const external = value => {
    preferred = value;
    for (const observer of observers.get("fluxion.sidebar.width") || []) observer.observe(null, "nsPref:changed", "fluxion.sidebar.width");
  };
  const service = { bounds: { min: 180, max: 420, default: 232 },
    preferredWidth: () => preferred, effectiveWidth: () => 180,
    setWidth(value) { writes.push(value); external(value); }, resetWidth() { writes.push(232); external(232); } };
  const open = () => {
    const h = settingsWindow("about:preferences", [], { sharedPrefs: prefs, sidebarWidth: service });
    return { ...h, input: h.document.getElementById("fluxion-sidebar-width-choice"), reset: h.document.getElementById("fluxion-sidebar-width-reset") };
  };
  return { a: open(), b: open(), writes, external, preferred: () => preferred, observers };
}

test("width shows saved preference rather than narrow-window effective width and commits/reset across Settings windows", () => {
  const h = fixture();
  assert.equal(h.a.input.value, "300");
  assert.equal(h.a.input.type, "number");
  assert.equal(h.a.input.min, "180"); assert.equal(h.a.input.max, "420");
  assert.equal(h.a.input.getAttribute("aria-label"), "Sidebar width");
  assert.match(h.a.reset.getAttribute("aria-label"), /232 pixels/);
  assert.ok(h.a.document.getElementById(h.a.input.getAttribute("aria-describedby")));
  const controls = h.a.document.getElementById("fluxion-sidebar-width-controls");
  assert.equal(controls.getAttribute("role"), "group");
  assert.equal(h.a.document.getElementById(controls.getAttribute("aria-labelledby")).textContent, "Sidebar width");
  assert.match(h.a.input.className, /fluxion-settings-control/);
  assert.match(h.a.document.getElementById(h.a.input.getAttribute("aria-describedby")).textContent, /pixels.*180.*420/);
  h.a.input.value = "360";
  h.a.input.dispatchEvent({ type: "change" });
  assert.deepEqual(h.writes, [360]);
  assert.equal(h.b.input.value, "360");
  h.external(275);
  assert.equal(h.a.input.value, "275");
  assert.deepEqual(h.writes, [360], "external synchronization does not save a second time");
  h.b.reset.dispatchEvent({ type: "click" });
  assert.equal(h.a.input.value, "232"); assert.equal(h.b.input.value, "232");
});

test("a width draft survives remote drag updates; Escape restores latest saved width without a write", () => {
  const h = fixture();
  h.a.document.activeElement = h.a.input;
  h.a.input.value = "399";
  h.a.input.dispatchEvent({ type: "input" });
  h.external(260);
  assert.equal(h.a.input.value, "399"); assert.equal(h.b.input.value, "260");
  let prevented = false, stopped = false;
  h.a.input.dispatchEvent({ type: "keydown", key: "Escape", preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } });
  assert.ok(prevented && stopped);
  assert.equal(h.a.input.value, "260"); assert.deepEqual(h.writes, []);
  h.a.input.dispatchEvent({ type: "change" });
  assert.equal(h.preferred(), 260, "later blur cannot commit the discarded draft");
});

test("invalid/out-of-range numeric edits restore saved width and never reach adapter", () => {
  const h = fixture();
  for (const value of ["", " ", "abc", "NaN", "Infinity", "179", "421", "250.5"]) {
    h.a.input.value = value;
    h.a.input.dispatchEvent({ type: "input" });
    h.a.input.dispatchEvent({ type: "change" });
    assert.equal(h.a.input.value, "300", value);
    assert.deepEqual(h.writes, []);
  }
  for (const value of ["180", "420"]) {
    h.a.input.value = value; h.a.input.dispatchEvent({ type: "change" });
    assert.equal(h.preferred(), Number(value));
  }
});

test("width updates stop after Settings unload", () => {
  const h = fixture();
  h.a.unload();
  h.external(320);
  assert.equal(h.a.input.value, "300"); assert.equal(h.b.input.value, "320");
  assert.equal(h.observers.get("fluxion.sidebar.width").size, 1);
});
