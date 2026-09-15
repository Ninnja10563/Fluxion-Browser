"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const swipe = require("../chrome/core/workspace-swipe.js");
const source = fs.readFileSync(require.resolve("../chrome/fluxion-workspace-gestures.js"), "utf8");

function target() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(type, callback, options) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push({ callback, options });
    },
    removeEventListener(type, callback) {
      listeners.set(type, (listeners.get(type) || []).filter(listener => listener.callback !== callback));
    },
    emit(type, event = {}) { for (const { callback } of [...listeners.get(type) || []]) callback(event); },
  };
}

function runtime() {
  let time = 0, current = "two", editing = false;
  const switched = [], attributes = new Set(), timers = [], frames = new Map(), animations = [], observers = [];
  let frameID = 0;
  let workspaces = [{ id: "one" }, { id: "two" }, { id: "three" }];
  const document = target(), surface = target(), flow = { dataset: { state: "expanded" }, querySelector: () => surface };
  const row = { ownerDocument: document, closest: () => editing ? {} : null };
  surface.nodePrincipal = { isSystemPrincipal: true };
  surface.contains = node => node === row;
  const list = { animate(keyframes, options) {
    const animation = { keyframes, options, cancelled: false, cancel() { this.cancelled = true; } };
    animations.push(animation);
    return animation;
  } };
  surface.querySelector = selector => selector === ".fluxion-tab-scroll" ? list : null;
  document.documentElement = { hasAttribute: name => attributes.has(name) };
  document.getElementById = id => id === "fluxion-flow" ? flow : null;
  const reducedMotion = Object.assign(target(), { matches: false });
  const window = Object.assign(target(), {
    document, gBrowser: {}, FluxionWorkspaceSwipe: swipe, performance: { now: () => time },
    setTimeout(callback, delay) { assert.equal(delay, 0); timers.push(callback); },
    matchMedia: () => reducedMotion,
    requestAnimationFrame(callback) { frames.set(++frameID, callback); return frameID; },
    cancelAnimationFrame: id => frames.delete(id),
    MutationObserver: class {
      constructor(callback) { this.callback = callback; observers.push(this); }
      observe() {}
      disconnect() { this.disconnected = true; }
    },
    FluxionUI: {
      currentWorkspace: () => current,
      workspaces: () => workspaces,
      switchWorkspace(id) { switched.push(id); current = id; },
    },
  });
  const focus = { activeWindow: window };
  const context = { window, Services: { focus } };
  const load = () => vm.runInNewContext(source, context);
  load();
  function wheel(overrides = {}, advance = 16) {
    time += advance;
    const event = {
      target: row, isTrusted: true, cancelable: true, defaultPrevented: false,
      deltaX: 60, deltaY: 0, deltaMode: 0, stopped: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.stopped = true; },
      ...overrides,
    };
    surface.emit("wheel", event);
    return event;
  }
  return { window, document, flow, surface, row, wheel, switched, attributes, load, focus, animations, reducedMotion,
    flushTimers: () => { while (timers.length) timers.shift()(); },
    flushFrames: () => { const callbacks = [...frames.values()]; frames.clear(); for (const callback of callbacks) callback(); },
    updateMotion: () => { for (const observer of observers) if (!observer.disconnected) observer.callback(); },
    setEditing: value => { editing = value; },
    setWorkspaces: value => { workspaces = value; },
    setCurrent: value => { current = value; },
  };
}

test("actual controller registers a nonpassive sidebar-only wheel route, with threshold and inertia ownership", () => {
  const env = runtime();
  assert.equal(env.surface.listeners.get("wheel").length, 1);
  assert.equal(env.surface.listeners.get("wheel")[0].options.passive, false);
  assert.equal(env.document.listeners.has("wheel"), false);
  assert.equal(env.window.listeners.has("wheel"), false);
  assert.equal(env.wheel({ deltaX: 12 }).defaultPrevented, true);
  assert.deepEqual(env.switched, []);
  env.wheel({ deltaX: 44 });
  for (let i = 0; i < 40; i++) env.wheel();
  assert.deepEqual(env.switched, ["three"]);
  env.wheel({ deltaX: -70 }, 240);
  assert.deepEqual(env.switched, ["three", "two"]);
});

