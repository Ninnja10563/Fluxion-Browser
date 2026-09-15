"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../chrome/fluxion-chrome.js"), "utf8");
function block(start, end) {
  const first = source.indexOf(start), last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first, `Missing shipped boundary: ${start}`);
  return source.slice(first, last);
}

function fixture() {
  const timers = new Map(), frames = [], writes = [], listeners = new Map();
  let timerId = 0, renders = 0;
  const document = { activeElement: null };
  function node(parent = null) {
    const attributes = new Map();
    return { parentNode: parent, dataset: {}, inert: false, attributes,
      setAttribute(name, value) { attributes.set(name, String(value)); },
      removeAttribute(name) { attributes.delete(name); },
      contains(other) { for (let current = other; current; current = current.parentNode) if (current === this) return true; return false; },
      focus() {
        const previous = document.activeElement;
        document.activeElement = this;
        if (previous && previous !== this && flow.contains(previous)) emit("focusout", { target: previous, relatedTarget: this });
        if (flow.contains(this)) emit("focusin", { target: this, relatedTarget: previous });
      },
    };
  }
  const flow = node(), surface = node(flow), modeButton = node(surface), workspaceList = node(surface);
  const selectedTab = {}, selectedRow = node(surface), page = node();
  const window = {
    setTimeout(fn) { const id = ++timerId; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
    requestAnimationFrame(fn) { frames.push(fn); },
  };
  flow.dataset = { state: "expanded", revealed: "false" };
  document.activeElement = page;
  const context = vm.createContext({ flow, surface, modeButton, workspaceList, document, window,
    SIDEBAR_STATES: ["expanded", "compact", "focus"], PREF_SIDEBAR: "fluxion.sidebar.state",
    Services: { prefs: { setStringPref: (key, value) => writes.push({ key, value }), savePrefFile() {} } },
    gBrowser: { selectedTab, selectedBrowser: page },
    tabElements: new Map([[selectedTab, selectedRow]]), renderedTabElements: () => [selectedRow],
    updateModeButtonTitle() {}, scheduleRender() { renders++; }, releasePointerCloseHold() {},
    on(target, type, listener) {
      const handlers = listeners.get(target) || new Map();
      const list = handlers.get(type) || [];
      list.push(listener); handlers.set(type, list); listeners.set(target, handlers);
    },
  });
  // Exercise the exact shipped transition and input handlers. Native geometry,
  // hit testing and routed pointer input are verified in the packaged Mac app.
  vm.runInContext(block("  let focusHideTimer =", "  function setTabDensity(") +
    block('  on(flow, "pointerdown"', '  on(newTabButton, "click"') +
    block('  on(window, "keydown"', '  on(window, "unload", () => {\n    clearFocusHideTimer();'), context);
  function emit(type, changes = {}) {
    const event = { type, target: flow, preventDefault() { this.prevented = true; },
      stopPropagation() { this.stopped = true; }, ...changes };
    for (const listener of listeners.get(window)?.get(type) || []) listener(event);
    for (const listener of listeners.get(flow)?.get(type) || []) listener(event);
    return event;
  }
  return { context, flow, surface, modeButton, workspaceList, selectedRow, page, document, writes, timers, frames, emit,
    get renders() { return renders; },
    flushTimers() { const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()); },
    flushFrames() { while (frames.length) frames.shift()(); },
  };
}

test("the primary sidebar toggle collapses to the hover edge and expands on its next activation", () => {
  const f = fixture();
  f.context.cycleSidebar();
  assert.equal(f.flow.dataset.state, "focus");
  assert.equal(f.surface.inert, true);
  f.context.cycleSidebar();
  assert.equal(f.flow.dataset.state, "expanded");
  assert.equal(f.surface.inert, false);
  assert.deepEqual(f.writes.map(write => write.value), ["focus", "expanded"]);
});

test("expanding an explicitly selected compact sidebar never hides it", () => {
  const f = fixture(); f.context.setSidebarState("compact");
  f.context.cycleSidebar();
  assert.equal(f.flow.dataset.state, "expanded");
  assert.equal(f.surface.inert, false);
  assert.equal(f.flow.tabIndex, -1);
  assert.equal(f.flow.attributes.has("aria-expanded"), false);
});

test("collapsing a focused sidebar control does not leave keyboard focus inside an inert subtree", () => {
  const f = fixture(); f.modeButton.focus(); f.context.setSidebarState("focus");
  assert.equal(f.surface.inert, true);
  assert.equal(f.surface.contains(f.document.activeElement), false);
  assert.equal(f.flow.dataset.revealed, "false");
});

test("edge entry and exit repeatedly reveal and hide without rewriting the saved mode", () => {
  const f = fixture(); f.context.setSidebarState("focus");
  for (let cycle = 0; cycle < 4; cycle++) {
    f.emit("pointerenter");
    assert.equal(f.flow.dataset.revealed, "true");
    assert.equal(f.surface.inert, false);
    assert.equal(f.flow.attributes.get("aria-expanded"), "true");
    f.emit("pointerleave");
    assert.equal(f.flow.dataset.revealed, "true", "leave has a short intentional grace interval");
    f.flushTimers();
    assert.equal(f.flow.dataset.revealed, "false");
    assert.equal(f.surface.inert, true);
    assert.equal(f.flow.attributes.get("aria-expanded"), "false");
  }
  assert.equal(f.writes.length, 1, "hover never persists a new sidebar mode");
});

