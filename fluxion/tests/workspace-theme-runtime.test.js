"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const colors = require("../chrome/core/colors.js");
const workspacesCore = require("../chrome/core/workspaces.js");
const source = fs.readFileSync(require.resolve("../chrome/fluxion-workspace-theme.js"), "utf8");

function runtime({ appearance = "system", dark = false } = {}) {
  const nodes = [], frames = new Map(), writes = [], previews = [], variables = new Map();
  if (appearance !== "system") variables.set("color-scheme", appearance);
  let id = 0, current = "focus", items = [{ id: "focus", name: "Focus", icon: "circle", accent: "slate" }, { id: "other", name: "Other" }];
  const document = { activeElement: null, hasFocus: () => true };
  class Element {
    constructor(tag) { this.localName = tag; this.ownerDocument = document; this.attrs = {}; this.children = []; this.events = new Map(); this.value = ""; this.textContent = ""; nodes.push(this); }
    get isConnected() { return this === document.documentElement || Boolean(this.parentNode?.isConnected); }
    setAttribute(name, value) { this.attrs[name] = value; if (name === "id") this.id = value; }
    getAttribute(name) { return this.attrs[name] ?? null; }
    removeAttribute(name) { delete this.attrs[name]; }
    append(...children) { for (const child of children) { this.children.push(child); child.parentNode = this; } }
    remove() { this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.parentNode = null; }
    addEventListener(type, listener) { if (!this.events.has(type)) this.events.set(type, []); this.events.get(type).push(listener); }
    removeEventListener(type, listener) { this.events.set(type, (this.events.get(type) || []).filter(value => value !== listener)); }
    emit(type, event = {}) { const e = { target: this, preventDefault() {}, stopPropagation() {}, ...event }; for (const listener of this.events.get(type) || []) listener(e); }
    focus() { document.activeElement = this; }
    select() { this.selected = true; }
    closest() { return null; }
    getBoundingClientRect() { return { width: this.isConnected ? 30 : 0 }; }
    openPopup(anchor) { this.anchor = anchor; this.state = "open"; this.emit("popupshown"); }
    hidePopup() { if (this.state === "open") { this.state = "closed"; this.emit("popuphidden"); } }
  }
  document.documentElement = new Element("window");
  document.documentElement.style = {
    setProperty: (key, value) => variables.set(key, value),
    getPropertyValue: key => variables.get(key) || "",
    removeProperty: key => variables.delete(key),
  };
  document.createElementNS = (_namespace, tag) => new Element(tag);
  document.createXULElement = tag => new Element(tag);
  document.getElementById = key => nodes.find(node => node.id === key && node.isConnected) || null;
  const anchor = new Element("button"); document.documentElement.append(anchor);
  const window = new Element("window");
  Object.assign(window, { document, gBrowser: {},
    requestAnimationFrame(callback) { frames.set(++id, callback); return id; },
    cancelAnimationFrame: key => frames.delete(key),
    matchMedia: () => ({ matches: dark, addEventListener() {}, removeEventListener() {} }),
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    dispatchEvent(event) { this.emit(event.type, event); },
    FluxionTheme: { current: () => appearance },
    FluxionUI: {
      workspaces: () => structuredClone(items),
      currentWorkspace: () => current,
      updateWorkspace(key, changes) {
        writes.push({ key, changes: structuredClone(changes) }); items = workspacesCore.updateWorkspace(items, key, changes);
        window.emit("FluxionWorkspacesChanged"); return items?.find(item => item.id === key);
      },
    },
  });
  const focus = { activeWindow: window };
  vm.runInNewContext(fs.readFileSync(require.resolve("../chrome/fluxion-colors.js"), "utf8"), {
    window, FluxionColorsCore: colors, FluxionWorkspaces: workspacesCore,
    Services: { prefs: { getStringPref: (_key, fallback) => fallback, addObserver() {}, removeObserver() {} } },
  });
  const nativeColors = window.FluxionColors;
  window.FluxionColors = { ...nativeColors, beginWorkspacePreview(key) {
    const handle = nativeColors.beginWorkspacePreview(key);
    return { update(theme, mode) { previews.push({ key, theme: structuredClone(theme), mode }); return handle.update(theme, mode); },
      clear() { previews.push({ cleared: true }); handle.clear(); } };
  } };
  vm.runInNewContext(source, { window, FluxionColorsCore: colors, Services: { focus } });
  const get = suffix => document.getElementById(`fluxion-workspace-theme${suffix ? `-${suffix}` : ""}`);
  const flush = () => { const pending = [...frames.values()]; frames.clear(); for (const callback of pending) callback(); };
  const open = () => { assert.equal(window.FluxionWorkspaceTheme.open("focus", anchor), true); flush(); };
  const input = (name, value) => { get(name).value = value; get(name).emit(["mode", "appearance"].includes(name) ? "change" : "input"); };
  const submit = () => get("save").parentNode.parentNode.emit("submit");
  return { window, document, anchor, writes, previews, variables, get, flush, open, input, submit, focus, items: () => items,
    colorsPage: () => get("colors").emit("click"),
    scheme: () => document.documentElement.getAttribute("data-fluxion-workspace-appearance"),
    switchWorkspace(key) { current = key; window.FluxionColors.project(); },
    replace: value => { items = value; } };
}