test("actual controller accepts deliberate rapid reversals and fresh same-direction gestures in both directions", () => {
  const env = runtime();
  env.setCurrent("one");
  env.wheel();
  env.wheel({ deltaX: -28 });
  assert.deepEqual(env.switched, ["two"]);
  env.wheel({ deltaX: -28 });
  env.wheel();
  assert.deepEqual(env.switched, ["two", "one", "two"]);
  for (const delta of [24, 12, 4, 2]) env.wheel({ deltaX: delta });
  env.wheel();
  assert.deepEqual(env.switched, ["two", "one", "two", "three"]);
  env.wheel({ deltaX: -60 });
  for (const delta of [-24, -12, -4, -2]) env.wheel({ deltaX: delta });
  env.wheel({ deltaX: -60 });
  assert.deepEqual(env.switched, ["two", "one", "two", "three", "two", "one"]);
});

test("workspace animation affects only the tab list, waits for the render frame and replaces superseded motion", () => {
  const env = runtime(), api = env.window.FluxionWorkspaceGestures;
  api.animateSwitch(1);
  api.animateSwitch(-1);
  assert.equal(env.animations.length, 0, "no animation before the pending render frame");
  env.flushFrames();
  assert.equal(env.animations.length, 1);
  assert.equal(env.animations[0].keyframes[0].transform, "translateX(-4px)");
  assert.equal(env.animations[0].options.duration, 150);
  api.animateSwitch(1);
  assert.equal(env.animations[0].cancelled, true);
  env.flushFrames();
  assert.equal(env.animations[1].keyframes[0].transform, "translateX(4px)");
  assert.deepEqual(env.switched, [], "animation never navigates or delays a workspace operation");
  env.window.emit("unload");
  assert.equal(env.animations[1].cancelled, true);
});

test("workspace animation respects reduced motion, the Settings toggle, hidden state and unload", () => {
  const env = runtime(), api = env.window.FluxionWorkspaceGestures;
  api.animateSwitch(0); env.flushFrames();
  env.flow.dataset.state = "focus"; env.flow.dataset.revealed = "false";
  api.animateSwitch(1); env.flushFrames();
  env.flow.dataset.state = "expanded";
  env.reducedMotion.matches = true;
  api.animateSwitch(1); env.flushFrames();
  env.reducedMotion.matches = false;
  env.attributes.add("data-fluxion-no-motion");
  api.animateSwitch(1); env.flushFrames();
  assert.equal(env.animations.length, 0);
  env.attributes.clear();
  api.animateSwitch(1); env.flushFrames();
  env.attributes.add("data-fluxion-no-motion"); env.updateMotion();
  assert.equal(env.animations[0].cancelled, true, "disabling interface motion stops an in-flight transition");
  env.attributes.clear();
  api.animateSwitch(1); env.flushFrames();
  env.reducedMotion.matches = true; env.reducedMotion.emit("change");
  assert.equal(env.animations[1].cancelled, true);
  env.reducedMotion.matches = false;
  api.animateSwitch(1);
  env.window.emit("unload"); env.flushFrames();
  assert.equal(env.animations.length, 2, "unload cancels a pending animation frame");
});

test("vertical scrolling and page, synthetic, or non-system events cannot change workspaces", () => {
  const env = runtime();
  for (const changes of [
    { deltaX: 1, deltaY: 100 },
    { target: { ownerDocument: {} } },
    { target: { ownerDocument: env.document } },
    { isTrusted: false },
  ]) assert.equal(env.wheel(changes, 300).defaultPrevented, false);
  env.surface.nodePrincipal.isSystemPrincipal = false;
  assert.equal(env.wheel({}, 300).defaultPrevented, false);
  assert.deepEqual(env.switched, []);
});

test("modifiers, editing, uncancellable events and existing cancellation preserve native behavior and reject momentum tails", () => {
  for (const change of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }, { cancelable: false }, { defaultPrevented: true }]) {
    const env = runtime();
    assert.equal(env.wheel(change).stopped, false);
    env.wheel();
    assert.deepEqual(env.switched, []);
    env.wheel({}, 300);
    assert.deepEqual(env.switched, ["three"]);
  }
  const env = runtime();
  env.setEditing(true);
  assert.equal(env.wheel().defaultPrevented, false);
  env.setEditing(false);
  env.wheel();
  assert.deepEqual(env.switched, []);
});

