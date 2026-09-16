"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
require("../chrome/core/shortcuts.js");

function fixture() {
  const values = new Map();
  const observers = new Set();
  const prefs = {
    getStringPref: (name, fallback) => values.get(name) ?? fallback,
    setStringPref(name, value) {
      values.set(name, value);
      for (const observer of observers) observer.observe(null, "nsPref:changed", name);
    },
    addObserver(_name, observer) { observers.add(observer); },
    removeObserver(_name, observer) { observers.delete(observer); },
    savePrefFile() {},
  };
  function openWindow() {
    const listeners = new Map();
    let refreshes = 0;
    const window = {
      document: { getElementById: () => null },
      navigator: { platform: "MacIntel" },
      CustomEvent: class { constructor(type) { this.type = type; } },
      addEventListener(type, callback) { listeners.set(type, callback); },
      dispatchEvent(event) { if (event.type === "FluxionShortcutsChanged") refreshes++; },
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../chrome/fluxion-shortcuts.js"), "utf8"), {
      window, Services: { prefs }, FluxionShortcutPolicy: globalThis.FluxionShortcutPolicy,
    });
    return { api: window.FluxionShortcuts, window, close: () => listeners.get("unload")(), refreshes: () => refreshes };
  }
  return { prefs, observers, openWindow };
}

test("shortcut changes and resets reach all open windows and refresh their UI", () => {
  const h = fixture();
  const first = h.openWindow(); const second = h.openWindow();
  const before = second.refreshes();
  assert.equal(first.api.set("palette", "Accel+Alt+Shift+KeyK").ok, true);
  assert.equal(second.api.get("palette"), "Accel+Alt+Shift+KeyK");
  assert.ok(second.refreshes() > before);
  assert.equal(second.api.matches({ code: "KeyK", metaKey: true, altKey: true, shiftKey: true }, "palette"), true);
  second.api.reset("palette");
  assert.equal(first.api.get("palette"), "Accel+KeyK");
  assert.equal(second.api.get("palette"), "Accel+KeyK");
});

test("external preference edits normalize invalid bindings and closed windows unsubscribe", () => {
  const h = fixture();
  const first = h.openWindow(); const second = h.openWindow();
  first.close();
  const before = first.refreshes();
  assert.equal(h.observers.size, 1);
  h.prefs.setStringPref("fluxion.shortcuts", JSON.stringify({ palette: "Accel+KeyD" }));
  assert.equal(second.api.get("palette"), "Accel+KeyK");
  h.prefs.setStringPref("fluxion.shortcuts", "malformed");
  assert.equal(second.api.get("palette"), "Accel+KeyK");
  assert.equal(first.refreshes(), before);
  second.close();
  assert.equal(h.observers.size, 0);
});

test("legal swaps and three-action cycles survive synchronous observers, new windows, and reset", () => {
  for (const cycle of [["palette", "tabSearch"], ["palette", "tabSearch", "sidebar"]]) {
    const h = fixture(), first = h.openWindow(), second = h.openWindow();
    const original = cycle.map(id => first.api.get(id));
    assert.equal(first.api.set(cycle[0], "Accel+Alt+Shift+KeyK").ok, true);
    for (let index = cycle.length - 1; index >= 1; index--) {
      assert.equal(first.api.set(cycle[index], original[(index + 1) % cycle.length]).ok, true);
    }
    assert.equal(first.api.set(cycle[0], original[1]).ok, true);
    const third = h.openWindow();
    for (const candidate of [first, second, third]) {
      assert.deepEqual(cycle.map(id => candidate.api.get(id)), original.map((_value, index) => original[(index + 1) % cycle.length]));
    }
    second.api.reset(cycle[0]);
    for (const candidate of [first, second, third]) {
      assert.equal(candidate.api.get(cycle[0]), original[0]);
      const all = candidate.api.actions().map(action => candidate.api.get(action.id));
      assert.equal(new Set(all).size, all.length, "reset must not leave duplicate bindings");
    }
  }
});

