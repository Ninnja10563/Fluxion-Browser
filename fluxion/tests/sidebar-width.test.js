"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const sizing = require("../chrome/core/sidebar-width.js");
const script = fs.readFileSync(require.resolve("../chrome/fluxion-sidebar-width.js"), "utf8");

function fixture(shared = { value: 232, observers: new Set(), writes: 0, saves: 0 }) {
  const frames = new Map(), observations = [];
  let nextFrame = 1;
  class Node {
    constructor() { this.listeners = new Map(); this.attributes = new Map(); this.dataset = {}; }
    addEventListener(type, fn) { const items = this.listeners.get(type) || []; items.push(fn); this.listeners.set(type, items); }
    removeEventListener(type, fn) { this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item !== fn)); }
    emit(type, changes = {}) {
      const event = { type, target: this, isTrusted: true, isPrimary: true, button: 0, pointerId: 7, clientX: 232,
        preventDefault() { this.prevented = true; }, stopPropagation() {}, ...changes };
      for (const fn of [...(this.listeners.get(type) || [])]) fn(event);
      return event;
    }
    setAttribute(key, value) { this.attributes.set(key, value); }
    removeAttribute(key) { this.attributes.delete(key); }
    hasAttribute(key) { return this.attributes.has(key); }
    focus() { document.activeElement = this; }
  }
  const browser = new Node(), flow = new Node(), handle = new Node(), window = new Node(), root = new Node();
  browser.clientWidth = 1200;
  const styles = new Map(), styleWrites = [], layoutReads = [];
  browser.style = { setProperty: (key, value) => {
    styles.set(key, value); styleWrites.push({ value, resizing: root.attributes.has("data-fluxion-sidebar-resizing") });
  } };
  flow.getBoundingClientRect = () => {
    layoutReads.push({ value: styles.get("--fluxion-sidebar-width"), resizing: root.hasAttribute("data-fluxion-sidebar-resizing") });
    return {};
  };
  flow.dataset = { state: "expanded", revealed: "false" };
  const nodes = { browser, "fluxion-flow": flow, "fluxion-sidebar-resizer": handle };
  const document = { documentElement: root, getElementById: id => nodes[id], activeElement: {} };
  const modeButton = new Node(); flow.querySelector = () => modeButton;
  handle.ownerDocument = document; handle.nodePrincipal = { isSystemPrincipal: true };
  handle.setPointerCapture = id => { handle.captured = id; };
  handle.hasPointerCapture = id => handle.captured === id;
  handle.releasePointerCapture = id => { handle.captured = null; handle.emit("lostpointercapture", { pointerId: id }); };
  Object.assign(window, { document, FluxionSidebarSizing: sizing, direction: "ltr",
    getComputedStyle: () => ({ direction: window.direction }),
    requestAnimationFrame: callback => { const id = nextFrame++; frames.set(id, callback); return id; },
    cancelAnimationFrame: id => frames.delete(id),
    MutationObserver: class { constructor(callback) { this.callback = callback; observations.push(this); } observe() {} disconnect() { this.disconnected = true; } },
    ResizeObserver: class { constructor(callback) { this.callback = callback; observations.push(this); } observe() {} disconnect() { this.disconnected = true; } },
  });
  const prefs = {
    getIntPref: () => shared.value,
    setIntPref(_key, value) { shared.value = value; shared.writes++; for (const observer of shared.observers) observer.observe(); },
    savePrefFile() { shared.saves++; },
    addObserver(_key, observer) { shared.observers.add(observer); }, removeObserver(_key, observer) { shared.observers.delete(observer); },
  };
  vm.runInNewContext(script, { window, Services: { prefs } });
  return { shared, window, document, browser, flow, handle, modeButton, styles, styleWrites, layoutReads, frames, observations, prefs,
    api: window.FluxionSidebarWidth,
    flush() { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback()); },
  };
}

test("width limits preserve preferences while reserving content space; RTL keyboard is mirrored", () => {
  assert.equal(sizing.preferred(NaN), 232); assert.equal(sizing.preferred(999), 420);
  for (const malformed of [null, undefined, "", " ", false, true, [], {}, "0x100", "broken"]) {
    assert.equal(sizing.preferred(malformed), 232);
  }
  assert.equal(sizing.preferred(" 264 "), 264); assert.equal(sizing.preferred("232.6"), 233);
  assert.equal(sizing.effective(400, 600), 280); assert.equal(sizing.effective(400, 450), 180);
  assert.equal(sizing.keyboard("ArrowRight", 232, 1200), 240);
  assert.equal(sizing.keyboard("ArrowRight", 232, 1200, { shift: true, rtl: true }), 208);
  assert.equal(sizing.keyboard("End", 232, 600), 280); assert.equal(sizing.keyboard("Home", 232, 1200), 180);
  assert.equal(sizing.keyboard("Enter", 232, 1200), null);
});