test("compact and revealed overlay support gestures; a collapsed edge does not", () => {
  const env = runtime();
  env.flow.dataset.state = "focus";
  env.flow.dataset.revealed = "false";
  assert.equal(env.wheel().defaultPrevented, false);
  env.flow.dataset.revealed = "true";
  env.wheel({}, 300);
  assert.deepEqual(env.switched, ["three"]);
  env.flow.dataset.state = "compact";
  env.wheel({ deltaX: -60 }, 300);
  assert.deepEqual(env.switched, ["three", "two"]);
});

test("popup, drag and resize ownership reject workspace swipes until a fresh gesture", () => {
  const env = runtime();
  const first = { localName: "menupopup" }, second = { localName: "panel" };
  env.document.emit("popupshowing", { target: first });
  env.document.emit("popupshowing", { target: second });
  assert.equal(env.wheel().defaultPrevented, false);
  env.document.emit("popuphidden", { target: first });
  assert.equal(env.wheel({}, 300).defaultPrevented, false, "another popup still owns input");
  env.document.emit("popuphidden", { target: second });
  env.wheel();
  assert.deepEqual(env.switched, []);
  env.document.emit("dragstart");
  assert.equal(env.wheel({}, 300).defaultPrevented, false);
  env.document.emit("drop");
  env.wheel();
  assert.deepEqual(env.switched, []);
  env.attributes.add("data-fluxion-sidebar-resizing");
  assert.equal(env.wheel({}, 300).defaultPrevented, false);
  env.attributes.clear();
  env.wheel();
  assert.deepEqual(env.switched, []);
  env.wheel({}, 300);
  assert.deepEqual(env.switched, ["three"]);
});

test("leaving and reentering the sidebar does not convert the same wheel gesture into another switch", () => {
  const env = runtime();
  env.wheel();
  env.surface.emit("pointerleave");
  env.wheel({ deltaX: -60 });
  assert.deepEqual(env.switched, ["three"]);
  env.wheel({ deltaX: -60 }, 300);
  assert.deepEqual(env.switched, ["three", "two"]);
});

test("native tab focus transfer preserves a gesture; actual window deactivation rejects its remaining momentum", () => {
  const env = runtime();
  env.wheel({ deltaX: 10 });
  env.focus.activeWindow = null;
  env.window.emit("blur");
  env.focus.activeWindow = env.window;
  env.flushTimers();
  env.wheel({ deltaX: 46 });
  assert.deepEqual(env.switched, ["three"], "in-window focus transfer must not interrupt the gesture");
  env.wheel({ deltaX: -10 }, 300);
  env.focus.activeWindow = {};
  env.window.emit("blur");
  env.flushTimers();
  env.focus.activeWindow = env.window;
  env.wheel({ deltaX: -60 });
  assert.deepEqual(env.switched, ["three"], "reactivating a window must not revive stale momentum");
  env.wheel({ deltaX: -60 }, 300);
  assert.deepEqual(env.switched, ["three", "two"]);
});

test("controller reads live workspace ordering, does not wrap or fabricate workspaces, and disposes all listeners", () => {
  const env = runtime();
  env.setWorkspaces([{ id: "three" }, { id: "two" }, { id: "one" }]);
  env.wheel();
  assert.deepEqual(env.switched, ["one"]);
  env.wheel({}, 300);
  assert.deepEqual(env.switched, ["one"]);
  env.setWorkspaces([{ id: "one" }]);
  env.wheel({ deltaX: -60 }, 300);
  assert.deepEqual(env.switched, ["one"]);
  env.load();
  assert.equal(env.surface.listeners.get("wheel").length, 1, "loading twice does not duplicate navigation");
  env.window.emit("unload");
  assert.equal(env.window.FluxionWorkspaceGestures, undefined);
  for (const node of [env.surface, env.document, env.window]) for (const listeners of node.listeners.values()) assert.equal(listeners.length, 0);
});