test("native theme panel keeps local per-mode drafts, validates both colors, and saves one atomic update", () => {
  const env = runtime(); env.open();
  assert.equal(env.get().state, "open");
  assert.equal(env.get("title").textContent, "Focus appearance");
  assert.equal(env.document.activeElement, env.get("appearance"));
  assert.equal(env.get("colors-page").hidden, true);
  env.colorsPage();
  assert.equal(env.get("overview").hidden, true);
  assert.equal(env.document.activeElement, env.get("hex"));
  env.input("hex", "#ABCDEF");
  assert.equal(env.get("color").value, "#abcdef");
  env.input("mode", "dark");
  env.input("color", "#102030");
  assert.equal(env.get("hex").value, "#102030");
  assert.equal(env.writes.length, 0, "editing pixels never writes workspace state");
  env.submit();
  assert.deepEqual(env.writes, [{ key: "focus", changes: { theme: { light: "#abcdef", dark: "#102030",
    lightAccent: colors.DEFAULTS.light.accent, darkAccent: colors.DEFAULTS.dark.accent } } }]);
  assert.equal(env.get().state, "closed");
  assert.equal(env.document.activeElement, env.anchor);
});

test("theme panel styles bind Gecko's actual content surface tokens and preserve the native select disclosure", () => {
  const env = runtime();
  const css = env.get().children.find(node => node.localName === "style").textContent;
  const panelRule = css.match(/#fluxion-workspace-theme \{([^}]+)\}/)[1];
  assert.match(panelRule, /--panel-background-color:\s*var\(--fluxion-bg-raised\)/);
  assert.match(panelRule, /--panel-text-color:\s*var\(--fluxion-ink\)/);
  assert.match(panelRule, /--panel-border-color:\s*var\(--fluxion-line\)/);
  assert.match(panelRule, /--panel-padding:\s*0/);
  assert.match(panelRule, /color-scheme:\s*inherit/);
  assert.doesNotMatch(panelRule, /--panel-(?:background|color):/);
  const selectRule = css.match(/\.fluxion-workspace-theme-form select \{([^}]+)\}/)[1];
  assert.match(selectRule, /background-image:\s*url\("chrome:\/\/global\/skin\/icons\/arrow-down-12\.svg"\)/);
  assert.match(selectRule, /padding-inline-end:\s*28px/);
  assert.match(selectRule, /fill:\s*currentColor/);
  assert.match(css, /select:dir\(rtl\).*background-position:\s*left 8px center/);
});

test("invalid or stale theme drafts cannot overwrite storage; unrelated metadata edits are preserved", () => {
  const env = runtime(); env.open();
  env.input("hex", "url(x)"); env.input("mode", "dark"); env.submit();
  assert.equal(env.get("mode").value, "light");
  assert.equal(env.get("hex").getAttribute("aria-invalid"), "true");
  assert.equal(env.writes.length, 0);
  env.input("hex", "#ddeeff");
  env.items()[0].theme = { light: "#ffffff", dark: "#000000" };
  env.submit();
  assert.match(env.get("error").textContent, /changed elsewhere/);
  assert.equal(env.writes.length, 0);
  env.get("cancel").emit("click"); env.open();
  env.input("hex", "#aabbcc");
  env.items()[0].name = "Renamed elsewhere";
  env.items()[0].icon = "grid";
  env.submit();
  assert.equal(env.items()[0].name, "Renamed elsewhere");
  assert.equal(env.items()[0].icon, "grid");
  assert.equal(env.items()[0].theme.light, "#aabbcc");
});