test("reentering the edge cancels a queued hide rather than flickering the revealed surface", () => {
  const f = fixture(); f.context.setSidebarState("focus");
  f.emit("pointerenter"); f.emit("pointerleave");
  assert.equal(f.timers.size, 1);
  f.emit("pointerenter"); assert.equal(f.timers.size, 0);
  f.flushTimers(); assert.equal(f.flow.dataset.revealed, "true");
});

test("keyboard entry reveals the active row and Escape safely returns focus to the edge", () => {
  const f = fixture(); f.context.setSidebarState("focus");
  const enter = f.emit("keydown", { key: "Enter" }); f.flushFrames();
  assert.equal(enter.prevented, true); assert.equal(enter.stopped, true);
  assert.equal(f.document.activeElement, f.selectedRow);
  assert.equal(f.surface.inert, false);
  const escape = f.emit("keydown", { key: "Escape", target: f.selectedRow });
  assert.equal(escape.prevented, true); assert.equal(escape.stopped, true);
  assert.equal(f.document.activeElement, f.flow);
  assert.equal(f.flow.dataset.revealed, "false"); assert.equal(f.surface.inert, true);
});

test("an obsolete keyboard reveal frame never refocuses an already hidden sidebar", () => {
  const f = fixture(); f.context.setSidebarState("focus");
  f.context.revealFocusSurface({ focusActive: true });
  f.context.hideFocusSurface({ force: true }); f.flushFrames();
  assert.equal(f.surface.contains(f.document.activeElement), false);
  assert.equal(f.flow.dataset.revealed, "false"); assert.equal(f.surface.inert, true);
});

test("leaving the pointer never hides a sidebar while keyboard focus remains inside", () => {
  const f = fixture(); f.context.setSidebarState("focus");
  f.emit("keydown", { key: "Enter" }); f.flushFrames();
  f.emit("pointerleave"); f.flushTimers();
  assert.equal(f.document.activeElement, f.selectedRow);
  assert.equal(f.flow.dataset.revealed, "true");
  f.page.focus(); f.flushTimers();
  assert.equal(f.flow.dataset.revealed, "false");
});

test("switching modes cancels a pending auto-hide and restores accessible controls", () => {
  const f = fixture(); f.context.setSidebarState("focus");
  f.emit("pointerenter"); f.emit("pointerleave");
  f.context.setSidebarState("expanded"); f.flushTimers();
  assert.equal(f.flow.dataset.state, "expanded"); assert.equal(f.surface.inert, false);
  assert.equal(f.context.hideFocusSurface(), false);
  assert.equal(f.context.revealFocusSurface(), false);
  assert.equal(f.workspaceList.attributes.get("aria-orientation"), "horizontal");
});

test("a pointer-selected row never traps the hover sidebar open after the pointer leaves", () => {
  const f = fixture(); f.context.setSidebarState("focus");
  f.emit("pointerenter"); f.emit("pointerdown", { target: f.selectedRow }); f.selectedRow.focus();
  f.emit("pointerleave"); f.flushTimers();
  assert.equal(f.flow.dataset.revealed, "false"); assert.equal(f.surface.inert, true);
  assert.equal(f.document.activeElement, f.page, "pointer-owned row focus returns to the actual selected browser");
});

test("actual captured keyboard input takes ownership of focus previously set by a pointer", () => {
  const f = fixture(); f.context.setSidebarState("focus");
  f.emit("pointerenter"); f.emit("pointerdown", { target: f.selectedRow }); f.selectedRow.focus();
  f.emit("keydown", { key: "ArrowDown", target: f.selectedRow });
  f.emit("pointerleave"); f.flushTimers();
  assert.equal(f.document.activeElement, f.selectedRow);
  assert.equal(f.flow.dataset.revealed, "true"); assert.equal(f.surface.inert, false);
});

test("a subsequent pointer interaction releases earlier keyboard ownership", () => {
  const f = fixture(); f.context.setSidebarState("focus");
  f.emit("keydown", { key: "Enter" }); f.flushFrames();
  f.emit("pointerenter"); f.emit("pointerdown", { target: f.selectedRow });
  f.emit("pointerleave"); f.flushTimers();
  assert.equal(f.document.activeElement, f.page);
  assert.equal(f.flow.dataset.revealed, "false");
});

test("an open native Flow menu retains its anchor until the menu has closed", () => {
  const f = fixture(); f.context.setSidebarState("focus");
  f.emit("pointerenter");
  // A native menu's popupshowing/popuphidden registration owns this set; the
  // test supplies that external state while executing the shipped hide path.
  vm.runInContext('focusOpenMenus.add("native-menu")', f.context);
  f.emit("pointerleave"); f.flushTimers();
  assert.equal(f.flow.dataset.revealed, "true"); assert.equal(f.surface.inert, false);
  vm.runInContext('focusOpenMenus.delete("native-menu"); scheduleFocusSurfaceHide()', f.context);
  f.flushTimers();
  assert.equal(f.flow.dataset.revealed, "false"); assert.equal(f.surface.inert, true);
});