test("registered Settings capture receives existing global shortcuts before their browser actions", () => {
  const h = fixture(), { api, window } = h.openWindow();
  const targetListeners = new Map(), capturing = [], calls = [], notes = [];
  const key = { localName: "button", ownerDocument: window.document, isConnected: true, dataset: {}, textContent: "",
    contains: node => node === key, addEventListener: (type, fn) => targetListeners.set(type, fn),
    focus() { window.document.activeElement = key; } };
  window.document.getElementById = id => id === "fluxion-settings" ? { contains: node => node === key } : null;
  const context = vm.createContext({ window, key, action: { id: "sidebar", label: "Toggle Flow sidebar" },
    shortcutCaptureStops: [],
    document: { activeElement: key }, flow: {}, surface: { contains: () => false }, focusOpenMenus: new Set(),
    setNote: text => notes.push(text), refreshShortcutButtons() {},
    on(_target, _type, fn, capture) { assert.equal(capture, true); capturing.push(fn); },
    layer: { hidden: true }, open: mode => calls.push(mode), close: () => calls.push("close"),
    releasePointerCloseHold() {}, cycleSidebar: () => calls.push("sidebar"), cycleWorkspace: direction => calls.push(direction),
  });
  function execute(file, start, end) {
    const source = fs.readFileSync(path.join(__dirname, "../chrome", file), "utf8");
    const begin = source.indexOf(start), finish = source.indexOf(end, begin);
    assert.ok(begin >= 0 && finish > begin);
    vm.runInContext(source.slice(begin, finish + end.length), context);
  }
  execute("fluxion-settings.js", "    let beforeCapture = key.textContent;", '    key.addEventListener("blur", stopCapture);');
  execute("fluxion-palette.js", '  on(window, "keydown", event => {\n    if (window.FluxionShortcuts?.matches', '  }, true);');
  execute("fluxion-chrome.js", '  on(window, "keydown", event => {\n    if (document.activeElement === flow', '  }, true);');
  function dispatch(code, fields = {}, target = window.document.activeElement) {
    const event = { code, key: code === "Escape" ? "Escape" : code.replace("Key", ""), metaKey: true,
      // Native Cocoa Option events set both flags, unlike constructed DOM events.
      getModifierState(name) { return name === "AltGraph" && !!this.altKey; },
      target, composedPath: () => [target, window], prevented: false, stopped: false,
      preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...fields };
    for (const listener of capturing) listener(event);
    if (!event.stopped && target === key) targetListeners.get("keydown")(event);
    return event;
  }
  window.document.activeElement = { localName: "input" };
  targetListeners.get("click")();
  assert.equal(window.document.activeElement, key, "macOS click without implicit button focus must transfer capture focus");
  for (const [code, fields] of [["KeyK", {}], ["KeyA", { shiftKey: true }], ["BracketRight", { altKey: true }]]) {
    const event = dispatch(code, fields);
    assert.equal(event.prevented, true);
    assert.match(notes.at(-1), /Already used/);
    assert.deepEqual(calls, []);
  }
  dispatch("KeyK", { altKey: true, shiftKey: true });
  assert.equal(api.get("sidebar"), "Accel+Alt+Shift+KeyK");
  assert.equal(key.dataset.capturing, "false");
  dispatch("KeyK", { altKey: true, shiftKey: true });
  assert.deepEqual(calls, ["sidebar"], "edited chord must activate the actual registered command handler");
  calls.length = 0;
  targetListeners.get("click")();
  dispatch("KeyP", { metaKey: false, ctrlKey: true });
  assert.equal(api.get("sidebar"), "Ctrl+KeyP");
  assert.equal(api.format("sidebar"), "⌃ P");
  assert.equal(key.dataset.capturing, "false");
  assert.deepEqual(calls, [], "recording Control-P cannot activate the previous/global binding");
  assert.equal(h.openWindow().api.get("sidebar"), "Ctrl+KeyP", "new windows reload the physical Control token");
  dispatch("KeyP", { metaKey: false, ctrlKey: true });
  assert.deepEqual(calls, ["sidebar"], "physical Control-P activates the actual registered handler");
  dispatch("KeyP"); dispatch("KeyP", { ctrlKey: true });
  assert.deepEqual(calls, ["sidebar"], "Command-P and Command-Control-P must not alias Control-P");
  assert.equal(api.set("sidebar", "Accel+Alt+Shift+KeyK").ok, true);
  calls.length = 0;
  dispatch("Backslash", { shiftKey: true });
  assert.deepEqual(calls, [], "old chord must stop activating the edited action");
  const reopened = h.openWindow();
  assert.equal(reopened.api.matches({ code: "KeyK", metaKey: true, altKey: true, shiftKey: true,
    getModifierState: name => name === "AltGraph" }, "sidebar"), true);
  assert.equal(reopened.api.matches({ code: "Backslash", metaKey: true, shiftKey: true }, "sidebar"), false);
  dispatch("KeyK"); assert.deepEqual(calls, ["all"]);
  targetListeners.get("click")();
  dispatch("Escape", { metaKey: false });
  assert.equal(key.dataset.capturing, "false");
  const forged = { ...key, ownerDocument: {}, contains: () => true };
  targetListeners.get("click")();
  assert.equal(api.beginCapture(forged), false);
  const event = dispatch("KeyA", { shiftKey: true }, forged);
  assert.equal(event.prevented, true);
  assert.deepEqual(calls, ["all", "tabs"], "untrusted content cannot claim shortcut capture");
  targetListeners.get("blur")();
  assert.equal(key.dataset.capturing, "false");
  dispatch("BracketRight", { altKey: true });
  assert.deepEqual(calls, ["all", "tabs", 1], "blur must restore normal workspace shortcut dispatch");
  dispatch("BracketLeft", { altKey: true });
  assert.deepEqual(calls, ["all", "tabs", 1, -1], "both native Command+Option workspace shortcuts must dispatch");
  for (const fields of [{ metaKey: false }, { ctrlKey: true }, { isComposing: true }]) {
    dispatch("BracketRight", { altKey: true, ...fields });
  }
  assert.deepEqual(calls, ["all", "tabs", 1, -1], "Option text, composition and extra Control must not switch workspaces");
  targetListeners.get("click")();
  const persisted = h.prefs.getStringPref("fluxion.shortcuts");
  dispatch("KeyW");
  assert.match(notes.at(-1), /reserved/);
  assert.equal(h.prefs.getStringPref("fluxion.shortcuts"), persisted);
  assert.equal(key.dataset.capturing, "true");
  dispatch("Escape", { metaKey: false });
  reopened.api.reset("sidebar");
  calls.length = 0;
  dispatch("KeyK", { altKey: true, shiftKey: true });
  assert.deepEqual(calls, []);
  dispatch("Backslash", { shiftKey: true });
  assert.deepEqual(calls, ["sidebar"], "reset must reactivate the default command in an existing window");
});