test("Cancel, Escape, outside dismissal and pending-open cancellation do not mutate workspace themes", () => {
  const env = runtime();
  for (const dismiss of [() => env.get("cancel").emit("click"), () => env.get().emit("keydown", { key: "Escape" }), () => env.get().hidePopup()]) {
    env.open(); env.input("hex", "#334455"); dismiss();
    assert.equal(env.writes.length, 0);
  }
  env.window.FluxionWorkspaceTheme.open("focus", env.anchor);
  env.window.emit("unload"); env.flush();
  assert.equal(env.get(), null);
  assert.equal(env.window.FluxionWorkspaceTheme, undefined);
  assert.equal(env.writes.length, 0);
});

test("Reset removes only the target theme and deleted targets or failed persistence retain the draft safely", () => {
  const env = runtime();
  env.items()[0].theme = { light: "#ffffff", dark: "#000000" };
  env.open(); env.get("reset").emit("click");
  assert.ok(env.items()[0].theme, "Reset is a previewable draft until Save");
  assert.equal(env.writes.length, 0);
  env.submit();
  assert.equal(Object.hasOwn(env.items()[0], "theme"), false);
  assert.deepEqual(env.writes[0], { key: "focus", changes: { theme: null } });
  env.open(); env.replace([env.items()[1]]); env.submit();
  assert.match(env.get("error").textContent, /changed elsewhere/);
  assert.equal(env.writes.length, 1);
  env.get("cancel").emit("click");
  env.replace([{ id: "focus", name: "Focus" }]); env.open();
  env.input("hex", "#112244");
  env.window.FluxionUI.updateWorkspace = () => { throw new Error("disk failure"); };
  env.submit();
  assert.match(env.get("error").textContent, /could not be saved/);
  assert.equal(env.get("hex").value, "#112244");
  assert.equal(env.get().state, "open");
});

test("initial picker mode honors explicit browser appearance ahead of the OS and rejects detached or foreign anchors", () => {
  for (const [appearance, dark, expected] of [["dark", false, "dark"], ["light", true, "light"], ["system", true, "dark"], ["system", false, "light"]]) {
    const env = runtime({ appearance, dark }); env.open();
    assert.equal(env.get("mode").value, expected);
  }
  const env = runtime();
  assert.equal(env.window.FluxionWorkspaceTheme.open("missing", env.anchor), false);
  assert.equal(env.window.FluxionWorkspaceTheme.open("focus", { isConnected: true, ownerDocument: {} }), false);
  env.anchor.remove();
  assert.equal(env.window.FluxionWorkspaceTheme.open("focus", env.anchor), false);
});

test("deleting and recreating a workspace ID cannot revive an old editor or pending open", () => {
  const env = runtime(); env.open(); env.input("hex", "#aabbcc");
  const original = structuredClone(env.items()[0]);
  env.replace([env.items()[1]]);
  env.window.emit("FluxionWorkspacesChanged");
  env.replace([original, ...env.items()]);
  env.window.emit("FluxionWorkspacesChanged");
  env.submit();
  assert.equal(env.writes.length, 0);
  assert.match(env.get("error").textContent, /changed elsewhere/);
  env.get("cancel").emit("click");
  env.window.FluxionWorkspaceTheme.open("focus", env.anchor);
  env.replace([env.items()[1]]); env.window.emit("FluxionWorkspacesChanged");
  env.replace([original, ...env.items()]); env.window.emit("FluxionWorkspacesChanged");
  env.flush();
  assert.equal(env.get().state, "closed");
});

test("deferred panel opening rechecks native focus and anchor visibility instead of stealing focus", () => {
  for (const invalidate of [
    env => { env.focus.activeWindow = {}; },
    env => { env.document.hasFocus = () => false; },
    env => { env.anchor.getBoundingClientRect = () => ({ width: 0 }); },
    env => { env.anchor.closest = () => ({}); },
    env => { env.anchor.remove(); },
  ]) {
    const env = runtime();
    assert.equal(env.window.FluxionWorkspaceTheme.open("focus", env.anchor), true);
    invalidate(env); env.flush();
    assert.notEqual(env.get().state, "open");
    assert.equal(env.document.activeElement, null);
    assert.equal(env.writes.length, 0);
  }
});

