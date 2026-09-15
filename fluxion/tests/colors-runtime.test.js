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
  let saves = 0, computations = 0;
  const countedCore = { ...core, variables(value) { computations++; return core.variables(value); } };
  const prefs = {
    getStringPref: (name, fallback) => stored.get(name) ?? fallback,
    setStringPref(name, value) { stored.set(name, value); for (const observer of observers.get(name) || []) observer.observe(); },
    addObserver(name, observer) { if (!observers.has(name)) observers.set(name, new Set()); observers.get(name).add(observer); },
    removeObserver: (name, observer) => observers.get(name).delete(observer),
    savePrefFile() { saves++; },
  };
  function open({ workspaces = [], current = "focus" } = {}) {
    const variables = new Map([["--unrelated", "preserved"]]), events = new Map();
    let writes = 0;
    const window = {
      gBrowser: {},
      document: { documentElement: { style: {
        setProperty: (name, value) => { writes++; variables.set(name, value); },
        removeProperty: name => { writes++; variables.delete(name); },
      } } },
      CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
      addEventListener(type, fn) { if (!events.has(type)) events.set(type, new Set()); events.get(type).add(fn); },
      removeEventListener(type, fn) { events.get(type)?.delete(fn); },
      dispatchEvent(event) { for (const callback of events.get(event.type) || []) callback(event); },
      FluxionUI: { workspaces: () => workspaces, currentWorkspace: () => current },
    };
    vm.runInNewContext(source, { window, Services: { prefs }, FluxionColorsCore: countedCore });
    return { window, variables, api: window.FluxionColors, writes: () => writes,
      switchWorkspace(id) { current = id; window.FluxionColors.project(); },
      close: () => window.dispatchEvent({ type: "unload" }) };
  }
  return { prefs, stored, observers, open, saves: () => saves, computations: () => computations };
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

test("active workspace bases project per window with readable global accents and legacy fallback", () => {
  const environment = runtime();
  const workspaces = [{ id: "focus", theme: { light: "#ABCDEF", dark: "#102030" } }, { id: "other" }];
  const first = environment.open({ workspaces }), second = environment.open({ workspaces, current: "other" });
  assert.equal(first.variables.get("--fluxion-bg"), "light-dark(#abcdef, #102030)");
  assert.equal(second.variables.has("--fluxion-bg"), false);
  assert.deepEqual(first.api.current(), core.DEFAULTS, "workspace projection must not masquerade as global Settings");
  first.api.setPalette("light", { base: "#ffffff", accent: "#225588" });
  first.api.setEnabled(true);
  const expected = core.variables({ enabled: true, light: { base: "#abcdef", accent: "#225588" }, dark: { base: "#102030", accent: core.DEFAULTS.dark.accent } });
  assert.equal(first.variables.get("--fluxion-accent"), expected["--fluxion-accent"]);
  assert.equal(second.variables.get("--fluxion-bg"), "light-dark(#ffffff, #1c1e20)");
  first.switchWorkspace("other");
  assert.deepEqual(first.variables, second.variables);
  first.switchWorkspace("focus");
  delete workspaces[0].theme;
  first.window.dispatchEvent({ type: "FluxionWorkspacesChanged" });
  assert.deepEqual(first.variables, second.variables, "resetting a workspace returns to enabled global colors");
  first.api.setEnabled(false);
  assert.deepEqual([...first.variables], [["--unrelated", "preserved"]]);
});

test("unchanged effective palettes skip derivation and DOM writes; corrupt theme pairs cannot inject styles", () => {
  const environment = runtime();
  const workspaces = [{ id: "focus", theme: { light: "#ddeeff", dark: "#112233" } },
    { id: "same", theme: { light: "#ddeeff", dark: "#112233" } },
    { id: "broken", theme: { light: "#ffffff", dark: "url(file:///private)" } }];
  const first = environment.open({ workspaces });
  const writes = first.writes(), computations = environment.computations();
  first.api.project();
  first.window.dispatchEvent({ type: "FluxionWorkspacesChanged" });
  first.switchWorkspace("same");
  assert.equal(first.writes(), writes);
  assert.equal(environment.computations(), computations);
  first.switchWorkspace("broken");
  assert.deepEqual([...first.variables], [["--unrelated", "preserved"]]);
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
