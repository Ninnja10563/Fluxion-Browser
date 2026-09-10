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
      navigator: { platform: "MacIntel" },
      CustomEvent: class { constructor(type) { this.type = type; } },
      addEventListener(type, callback) { listeners.set(type, callback); },
      dispatchEvent(event) { if (event.type === "FluxionShortcutsChanged") refreshes++; },
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../chrome/fluxion-shortcuts.js"), "utf8"), {
      window, Services: { prefs }, FluxionShortcutPolicy: globalThis.FluxionShortcutPolicy,
    });
    return { api: window.FluxionShortcuts, close: () => listeners.get("unload")(), refreshes: () => refreshes };
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