test("one panel previews edited palette and accent, Back restores chosen appearance, Save commits that choice", () => {
  const env = runtime({ appearance: "light" }); env.open();
  assert.equal(env.variables.has("--fluxion-bg"), false, "opening overview does not retune an unchanged frame");
  env.input("appearance", "dark");
  assert.equal(env.scheme(), "dark");
  assert.equal(env.variables.get("color-scheme"), "light", "root/content appearance is not a preview surface");
  env.colorsPage(); env.input("mode", "light");
  assert.equal(env.scheme(), "light");
  env.input("hex", "#eeddcc"); env.input("accent-hex", "#225588");
  assert.equal(env.get("accent-color").value, "#225588");
  env.input("mode", "dark"); env.input("hex", "#112233"); env.input("accent-color", "#aaddff");
  env.input("mode", "light");
  assert.equal(env.get("hex").value, "#eeddcc");
  assert.equal(env.get("accent-hex").value, "#225588");
  assert.match(env.get("note").textContent, /Previewing light colors/);
  env.get("back").emit("click");
  assert.equal(env.get().state, "open", "page navigation never creates a second popup");
  assert.equal(env.get("overview").hidden, false);
  assert.equal(env.document.activeElement, env.get("colors"));
  assert.equal(env.scheme(), "dark", "palette preview does not silently change saved appearance");
  assert.equal(env.writes.length, 0);
  env.submit();
  assert.deepEqual(env.items()[0].theme, { light: "#eeddcc", dark: "#112233", lightAccent: "#225588", darkAccent: "#aaddff", mode: "dark" });
  assert.equal(env.scheme(), "dark");
  assert.equal(env.variables.get("--fluxion-bg"), "#112233");
});

test("opening or inspecting palettes then Save does not create an unwanted override", () => {
  const env = runtime(); env.open(); env.submit();
  assert.equal(env.writes.length, 0);
  assert.equal(env.variables.has("--fluxion-bg"), false);
  env.open(); env.colorsPage(); env.input("mode", "dark");
  assert.equal(env.scheme(), "dark");
  env.get("back").emit("click");
  assert.equal(env.variables.has("--fluxion-bg"), false);
  assert.equal(env.variables.has("color-scheme"), false);
  env.submit(); assert.equal(env.writes.length, 0);
});

test("preview rollback restores saved colors and active mode on every dismissal and a workspace switch cannot revive it", () => {
  const env = runtime();
  env.items()[0].theme = { light: "#eeeeee", dark: "#222222", mode: "dark" };
  env.window.FluxionColors.project();
  const original = [...env.variables];
  for (const dismiss of [() => env.get("cancel").emit("click"), () => env.get().emit("keydown", { key: "Escape" }), () => env.get().hidePopup()]) {
    env.open(); env.colorsPage(); env.input("mode", "light"); env.input("hex", "#123456");
    assert.notDeepEqual([...env.variables], original);
    dismiss();
    assert.deepEqual([...env.variables], original);
    assert.equal(env.writes.length, 0);
  }
  env.open(); env.colorsPage(); env.input("hex", "#aabbcc");
  const outsideFocus = {}; env.document.activeElement = outsideFocus;
  env.switchWorkspace("other");
  assert.equal(env.get().state, "closed");
  assert.equal(env.variables.has("--fluxion-bg"), false);
  assert.equal(env.document.activeElement, outsideFocus, "workspace changes do not steal focus back to the old anchor");
  env.switchWorkspace("focus");
  assert.deepEqual([...env.variables], original);
});

test("Reset is previewed and reversible, invalid accents remain draft-only, stale remote changes roll back immediately", () => {
  const env = runtime();
  env.items()[0].theme = { light: "#eeddcc", dark: "#223344", mode: "dark" };
  env.window.FluxionColors.project(); const original = [...env.variables];
  env.open(); env.get("reset").emit("click");
  assert.equal(env.variables.has("--fluxion-bg"), false);
  assert.equal(env.writes.length, 0);
  env.get("cancel").emit("click"); assert.deepEqual([...env.variables], original);
  env.open(); env.colorsPage(); env.input("accent-hex", "#fff"); env.submit();
  assert.equal(env.get("accent-hex").getAttribute("aria-invalid"), "true");
  assert.equal(env.document.activeElement, env.get("accent-hex"));
  assert.equal(env.writes.length, 0);
  env.input("accent-hex", "#ffeedd");
  env.items()[0].theme = { light: "#fafafa", dark: "#101010", mode: "light" };
  env.window.emit("FluxionWorkspacesChanged");
  assert.equal(env.variables.get("--fluxion-bg"), "#fafafa");
  assert.equal(env.scheme(), "light");
  env.submit(); assert.equal(env.writes.length, 0);
  assert.match(env.get("error").textContent, /changed elsewhere/);
});