test("actual controller synchronizes two windows and responsive layout never rewrites saved width", () => {
  const a = fixture(), b = fixture(a.shared);
  a.api.setWidth(400);
  assert.equal(b.api.preferredWidth(), 400); assert.equal(b.api.effectiveWidth(), 400);
  b.browser.clientWidth = 600; b.observations[1].callback();
  assert.equal(b.api.effectiveWidth(), 280); assert.equal(b.api.preferredWidth(), 400);
  assert.equal(a.shared.writes, 1); assert.equal(a.shared.saves, 1);
  assert.equal(b.handle.attributes.get("aria-valuemax"), "280");
  assert.equal(b.styles.get("--fluxion-sidebar-width"), "280px");
  b.browser.clientWidth = 1200; b.observations[1].callback();
  assert.equal(b.api.effectiveWidth(), 400);
});

test("a width application reads container geometry before writing CSS without a second layout read", () => {
  const f = fixture();
  let reads = 0;
  Object.defineProperty(f.browser, "clientWidth", { get() { reads++; return 1200; } });
  f.api.setWidth(300);
  assert.equal(reads, 1, "ARIA bounds must reuse the pre-write container measurement");
  assert.equal(f.api.effectiveWidth(), 300);
  assert.equal(f.handle.attributes.get("aria-valuemax"), "420");
});

test("pointer preview coalesces frames and commits once using final pointerup coordinate", () => {
  const f = fixture(); const focused = f.document.activeElement;
  f.handle.emit("pointerdown");
  for (let i = 0; i < 100; i++) f.handle.emit("pointermove", { clientX: 250 + i });
  assert.equal(f.frames.size, 1); assert.equal(f.shared.writes, 0);
  f.flush(); assert.equal(f.api.effectiveWidth(), 349);
  f.handle.emit("pointermove", { clientX: 355 });
  f.styleWrites.length = 0;
  f.handle.emit("pointerup", { clientX: 360 });
  assert.deepEqual(f.styleWrites, [{ value: "360px", resizing: true }], "Commit never flashes the old saved width");
  assert.deepEqual(f.layoutReads, [{ value: "360px", resizing: true }], "Final width resolves before transitions resume");
  assert.equal(f.document.documentElement.hasAttribute("data-fluxion-sidebar-resizing"), false);
  assert.equal(f.api.preferredWidth(), 360); assert.equal(f.api.effectiveWidth(), 360);
  assert.equal(f.shared.writes, 1); assert.equal(f.shared.saves, 1); assert.equal(f.frames.size, 0);
  f.flush(); assert.equal(f.api.effectiveWidth(), 360); assert.ok(f.document.activeElement === focused);
});

test("gesture cancellation never saves and late callbacks cannot restore preview", () => {
  for (const kind of ["Escape", "pointercancel", "lostpointercapture", "blur", "state", "unload"]) {
    const f = fixture(); f.handle.emit("pointerdown"); f.handle.emit("pointermove", { clientX: 380 }); f.flush();
    f.handle.emit("pointermove", { clientX: 390 });
    const late = [...f.frames.values()][0];
    if (kind === "Escape") f.window.emit("keydown", { key: "Escape" });
    else if (kind === "blur" || kind === "unload") f.window.emit(kind);
    else if (kind === "state") { f.flow.dataset.state = "compact"; f.observations[0].callback(); }
    else f.handle.emit(kind);
    late(); f.flush();
    assert.equal(f.shared.writes, 0, kind); assert.equal(f.shared.value, 232, kind);
    assert.equal(f.styles.get("--fluxion-sidebar-width"), "232px", kind);
    assert.equal(f.handle.captured, null, kind);
  }
});

test("external preferences cancel active gestures and retain the newest remote value", () => {
  const a = fixture(), b = fixture(a.shared);
  a.handle.emit("pointerdown"); a.handle.emit("pointermove", { clientX: 380 }); a.flush();
  assert.equal(a.api.effectiveWidth(), 380);
  b.api.setWidth(264);
  a.handle.emit("pointerup", { clientX: 400 }); a.flush();
  assert.equal(a.api.effectiveWidth(), 264); assert.equal(a.api.preferredWidth(), 264);
  assert.equal(a.shared.writes, 1);
});