test("pointer switching recording controls releases the previous label and capture, and blur never steals normal input", () => {
  const h = fixture(), { api, window } = h.openWindow();
  const controls = [], source = fs.readFileSync(path.join(__dirname, "../chrome/fluxion-settings.js"), "utf8");
  const shortcutCaptureStops = [];
  const start = source.indexOf("    let beforeCapture = key.textContent;"), end = source.indexOf('    key.addEventListener("blur", stopCapture);', start);
  window.document.getElementById = id => id === "fluxion-settings" ? { contains: node => controls.includes(node) } : null;
  const moveFocus = node => {
    const old = window.document.activeElement;
    window.document.activeElement = node;
    if (old !== node) old?.listeners?.get("blur")?.();
  };
  for (const id of ["palette", "sidebar"]) {
    const key = { localName: "button", ownerDocument: window.document, isConnected: true,
      dataset: {}, textContent: api.format(id), listeners: new Map(), contains: node => node === key,
      addEventListener(type, callback) { this.listeners.set(type, callback); }, focus() { moveFocus(key); } };
    controls.push(key);
    vm.runInNewContext(source.slice(start, end + '    key.addEventListener("blur", stopCapture);'.length), {
      window, key, action: { id, label: id }, shortcutCaptureStops, setNote() {}, refreshShortcutButtons() {},
    });
  }
  const [first, second] = controls;
  first.listeners.get("click")();
  assert.equal(first.dataset.capturing, "true");
  second.listeners.get("click")();
  assert.equal(first.dataset.capturing, "false");
  assert.equal(first.textContent, api.format("palette"));
  assert.equal(second.dataset.capturing, "true");
  assert.equal(window.document.activeElement, second);
  const event = { code: "KeyK", metaKey: true, target: second, composedPath: () => [second, window] };
  assert.equal(api.matches(event, "palette"), false);
  moveFocus({ localName: "input" });
  assert.equal(second.dataset.capturing, "false");
  assert.equal(second.textContent, api.format("sidebar"));
  assert.equal(api.matches({ ...event, target: window.document.activeElement, composedPath: () => [window.document.activeElement] }, "palette"), true);
  second.listeners.get("click")();
  const sections = new Map([["keyboard", { panel: {}, button: { setAttribute() {} } }], ["general", { panel: {}, button: { setAttribute() {} } }]]);
  const routeStart = source.indexOf("  function showSection("), routeEnd = source.indexOf("\n  function section(", routeStart);
  const routeContext = vm.createContext({ sections, activeSection: "keyboard", cancelShortcutCapture: () => shortcutCaptureStops.forEach(stop => stop()),
    gBrowser: { selectedBrowser: { currentURI: { spec: "about:preferences" } } }, tabSections: new Map(), renderPermissions() {}, renderWorkspaces() {}, refreshDefaultBrowser() {} });
  vm.runInContext(`${source.slice(routeStart, routeEnd)}\nshowSection("general");`, routeContext);
  assert.equal(second.dataset.capturing, "false", "section dismissal ends capture even without a blur event");
  assert.equal(second.textContent, api.format("sidebar"));
  second.listeners.get("click")();
  const visibilityStart = source.indexOf("  function syncVisibility() {"), visibilityEnd = source.indexOf("\n  const progressListener", visibilityStart);
  vm.runInNewContext(`${source.slice(visibilityStart, visibilityEnd)}\nsyncVisibility();`, {
    isSettingsTab: () => false, cancelShortcutCapture: () => shortcutCaptureStops.forEach(stop => stop()), root: {}, contentDeck: {},
    document: { documentElement: { hasAttribute: () => false, toggleAttribute() {} } },
  });
  assert.equal(second.dataset.capturing, "false", "tab dismissal ends capture even without a blur event");
  assert.equal(second.textContent, api.format("sidebar"));
});
