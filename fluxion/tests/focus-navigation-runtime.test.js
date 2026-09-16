"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../chrome/fluxion-focus-mode.js"), "utf8");
function fixture() {
  const timers = new Map(), observers = [], listeners = new Map(), topics = new Map();
  let sequence = 0, geometryReads = 0;
  const document = { activeElement: null };
  function node(id = "", parent = null, localName = "div") {
    const attrs = new Map();
    const n = { id, parent, localName, ownerDocument: document, nodePrincipal: { isSystemPrincipal: true },
      dataset: {}, children: [], attrs, addEventListener(type, fn) {
        const map = listeners.get(this) || new Map();
        map.set(type, [...(map.get(type) || []), fn]); listeners.set(this, map);
      }, removeEventListener(type, fn) { const map = listeners.get(this); map?.set(type, (map.get(type) || []).filter(f => f !== fn)); },
      append(...nodes) { for (const child of nodes) { child.parent = this; this.children.push(child); } },
      remove() { this.removed = true; },
      contains(target) { for (let current = target; current; current = current.parent) if (current === this) return true; return false; },
      hasAttribute: name => attrs.has(name), getAttribute: name => attrs.get(name) ?? null,
      setAttribute: (name, value) => attrs.set(name, String(value)), removeAttribute: name => attrs.delete(name),
      toggleAttribute(name, value) { if (value) attrs.set(name, ""); else attrs.delete(name); },
      getBoundingClientRect() { geometryReads++; return { top: 0, height: 44 }; },
    };
    return n;
  }
  const root = node("root"), toolbox = node("navigator-toolbox", root), flow = node("fluxion-flow", root);
  const page = node("page"), input = node("urlbar-input", toolbox);
  flow.dataset.state = "expanded"; document.activeElement = page;
  document.documentElement = root;
  document.getElementById = id => ({ "navigator-toolbox": toolbox, "fluxion-flow": flow })[id];
  document.createElementNS = (_, name) => node("", null, name);
  document.addEventListener = toolbox.addEventListener; document.removeEventListener = toolbox.removeEventListener;
  const window = { document, gURLBar: { inputField: input, value: "", view: { isOpen: false, close() { this.isOpen = false; } } },
    gBrowser: { selectedBrowser: { focus() { document.activeElement = page; } } }, FluxionChromeLayout: { refresh() {} },
    setTimeout(fn) { const id = ++sequence; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); },
    addEventListener: toolbox.addEventListener, removeEventListener: toolbox.removeEventListener,
    MutationObserver: class { constructor(fn) { this.fn = fn; observers.push(this); } observe() {} disconnect() { this.disconnected = true; } },
  };
  const Services = { obs: {
    addObserver(observer, topic) { topics.set(topic, observer); },
    removeObserver(observer, topic) { if (topics.get(topic) === observer) topics.delete(topic); },
    notifyObservers(subject, topic, state) { topics.get(topic)?.observe(subject, topic, state); },
  } };
  vm.runInNewContext(source, { window, Services });
  const edge = root.children.find(n => n.id === "fluxion-navigation-edge");
  const emit = (owner, type, target = owner, extra = {}) => {
    const event = { target, type, isTrusted: true, ...extra };
    for (const fn of [...(listeners.get(owner)?.get(type) || [])]) fn(event);
    return event;
  };
  return { window, document, root, toolbox, flow, input, page, edge, timers, observers, topics, Services, node, emit,
    get reads() { return geometryReads; },
    enterFocus() { flow.dataset.state = "focus"; window.FluxionFocusMode.refresh(); },
    flush() { const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()); },
  };
}
test("top-edge reveal hides after leaving, without rewriting sidebar mode or moving native controls", () => {
  const f = fixture(); f.enterFocus();
  assert.equal(f.window.FluxionFocusMode.state().revealed, false);
  f.emit(f.edge, "pointerenter"); assert.equal(f.window.FluxionFocusMode.state().revealed, true);
  f.emit(f.edge, "pointerleave"); f.emit(f.toolbox, "pointerenter"); f.flush();
  assert.equal(f.window.FluxionFocusMode.state().revealed, true, "crossing edge-to-toolbar gap must retain reveal");
  f.emit(f.toolbox, "pointerleave"); f.flush();
  assert.equal(f.window.FluxionFocusMode.state().revealed, false);
  assert.equal(f.flow.dataset.state, "focus"); assert.equal(f.input.parent, f.toolbox);
});
test("native fullscreen keeps expanded and compact navigation visible without preference writes or notification loops", () => {
  const f = fixture(), shown = [];
  f.window.fullScreen = true; f.root.setAttribute("inFullscreen", "true");
  const native = f.window.FullScreen = {
    navToolboxHidden: false,
    showNavToolbox(trackMouse) {
      shown.push(trackMouse); this.navToolboxHidden = false;
      f.Services.obs.notifyObservers(f.toolbox, "fullscreen-nav-toolbox", "shown");
    },
    hideNavToolbox() {
      this.navToolboxHidden = true;
      f.Services.obs.notifyObservers(f.toolbox, "fullscreen-nav-toolbox", "hidden");
    },
  };
  for (const state of ["expanded", "compact"]) {
    f.flow.dataset.state = state; f.window.FluxionFocusMode.refresh();
    native.hideNavToolbox();
    assert.equal(native.navToolboxHidden, false, `${state} restores native visibility synchronously`);
  }
  assert.deepEqual(shown, [false, false], "one native show per collapse, no feedback loop or mouse tracker");
  native.navToolboxHidden = true;
  const count = shown.length;
  f.Services.obs.notifyObservers(f.node("other-window-toolbox"), "fullscreen-nav-toolbox", "hidden");
  assert.equal(shown.length, count, "other windows cannot change this controller");
  assert.equal(native.navToolboxHidden, true);
  f.Services.obs.notifyObservers(f.toolbox, "fullscreen-nav-toolbox", "hidden");
  assert.equal(native.navToolboxHidden, false);
  f.enterFocus(); assert.equal(native.navToolboxHidden, true, "Focus retains native collapse");
  f.flow.dataset.state = "compact"; f.window.FluxionFocusMode.refresh();
  assert.equal(native.navToolboxHidden, false, "expanding while hidden restores navigation");
  f.document.fullscreenElement = {}; native.hideNavToolbox();
  assert.equal(native.navToolboxHidden, true, "DOM fullscreen remains wholly native");
  f.document.fullscreenElement = null; f.root.setAttribute("inDOMFullscreen", "true");
  f.window.FluxionFocusMode.refresh(); assert.equal(native.navToolboxHidden, true);
  f.root.removeAttribute("inDOMFullscreen"); f.window.fullScreen = false;
  f.window.FluxionFocusMode.refresh(); assert.equal(native.navToolboxHidden, true, "normal windows do not call fullscreen APIs");
  f.emit(f.window, "unload"); assert.equal(f.topics.size, 0);
});
test("native address focus reveals immediately, suggestions and focus retain it until page focus", () => {
  const f = fixture(); f.enterFocus(); f.document.activeElement = f.input;
  f.emit(f.toolbox, "focusin", f.input);
  assert.equal(f.window.FluxionFocusMode.state().revealed, true); assert.equal(f.reads, 1);
  f.emit(f.toolbox, "pointerleave"); f.flush(); assert.equal(f.window.FluxionFocusMode.state().revealed, true);
  f.document.activeElement = f.page; f.window.gURLBar.view.isOpen = true;
  f.emit(f.toolbox, "focusout", f.input); f.flush(); assert.equal(f.window.FluxionFocusMode.state().revealed, true);
  f.window.gURLBar.view.isOpen = false; f.emit(f.toolbox, "focusout", f.input); f.flush();
  assert.equal(f.window.FluxionFocusMode.state().revealed, false);
});
test("entering Focus releases inherited New Tab address focus once without losing typed value or later Cmd-L focus", () => {
  const f = fixture(); f.document.activeElement = f.input;
  f.window.gURLBar.view.isOpen = true; f.window.gURLBar.value = "unfinished.example";
  f.enterFocus();
  assert.equal(f.document.activeElement, f.page);
  assert.equal(f.window.gURLBar.view.isOpen, false);
  assert.equal(f.window.gURLBar.value, "unfinished.example");
  assert.equal(f.window.FluxionFocusMode.state().revealed, false);
  f.document.activeElement = f.input; f.emit(f.toolbox, "focusin", f.input);
  f.window.FluxionFocusMode.refresh();
  assert.equal(f.document.activeElement, f.input, "Repeated refresh must not steal an explicit native focus request");
  assert.equal(f.window.FluxionFocusMode.state().revealed, true);
});
test("entering Focus cannot steal keyboard focus from a live native security popup", () => {
  for (const fullscreen of [false, true]) {
    const f = fixture(); f.document.activeElement = f.input;
    let nativeHideCalls = 0;
    f.window.fullScreen = fullscreen;
    f.window.FullScreen = { hideNavToolbox() { nativeHideCalls++; } };
    if (fullscreen) f.root.setAttribute("inFullscreen", "true");
    f.emit(f.document, "popupshowing", f.node("identity-popup", null, "panel"));
    f.enterFocus();
    assert.equal(f.document.activeElement, f.input);
    assert.equal(f.window.FluxionFocusMode.state().revealed, !fullscreen);
    assert.equal(nativeHideCalls, 0, "An open security interaction must not be collapsed by sidebar changes");
  }
});
test("ordinary browser fullscreen delegates collapse to Gecko after releasing implicit input, but DOM fullscreen is untouched", () => {
  for (const domFullscreen of [false, true]) {
    const f = fixture(), calls = [];
    f.window.fullScreen = true;
    f.window.FullScreen = { hideNavToolbox(animate) { calls.push({ animate, focus: f.document.activeElement }); } };
    f.root.setAttribute("inFullscreen", "true");
    if (domFullscreen) f.root.setAttribute("inDOMFullscreen", "true");
    f.document.activeElement = f.input;
    f.enterFocus();
    assert.equal(f.window.FluxionFocusMode.state().enabled, false);
    assert.equal(calls.length, domFullscreen ? 0 : 1);
    assert.equal(f.document.activeElement, domFullscreen ? f.input : f.page);
    if (!domFullscreen) {
      assert.equal(calls[0].animate, false);
      assert.equal(calls[0].focus, f.page);
      f.document.activeElement = f.input; f.window.FluxionFocusMode.refresh();
      assert.equal(f.document.activeElement, f.input, "Later native fullscreen Cmd-L is not stolen");
      assert.equal(calls.length, 1);
    }
  }
});
test("native security panels retain an unanimated toolbar; content and workspace popups cannot trigger it", () => {
  const f = fixture(); f.enterFocus();
  const panel = f.node("identity-popup", null, "panel");
  f.emit(f.document, "popupshowing", panel); f.flush();
  assert.equal(f.window.FluxionFocusMode.state().revealed, true);
  assert.equal(f.root.hasAttribute("data-fluxion-navigation-pinned"), true);
  f.emit(f.toolbox, "pointerleave"); f.flush(); assert.equal(f.window.FluxionFocusMode.state().revealed, true);
  f.emit(f.document, "popuphidden", panel); f.flush(); assert.equal(f.window.FluxionFocusMode.state().revealed, false);
  const content = f.node("spoof", null, "panel"); content.nodePrincipal.isSystemPrincipal = false;
  f.emit(f.document, "popupshowing", content);
  f.emit(f.document, "popupshowing", f.node("fluxion-workspace-theme", null, "panel"));
  f.emit(f.edge, "pointerenter", f.edge, { isTrusted: false });
  assert.equal(f.window.FluxionFocusMode.state().revealed, false);
});
test("native fullscreen, customization, expanded state and unload release overlay ownership", () => {
  const f = fixture(); f.enterFocus();
  for (const attr of ["inFullscreen", "inDOMFullscreen", "customizing"]) {
    f.root.setAttribute(attr, "true"); f.window.FluxionFocusMode.refresh();
    assert.equal(f.window.FluxionFocusMode.state().enabled, false);
    f.root.removeAttribute(attr); f.window.FluxionFocusMode.refresh();
    assert.equal(f.window.FluxionFocusMode.state().enabled, true);
  }
  f.flow.dataset.state = "expanded"; f.window.FluxionFocusMode.refresh();
  assert.equal(f.root.hasAttribute("data-fluxion-focus-mode"), false);
  f.enterFocus(); f.emit(f.edge, "pointerenter"); f.emit(f.edge, "pointerleave");
  f.emit(f.window, "unload"); assert.equal(f.timers.size, 0);
  assert.equal(f.observers[0].disconnected, true); assert.equal(f.edge.removed, true);
  assert.equal(f.root.hasAttribute("data-fluxion-focus-mode"), false);
});
test("canceled native popup opening cannot leave Focus navigation pinned open", async () => {
  const f = fixture(); f.enterFocus();
  const panel = f.node("identity-popup", null, "panel");
  const event = f.emit(f.document, "popupshowing", panel);
  assert.equal(f.window.FluxionFocusMode.state().revealed, true);
  event.defaultPrevented = true;
  await Promise.resolve(); f.flush();
  assert.equal(f.window.FluxionFocusMode.state().revealed, false);
  assert.equal(f.root.hasAttribute("data-fluxion-navigation-pinned"), false);
  f.emit(f.document, "popupshowing", panel, { defaultPrevented: true });
  assert.equal(f.window.FluxionFocusMode.state().revealed, false);
});
