"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const source = fs.readFileSync(require.resolve("../chrome/fluxion-updates-ui.js"), "utf8");
function fixture({ privateWindow = false } = {}) {
  const nodes = [], calls = [], callbacks = new Set(), errors = [], imports = [];
  class Node {
    constructor(name) { this.localName = name; this.children = []; this.attrs = new Map(); this.listeners = new Map(); this.style = {}; nodes.push(this); }
    append(...children) { for (const child of children) { child.parentNode = this; this.children.push(child); } }
    appendChild(child) { this.append(child); }
    insertBefore(child, before) { const index = this.children.indexOf(before); child.parentNode = this; this.children.splice(index < 0 ? this.children.length : index, 0, child); }
    setAttribute(k, v) { this.attrs.set(k, String(v)); }
    getAttribute(k) { return this.attrs.get(k); }
    addEventListener(type, fn) { this.listeners.set(type, [...(this.listeners.get(type) || []), fn]); }
    removeEventListener(type, fn) { this.listeners.set(type, (this.listeners.get(type) || []).filter(f => f !== fn)); }
    dispatch(type) { return Promise.all((this.listeners.get(type) || []).map(fn => fn())); }
    render() { this.rendered = true; }
    remove() { this.removed = true; if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(node => node !== this); }
  }
  const root = new Node("window"), target = new Node("hbox"), menu = new Node("toolbarbutton");
  target.id = "nav-bar-customization-target"; menu.id = "fluxion-toolbar-menu"; target.append(menu);
  const document = { documentElement: root, getElementById: id => nodes.find(node => node.id === id),
    createXULElement: name => new Node(name), createElementNS: (_, name) => new Node(name) };
  const gBrowser = { tabs: [], addTrustedTab(url) { calls.push({ action: "open", url });
    const tab = { linkedBrowser: { currentURI: { spec: url } } }; this.tabs.push(tab); return tab; } };
  const window = Object.assign(new Node("window"), { document, gBrowser, FluxionUI: {
    currentWorkspace: () => "work", setTabWorkspace(tab, workspace) { tab.workspace = workspace; },
    selectTab(tab) { gBrowser.selectedTab = tab; calls.push({ action: "select", tab }); },
  } });
  let state = { state: "idle", automatic: true };
  const coordinator = { getState: () => state, watch(owner, cb) { calls.push({ action: "watch", owner }); callbacks.add(cb); cb(state); return () => callbacks.delete(cb); },
    install: () => new Promise((resolve, reject) => calls.push({ action: "install", resolve, reject })) };
  const context = { window, Cu: { reportError: error => errors.push(error) }, ChromeUtils: { importESModule(name) {
    imports.push(name);
    return name.includes("PrivateBrowsingUtils") ? { PrivateBrowsingUtils: { isWindowPrivate: () => privateWindow } }
      : { FluxionUpdateCoordinator: coordinator };
  } } };
  vm.runInNewContext(source, context);
  return { window, gBrowser, nodes, target, menu, calls, callbacks, imports, errors,
    button: document.getElementById("fluxion-update-indicator"),
    emit(next) { state = Object.freeze(next); for (const cb of callbacks) cb(state); },
    reload() { vm.runInNewContext(source, context); }, unload() { return window.dispatch("unload"); },
  };
}
test("one quiet indicator registers once, stays hidden when current and never starts its own network check", () => {
  const h = fixture(); assert.equal(h.button.hidden, true); assert.equal(h.button.rendered, true);
  assert.equal(h.target.children[0], h.button); assert.equal(h.target.children[1], h.menu);
  assert.deepEqual(h.calls.map(call => call.action), ["watch"]);
  h.reload(); assert.equal(h.callbacks.size, 1); assert.equal(h.target.children.length, 2);
  for (const state of ["checking", "current", "unsupported", "idle"]) {
    h.emit({ state }); assert.equal(h.button.hidden, true);
  }
});
test("available update is explicitly labeled restart and one command starts exactly one installation", async () => {
  const h = fixture(); h.emit({ state: "available", latest: "1.2.3", canInstall: true });
  assert.equal(h.button.hidden, false);
  assert.equal(h.button.getAttribute("aria-label"), "Update to 1.2.3 and restart Fluxion");
  assert.equal(h.button.getAttribute("tooltiptext"), h.button.getAttribute("aria-label"));
  const first = h.button.dispatch("command"); h.button.dispatch("command");
  assert.equal(h.calls.filter(call => call.action === "install").length, 1);
  assert.equal(h.calls.filter(call => call.action === "open").length, 0);
  h.emit({ state: "downloading", latest: "1.2.3", progress: .4, canCancel: true });
  assert.equal(h.button.disabled, false, "progress remains actionable while the install promise runs");
  assert.match(h.button.getAttribute("aria-label"), /40%/);
  const progress = h.button.children.find(node => node.className === "fluxion-update-indicator-progress");
  assert.equal(progress.hidden, false); assert.equal(progress.style.transform, "scaleX(0.4)");
  await h.button.dispatch("command");
  assert.equal(h.calls.filter(call => call.action === "open").length, 1);
  assert.equal(h.gBrowser.selectedTab.workspace, "work");
  await h.button.dispatch("command");
  assert.equal(h.calls.filter(call => call.action === "open").length, 1, "repeat status clicks reuse About");
  h.calls.find(call => call.action === "install").resolve(); await first;
});
test("manual-only, retry and errors route to status without ever requesting installation", async () => {
  const h = fixture();
  for (const state of ["available", "retry", "error"]) {
    h.emit({ state, latest: "1.2.3", canInstall: false, detail: "Install manually in this profile." });
    await h.button.dispatch("command");
  }
  assert.equal(h.calls.some(call => call.action === "install"), false);
  assert.equal(h.calls.filter(call => call.action === "open").length, 1);
  assert.equal(h.gBrowser.selectedTab.linkedBrowser.currentURI.spec, "about:preferences?fluxion=about");
});
test("unknown progress has no fabricated percentage and stale state hides the indicator", () => {
  const h = fixture(), progress = h.button.children.find(node => node.className === "fluxion-update-indicator-progress");
  for (const value of [null, undefined, NaN, Infinity]) {
    h.emit({ state: "extracting", progress: value });
    assert.equal(progress.hidden, true); assert.doesNotMatch(h.button.getAttribute("aria-label"), /%/);
  }
  h.emit({ state: "downloading", progress: 1.5 }); assert.match(h.button.getAttribute("aria-label"), /100%/);
  h.emit({ state: "checking-install", detail: "Verifying the signed update offer…" });
  assert.equal(h.button.hidden, false); assert.match(h.button.getAttribute("aria-label"), /Verifying/);
  h.emit({ state: "canceled" }); assert.equal(h.button.hidden, true);
  h.emit({ state: "current" }); assert.equal(h.button.hidden, true);
});
test("private windows never register an update monitor or toolbar control", () => {
  const h = fixture({ privateWindow: true });
  assert.equal(h.button, undefined); assert.equal(h.callbacks.size, 0); assert.deepEqual(h.calls, []);
  assert.equal(h.imports.some(name => name.includes("Coordinator")), false);
});
test("unloading cancels UI subscription and a rejected in-flight action cannot open a tab", async () => {
  const h = fixture(); h.emit({ state: "available", latest: "1.2.3", canInstall: true });
  const action = h.button.dispatch("command"); await h.unload();
  assert.equal(h.callbacks.size, 0); assert.equal(h.button.removed, true);
  h.calls.find(call => call.action === "install").reject(new Error("window closed")); await action;
  assert.equal(h.calls.some(call => call.action === "open"), false);
});
