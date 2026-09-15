"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const core = require("../chrome/core/colors.js");
const source = fs.readFileSync(require.resolve("../chrome/fluxion-colors.js"), "utf8");
const PREF = "fluxion.appearance.colors.v1";

function runtime() {
  const stored = new Map(), observers = new Map();
  let saves = 0;
  const prefs = {
    getStringPref: (name, fallback) => stored.get(name) ?? fallback,
    setStringPref(name, value) { stored.set(name, value); for (const observer of observers.get(name) || []) observer.observe(); },
    addObserver(name, observer) { if (!observers.has(name)) observers.set(name, new Set()); observers.get(name).add(observer); },
    removeObserver: (name, observer) => observers.get(name).delete(observer),
    savePrefFile() { saves++; },
  };
  function open() {
    const variables = new Map([["--unrelated", "preserved"]]), events = new Map();
    const window = {
      gBrowser: {},
      document: { documentElement: { style: {
        setProperty: (name, value) => variables.set(name, value),
        removeProperty: name => variables.delete(name),
      } } },
      CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
      addEventListener(type, fn) { if (!events.has(type)) events.set(type, new Set()); events.get(type).add(fn); },
      dispatchEvent(event) { for (const callback of events.get(event.type) || []) callback(event); },
    };
    vm.runInNewContext(source, { window, Services: { prefs }, FluxionColorsCore: core });
    return { window, variables, api: window.FluxionColors, close: () => window.dispatchEvent({ type: "unload" }) };
  }
  return { prefs, stored, observers, open, saves: () => saves };
}

test("actual chrome color controller persists atomic palettes and synchronizes existing and new windows", () => {
  const environment = runtime(), first = environment.open(), second = environment.open();
  const changes = [];
  second.window.addEventListener("FluxionColorsChanged", event => changes.push(event.detail));
  first.api.setPalette("light", { base: "#AACCEE", accent: "#112233" });
  assert.equal(first.variables.has("--fluxion-bg"), false);
  first.api.setEnabled(true);
  assert.equal(first.variables.get("--fluxion-bg"), "light-dark(#aaccee, #1c1e20)");
  assert.deepEqual(first.variables, second.variables);
  assert.equal(changes.at(-1).light.base, "#aaccee");
  const reopened = environment.open();
  assert.deepEqual(reopened.variables, first.variables);
  assert.equal(environment.saves(), 2);
  assert.equal(environment.stored.size, 1, "one preference snapshot prevents partial cross-window palettes");
  second.close();
  assert.equal(environment.observers.get(PREF).size, 2);
  first.api.setPalette("dark", { base: "#010203", accent: "#ffff00" });
  assert.notDeepEqual(first.variables, second.variables, "closed windows no longer receive changes");
  assert.deepEqual(first.variables, reopened.variables);
});

test("invalid updates do not persist, and reset removes only owned chrome properties in all windows", () => {
  const environment = runtime(), first = environment.open(), second = environment.open();
  first.api.setEnabled(true);
  const before = environment.stored.get(PREF);
  for (const action of [
    () => first.api.setPalette("other", { base: "#ffffff", accent: "#000000" }),
    () => first.api.setPalette("dark", { base: "#fff", accent: "#000000" }),
    () => first.api.setPalette("light", { base: "#ffffff", accent: "url(file:///private)" }),
    () => first.api.setEnabled("false"),
  ]) assert.throws(action);
  assert.equal(environment.stored.get(PREF), before);
  first.api.reset();
  assert.deepEqual(first.api.current(), core.DEFAULTS);
  assert.deepEqual([...first.variables], [["--unrelated", "preserved"]]);
  assert.deepEqual(first.variables, second.variables);
  environment.prefs.setStringPref(PREF, "corrupt profile preference");
  assert.deepEqual(first.api.current(), core.DEFAULTS);
  assert.deepEqual(first.variables, second.variables);
});
