"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../chrome/fluxion-chrome-layout.js"), "utf8");

function fixture({ rail = { left: 0, right: 232, width: 232 },
  controls = { left: 82, right: 1200, width: 1118 }, direction = "ltr", missing = null } = {}) {
  const writes = [], frames = new Map(), listeners = new Map(), observers = [];
  let sequence = 0, reads = 0;
  const element = name => ({ style: { values: new Map(), setProperty(key, value) {
    this.values.set(key, value); writes.push([name, key, value]);
  } } });
  const root = element("root"), nav = element("nav");
  const flow = { getBoundingClientRect() { reads++; return { ...rail }; } };
  const target = { getBoundingClientRect() { reads++; return { ...controls }; } };
  const nodes = { "fluxion-flow": flow, "nav-bar": nav, "nav-bar-customization-target": target };
  if (missing) delete nodes[missing];
  const observer = kind => class {
    constructor(callback) { this.callback = callback; this.kind = kind; this.observed = []; observers.push(this); }
    observe(node, options) { this.observed.push({ node, options }); }
    disconnect() { this.disconnected = true; }
  };
  const window = {
    document: { documentElement: root, getElementById: id => nodes[id] || null },
    getComputedStyle: () => ({ direction }),
    ResizeObserver: observer("resize"), MutationObserver: observer("mutation"),
    requestAnimationFrame(callback) { const id = ++sequence; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    addEventListener(type, callback) { listeners.set(type, callback); },
    removeEventListener(type, callback) { if (listeners.get(type) === callback) listeners.delete(type); },
  };
  const context = vm.createContext({ window });
  const run = () => vm.runInContext(source, context);
  run();
  return {
    window, root, nav, flow, target, writes, frames, observers, listeners, run,
    get reads() { return reads; },
    offset: () => nav.style.values.get("--fluxion-navigation-offset"),
    width: () => root.style.values.get("--fluxion-chrome-rail"),
    geometry(nextRail, nextControls = controls) { rail = nextRail; controls = nextControls; },
    direction(value) { direction = value; },
    flush() { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback()); },
  };
}

test("navigation alignment subtracts native window-control reservation instead of duplicating its width", () => {
  const f = fixture();
  assert.equal(f.offset(), "150px");
  assert.equal(f.width(), "232px");
  assert.equal(82 + Number.parseInt(f.offset()), 232,
    "Reserved traffic-light space plus navigation padding must reach the page column exactly");
  assert.equal(f.reads, 2);
  f.geometry({ left: 0, right: 232, width: 232 }, { left: 0, right: 1200, width: 1200 });
  f.window.FluxionChromeLayout.refresh(); f.flush();
  assert.equal(f.offset(), "232px", "Fullscreen without native window controls needs the entire rail offset");
});

test("narrow toolbars cap sidebar alignment to preserve 480 pixels for native navigation and overflow", () => {
  const f = fixture({ controls: { left: 82, right: 662, width: 580 } });
  assert.equal(f.offset(), "100px");
  assert.equal(f.width(), "232px", "The sidebar column is not changed by toolbar fallback");
  f.geometry({ left: 0, right: 232, width: 232 }, { left: 82, right: 502, width: 420 });
  f.window.FluxionChromeLayout.refresh(); f.flush();
  assert.equal(f.offset(), "0px");
  f.geometry({ left: 0, right: 44, width: 44 }, { left: 82, right: 1200, width: 1118 });
  f.window.FluxionChromeLayout.refresh(); f.flush();
  assert.equal(f.offset(), "0px", "A compact rail inside reserved window-control width cannot cause negative padding");
  assert.equal(f.width(), "44px");
});

test("RTL alignment uses the right-hand toolbar origin and follows live direction changes", () => {
  const f = fixture({ direction: "rtl", rail: { left: 968, right: 1200, width: 232 },
    controls: { left: 0, right: 1118, width: 1118 } });
  assert.equal(f.offset(), "150px");
  assert.equal(1118 - Number.parseInt(f.offset()), 968);
  const appearance = f.observers.find(observer => observer.kind === "mutation");
  assert.equal(appearance.observed[0].node, f.root);
  assert.deepEqual(Array.from(appearance.observed[0].options.attributeFilter),
    ["inFullscreen", "inDOMFullscreen", "sizemode", "chromedir"]);
  f.direction("ltr");
  f.geometry({ left: 0, right: 232, width: 232 }, { left: 82, right: 1200, width: 1118 });
  appearance.callback(); f.flush();
  assert.equal(f.offset(), "150px");
  f.geometry({ left: 0, right: 3, width: 3 });
  appearance.callback(); f.flush();
  assert.equal(f.offset(), "0px");
  assert.equal(f.width(), "3px");
});

test("resize, customization and explicit refresh share one frame and skip unchanged style writes", () => {
  const f = fixture(), resize = f.observers.find(observer => observer.kind === "resize");
  assert.deepEqual(resize.observed.map(item => item.node), [f.flow, f.nav]);
  f.geometry({ left: 0, right: 279.6, width: 279.6 });
  resize.callback(); resize.callback();
  f.listeners.get("aftercustomization")();
  f.window.FluxionChromeLayout.refresh();
  assert.equal(f.frames.size, 1);
  assert.equal(f.reads, 2, "Events must not force immediate repeated layout reads");
  f.flush();
  assert.equal(f.offset(), "198px");
  assert.equal(f.width(), "280px");
  assert.equal(f.reads, 4);
  const writes = f.writes.length;
  resize.callback(); f.flush();
  assert.equal(f.writes.length, writes, "Observer feedback with identical geometry must not write styles again");
  assert.equal(f.frames.size, 0);
});

test("unload cancels pending alignment, disconnects observers and makes stale callbacks harmless", () => {
  const f = fixture(), api = f.window.FluxionChromeLayout;
  api.refresh();
  const staleFrame = [...f.frames.values()][0], reads = f.reads, writes = f.writes.length;
  f.listeners.get("unload")();
  assert.equal(f.frames.size, 0);
  assert.ok(f.observers.every(observer => observer.disconnected));
  assert.equal(f.listeners.has("aftercustomization"), false);
  staleFrame(); api.refresh();
  f.observers.forEach(observer => observer.callback());
  assert.equal(f.frames.size, 0);
  assert.equal(f.reads, reads);
  assert.equal(f.writes.length, writes);
});

test("missing chrome nodes and repeat initialization never register duplicate layout controllers", () => {
  for (const missing of ["fluxion-flow", "nav-bar", "nav-bar-customization-target"]) {
    const f = fixture({ missing });
    assert.equal(f.window.FluxionChromeLayout, undefined);
    assert.equal(f.observers.length, 0); assert.equal(f.listeners.size, 0); assert.equal(f.reads, 0);
  }
  const f = fixture(), api = f.window.FluxionChromeLayout;
  f.run();
  assert.equal(f.window.FluxionChromeLayout, api);
  assert.equal(f.observers.length, 2); assert.equal(f.listeners.size, 2); assert.equal(f.reads, 2);
});
