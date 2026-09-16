"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(require.resolve("../chrome/fluxion-frame-verification.js"), "utf8");
const start = source.indexOf("  function floatingSidebarEvidence("), end = source.indexOf("  async function focusNavigation(", start);
assert.ok(start > 0 && end > start);
let hit = null;
const api = vm.runInNewContext(`${source.slice(start, end)}; ({ floatingSidebarEvidence, newTabGeometryEvidence, nativeAddressEvidence, navigationControlHitEvidence })`, {
  document: { elementFromPoint: () => hit },
  window: { innerHeight: 800, getComputedStyle: node => node.style }, rect: node => node.box,
  near: (a, b) => Math.abs(a - b) < 1.5,
  assert(value, message) { if (!value) throw new Error(message); },
});
test("native left navigation hit targets reject sidebar coverage even when their layout is unchanged", () => {
  const control = { id: "back-button", box: { left: 6, top: 6, width: 32, height: 32 }, contains: node => node === control };
  hit = control;
  assert.equal(api.navigationControlHitEvidence(control).hit, "back-button");
  hit = { id: "floating-workspace-heading" };
  assert.throws(() => api.navigationControlHitEvidence(control), /obscured by floating chrome/);
});
const flow = { box: { left: 0, right: 3, top: 0, bottom: 800 }, style: { direction: "ltr" } };
const surface = (revealed = true) => ({ inert: !revealed,
  box: { left: revealed ? 6 : -232, right: revealed ? 238 : 0, top: 6, bottom: 794 },
  heading: { box: { top: 12 } }, querySelector() { return this.heading; },
  style: { visibility: revealed ? "visible" : "hidden", pointerEvents: revealed ? "auto" : "none" },
});
test("native floating-sidebar gate checks real six-pixel clearances and complete offscreen hiding", () => {
  assert.equal(api.floatingSidebarEvidence(flow, surface(), true).mode, "floating-revealed-insets");
  assert.equal(api.floatingSidebarEvidence(flow, surface(false), false).visibility, "hidden");
  const rtl = { box: { left: 997, right: 1000, top: 0, bottom: 800 }, style: { direction: "rtl" } };
  const shown = surface(); shown.box.left = 762; shown.box.right = 994;
  api.floatingSidebarEvidence(rtl, shown, true);
  const hidden = surface(false); hidden.box.left = 1000; hidden.box.right = 1232;
  api.floatingSidebarEvidence(rtl, hidden, false);
  const toolbarReservedRail = { ...flow, box: { ...flow.box, top: 88 } };
  assert.equal(api.floatingSidebarEvidence(toolbarReservedRail, surface(), true).box.top, 6,
    "floating surface is anchored to viewport, not the rail below native navigation");
});
test("native floating-sidebar gate rejects corner slivers, missing spacing and inert visible controls", () => {
  const mutations = [
    [false, node => { node.box.right = 3; }],
    [false, node => { node.style.visibility = "visible"; }],
    [false, node => { node.style.pointerEvents = "auto"; }],
    [true, node => { node.box.left = 0; }],
    [true, node => { node.box.top = 0; }],
    [true, node => { node.box.bottom = 800; }],
    [true, node => { node.box.top = 94; node.heading.box.top = 100; }],
    [true, node => { node.heading.box.top = 18; }],
    [true, node => { node.inert = true; }],
  ];
  for (const [revealed, mutate] of mutations) {
    const candidate = surface(revealed); mutate(candidate);
    assert.throws(() => api.floatingSidebarEvidence(flow, candidate, revealed), /sidebar/i);
  }
});
function tab(height) {
  return { box: { left: 7, top: 90, width: 218, height }, style: {
    borderTopLeftRadius: "7px", borderTopRightRadius: "7px", borderBottomLeftRadius: "7px", borderBottomRightRadius: "7px",
  } };
}
test("native new-tab hover gate accepts normal row geometry in all densities", () => {
  for (const [density, height] of [["compact", 28], ["standard", 34], ["roomy", 36]]) {
    const row = tab(height), button = tab(height); button.box.top = 170;
    assert.equal(api.newTabGeometryEvidence(density, row, button, { ...button.box }).after.height, height);
  }
});
test("native new-tab hover gate rejects undersized, shifted, expanding or mismatched-radius controls", () => {
  for (const mutate of [node => { node.box.height = 26; }, node => { node.box.width = 210; },
    node => { node.box.left = 10; }, node => { node.box.top += 3; }, node => { node.style.borderTopLeftRadius = "3px"; }]) {
    const row = tab(34), button = tab(34), before = { ...button.box }; mutate(button);
    assert.throws(() => api.newTabGeometryEvidence("standard", row, button, before), /New tab|Hover/);
  }
});

test("native Focus gate checks top-layer address paint and hit testing independently of toolbox geometry", () => {
  const field = { box: { left: 280, top: 6, width: 700, height: 32 }, id: "urlbar-input" };
  const urlbar = { style: { opacity: "0", pointerEvents: "none" }, contains: node => node === field, matches: () => true };
  hit = { id: "webpage" };
  assert.equal(api.nativeAddressEvidence(urlbar, field, false).popover, true, "native popover stays owned by Gecko while its paint is hidden");
  urlbar.style.opacity = "1";
  assert.throws(() => api.nativeAddressEvidence(urlbar, field, false), /painted/);
  urlbar.style.opacity = "0"; hit = field;
  assert.throws(() => api.nativeAddressEvidence(urlbar, field, false), /intercepting/);
  urlbar.style.opacity = "1"; urlbar.style.pointerEvents = "auto";
  api.nativeAddressEvidence(urlbar, field, true);
  hit = { id: "obscuring-panel" };
  assert.throws(() => api.nativeAddressEvidence(urlbar, field, true), /restore/);
});
