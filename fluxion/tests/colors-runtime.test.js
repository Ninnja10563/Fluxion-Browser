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
  const countedCore = { ...core, variables(value, mode) { computations++; return core.variables(value, mode); } };
  const prefs = {
    getStringPref: (name, fallback) => stored.get(name) ?? fallback,
    setStringPref(name, value) { stored.set(name, value); for (const observer of observers.get(name) || []) observer.observe(); },
    addObserver(name, observer) { if (!observers.has(name)) observers.set(name, new Set()); observers.get(name).add(observer); },
    removeObserver: (name, observer) => observers.get(name).delete(observer),
    savePrefFile() { saves++; },
  };
  function open({ workspaces = [], current = "focus", appearance = "system", dark = false } = {}) {
    const variables = new Map([["--unrelated", "preserved"]]), events = new Map(), attributes = new Map(), mediaEvents = new Set();
    if (appearance !== "system") variables.set("color-scheme", appearance);
    const media = { matches: dark, addEventListener: (_type, fn) => mediaEvents.add(fn), removeEventListener: (_type, fn) => mediaEvents.delete(fn) };
    let writes = 0;
    const window = {
      gBrowser: {},
      document: { documentElement: {
        getAttribute: name => attributes.get(name) ?? null,
        setAttribute: (name, value) => { writes++; attributes.set(name, value); },
        removeAttribute: name => { writes++; attributes.delete(name); },
        style: {
        setProperty: (name, value) => { writes++; variables.set(name, value); },
        removeProperty: name => { writes++; variables.delete(name); },
        getPropertyValue: name => variables.get(name) || "",
      } } },
      CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
      addEventListener(type, fn) { if (!events.has(type)) events.set(type, new Set()); events.get(type).add(fn); },
      removeEventListener(type, fn) { events.get(type)?.delete(fn); },
      dispatchEvent(event) { for (const callback of events.get(event.type) || []) callback(event); },
      FluxionUI: { workspaces: () => workspaces, currentWorkspace: () => current },
      FluxionTheme: { current: () => appearance },
      matchMedia: () => media,
    };
    vm.runInNewContext(source, { window, Services: { prefs }, FluxionColorsCore: countedCore,
      FluxionWorkspaces: require("../chrome/core/workspaces.js") });
    return { window, variables, attributes, api: window.FluxionColors, writes: () => writes,
      systemDark(value) { media.matches = value; for (const handler of mediaEvents) handler(); },
      switchWorkspace(id) { current = id; window.FluxionColors.project(); },
      changeGlobalAppearance(choice) {
        appearance = choice;
        if (choice === "system") variables.delete("color-scheme"); else variables.set("color-scheme", choice);
        window.dispatchEvent({ type: "FluxionThemeChanged" });
      },
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

test("workspace mode is an actual chrome scheme independent from global theme and editing-palette preview", () => {
  const environment = runtime();
  const theme = { light: "#eeeeee", dark: "#112233", lightAccent: "#224466", darkAccent: "#aaccee", mode: "dark" };
  const workspaces = [{ id: "focus", theme }, { id: "plain" }];
  const first = environment.open({ workspaces, appearance: "light" });
  assert.equal(first.attributes.get("data-fluxion-workspace-appearance"), "dark");
  assert.equal(first.variables.get("color-scheme"), "light", "workspace schemes leave Gecko's root/content appearance untouched");
  const expected = core.variables({ enabled: true, light: { base: theme.light, accent: theme.lightAccent }, dark: { base: theme.dark, accent: theme.darkAccent } }, "dark");
  assert.equal(first.variables.get("--fluxion-accent"), expected["--fluxion-accent"]);
  const writes = first.writes(); first.api.project();
  assert.equal(first.writes(), writes, "same workspace scheme and colors do not rewrite chrome styles");
  first.changeGlobalAppearance("light");
  assert.equal(first.attributes.get("data-fluxion-workspace-appearance"), "dark", "global theme notifications cannot erase a workspace override");
  const preview = first.api.beginWorkspacePreview("focus");
  preview.update({ ...theme, light: "#aabbcc" }, "light");
  assert.equal(first.attributes.get("data-fluxion-workspace-appearance"), "light", "editing a light palette really previews light pixels");
  assert.equal(first.variables.get("--fluxion-bg"), "#aabbcc");
  assert.equal(environment.saves(), 0);
  assert.equal(theme.light, "#eeeeee", "preview never mutates workspace data");
  preview.clear();
  assert.equal(first.attributes.get("data-fluxion-workspace-appearance"), "dark");
  first.switchWorkspace("plain");
  assert.equal(first.attributes.has("data-fluxion-workspace-appearance"), false);
  assert.equal(first.variables.get("color-scheme"), "light", "leaving workspace mode retains the current global choice");
  first.switchWorkspace("focus"); theme.mode = "system"; first.api.project();
  assert.equal(first.attributes.get("data-fluxion-workspace-appearance"), "light", "system resolves actual OS choice, not browser override");
  first.systemDark(true);
  assert.equal(first.attributes.get("data-fluxion-workspace-appearance"), "dark");
  assert.equal(first.variables.get("--fluxion-bg"), theme.dark);
  assert.equal(first.variables.get("color-scheme"), "light", "even OS preview changes never mutate webpage scheme");
});

test("preview ownership is window-local, cancels on switching, and cannot revive after disposal or replacement", () => {
  const environment = runtime(), workspaces = [{ id: "focus" }, { id: "other" }];
  const first = environment.open({ workspaces }), second = environment.open({ workspaces });
  const theme = { light: "#eeddcc", dark: "#223344" };
  const preview = first.api.beginWorkspacePreview("focus");
  preview.update(theme, "dark");
  assert.equal(first.variables.get("--fluxion-bg"), "#223344");
  assert.equal(second.variables.has("--fluxion-bg"), false);
  first.switchWorkspace("other");
  assert.equal(first.variables.has("--fluxion-bg"), false);
  assert.equal(first.variables.has("color-scheme"), false);
  assert.equal(preview.update(theme, "light"), false);
  first.switchWorkspace("focus");
  const old = first.api.beginWorkspacePreview("focus"), next = first.api.beginWorkspacePreview("focus");
  next.update(theme, "dark"); old.clear();
  assert.equal(first.attributes.get("data-fluxion-workspace-appearance"), "dark");
  assert.equal(old.update(theme), false);
  assert.throws(() => next.update({ ...theme, darkAccent: "url(file:///secret)" }));
  assert.throws(() => next.update(theme, "system"));
  next.update(null);
  assert.equal(first.variables.has("--fluxion-bg"), false, "Reset previews inherited colors without saving");
  first.close();
  assert.equal(next.update(theme), false);
  assert.equal(environment.saves(), 0);
});