test("untrusted, foreign, modified, secondary and hidden handle input never mutates width", () => {
  for (const options of [{ isTrusted: false }, { target: {} }, { button: 2 }, { isPrimary: false },
    { metaKey: true }, { ctrlKey: true }, { altKey: true }, { shiftKey: true }]) {
    const f = fixture(); f.handle.emit("pointerdown", options); f.handle.emit("pointerup", { clientX: 400 });
    assert.equal(f.shared.writes, 0); assert.equal(f.api.effectiveWidth(), 232);
  }
  const f = fixture(); f.handle.nodePrincipal.isSystemPrincipal = false;
  f.handle.emit("keydown", { key: "End" }); assert.equal(f.shared.writes, 0);
  f.handle.nodePrincipal.isSystemPrincipal = true;
  f.flow.dataset.state = "compact"; f.handle.emit("keydown", { key: "End" }); assert.equal(f.shared.writes, 0);
  f.flow.dataset.state = "focus"; f.handle.emit("keydown", { key: "End" }); assert.equal(f.shared.writes, 0);
});

test("keyboard, double-click reset, revealed Focus and observer teardown use the shipped controller", () => {
  const f = fixture();
  f.handle.emit("keydown", { key: "ArrowRight", shiftKey: true }); assert.equal(f.api.preferredWidth(), 256);
  f.window.direction = "rtl";
  f.handle.emit("keydown", { key: "ArrowRight" }); assert.equal(f.api.preferredWidth(), 248);
  f.handle.emit("dblclick"); assert.equal(f.api.preferredWidth(), 232);
  f.flow.dataset = { state: "focus", revealed: "true" };
  f.browser.clientWidth = 600; f.observations[1].callback();
  f.handle.emit("keydown", { key: "End" }); assert.equal(f.api.preferredWidth(), 280);
  f.window.emit("unload");
  assert.equal(f.shared.observers.size, 0); assert.ok(f.observations.every(observer => observer.disconnected));
  assert.equal(f.window.FluxionSidebarWidth, undefined);
});

test("clamped arrow, zero-distance drag and returning to initial width preserve a wider saved preference", () => {
  for (const kind of ["click", "return", "clamped-arrow"]) {
    const f = fixture(); f.api.setWidth(420);
    f.browser.clientWidth = 700; f.observations[1].callback();
    assert.equal(f.api.effectiveWidth(), 380);
    const writes = f.shared.writes;
    if (kind === "clamped-arrow") f.handle.emit("keydown", { key: "ArrowRight" });
    else {
      f.handle.emit("pointerdown", { clientX: 380 });
      if (kind === "return") { f.handle.emit("pointermove", { clientX: 300 }); f.flush(); }
      f.handle.emit("pointerup", { clientX: 380 });
    }
    assert.equal(f.api.preferredWidth(), 420, kind); assert.equal(f.api.effectiveWidth(), 380, kind);
    assert.equal(f.shared.writes, writes, kind);
    f.browser.clientWidth = 1200; f.observations[1].callback();
    assert.equal(f.api.effectiveWidth(), 420, kind);
  }
});

test("initial and height-only ResizeObserver delivery do not interrupt a captured gesture", () => {
  const f = fixture();
  f.handle.emit("pointerdown"); f.handle.emit("pointermove", { clientX: 320 });
  f.observations[1].callback();
  assert.equal(f.handle.captured, 7); f.flush(); assert.equal(f.api.effectiveWidth(), 320);
  f.browser.clientHeight = 500; f.observations[1].callback();
  assert.equal(f.handle.captured, 7);
  f.handle.emit("pointerup", { clientX: 340 }); assert.equal(f.api.preferredWidth(), 340);
});

test("hiding the focused separator returns focus to the visible mode control or Focus rail only when owned", () => {
  for (const mode of ["compact", "focus"]) for (const owned of [true, false]) {
    const f = fixture(), elsewhere = {};
    f.document.activeElement = owned ? f.handle : elsewhere;
    f.flow.dataset = { state: mode, revealed: "false" };
    f.observations[0].callback();
    assert.ok(f.document.activeElement === (owned ? mode === "compact" ? f.modeButton : f.flow : elsewhere));
  }
  const revealed = fixture(); revealed.handle.focus();
  revealed.flow.dataset = { state: "focus", revealed: "true" }; revealed.observations[0].callback();
  assert.ok(revealed.document.activeElement === revealed.handle);
});

test("ordinary width changes do not force layout; canceled drag resolves saved width before resuming transitions", () => {
  const f = fixture(); f.api.setWidth(280); f.api.resetWidth();
  assert.equal(f.layoutReads.length, 0);
  f.handle.emit("pointerdown"); f.handle.emit("pointermove", { clientX: 380 }); f.flush();
  f.handle.emit("pointercancel");
  assert.deepEqual(f.layoutReads, [{ value: "232px", resizing: true }]);
  assert.equal(f.document.documentElement.hasAttribute("data-fluxion-sidebar-resizing"), false);
});
