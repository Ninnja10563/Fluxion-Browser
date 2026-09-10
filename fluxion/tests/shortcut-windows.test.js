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
    contains: node => node === key, addEventListener: (type, fn) => targetListeners.set(type, fn) };
  window.document.getElementById = id => id === "fluxion-settings" ? { contains: node => node === key } : null;
  const context = vm.createContext({ window, key, action: { id: "sidebar", label: "Cycle Flow sidebar" },
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
  execute("fluxion-chrome.js", '  on(window, "keydown", event => {\n    releasePointerCloseHold', '  }, true);');
  function dispatch(code, fields = {}, target = key) {
    const event = { code, key: code === "Escape" ? "Escape" : code.replace("Key", ""), metaKey: true,
      target, composedPath: () => [target, window], prevented: false, stopped: false,
      preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...fields };
    for (const listener of capturing) listener(event);
    if (!event.stopped && target === key) targetListeners.get("keydown")(event);
    return event;
  }
  targetListeners.get("click")();
  for (const [code, fields] of [["KeyK", {}], ["KeyA", { shiftKey: true }], ["BracketRight", { altKey: true }]]) {
    const event = dispatch(code, fields);
    assert.equal(event.prevented, true);
    assert.match(notes.at(-1), /Already used/);
    assert.deepEqual(calls, []);
  }
  dispatch("KeyK", { altKey: true, shiftKey: true });
  assert.equal(api.get("sidebar"), "Accel+Alt+Shift+KeyK");
  assert.equal(key.dataset.capturing, "false");
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
});
