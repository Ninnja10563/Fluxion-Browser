"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), vm = require("node:vm");
const core = require("../chrome/core/duplicate-tabs.js");
const source = fs.readFileSync(require.resolve("../chrome/fluxion-duplicate-tabs.js"), "utf8");

function fixture() {
  class Node {
    constructor() { this.attrs = new Map(); this.listeners = new Map(); this.children = []; }
    setAttribute(k, v) { this.attrs.set(k, v); }
    getAttribute(k) { return this.attrs.get(k) || ""; }
    hasAttribute(k) { return this.attrs.has(k); }
    toggleAttribute(k, on) { if (on) this.attrs.set(k, ""); else this.attrs.delete(k); }
    addEventListener(type, fn) { this.listeners.set(type, [...(this.listeners.get(type) || []), fn]); }
    removeEventListener(type, fn) { this.listeners.set(type, (this.listeners.get(type) || []).filter(f => f !== fn)); }
    emit(type) { for (const fn of this.listeners.get(type) || []) fn({ target: this }); }
    insertBefore(node, before) { node.parentNode = this; this.children.splice(before ? this.children.indexOf(before) : this.children.length, 0, node); }
    get lastElementChild() { return this.children.at(-1); }
    remove() { this.parentNode.children = this.parentNode.children.filter(n => n !== this); }
  }
  const window = new Node(), popup = new Node(), tabContainer = new Node(), attempts = [], prompts = [], errors = [];
  popup.children.push(new Node(), new Node());
  const tabs = [0, 1, 2, 3].map(i => Object.assign(new Node(), { id: i, parentNode: tabContainer, ownerGlobal: window,
    workspace: "one", userContextId: 0, linkedBrowser: { currentURI: { spec: "https://example.org/page?q=1#part" } } }));
  let context = [tabs[0]], workspace = "one", spaces = [{ id: "one" }, { id: "two" }];
  const f = { window, popup, tabs, tabContainer, attempts, prompts, errors, consent: 0, duringPrompt() {}, duringClose() {} };
  const gBrowser = { tabs, tabContainer, selectedTab: tabs[0], getTabForBrowser: browser => tabs.find(t => t.linkedBrowser === browser),
    removeTab(tab, options) {
      attempts.push({ tab, options }); f.duringClose(tab);
      if (!f.cancelClose) { tab.closing = true; tab.parentNode = null; tabs.splice(tabs.indexOf(tab), 1); tabContainer.emit("TabClose"); }
    } };
  Object.assign(window, { document: { getElementById: () => popup, createXULElement: () => new Node() }, gBrowser,
    FluxionUI: { contextTabs: () => context, tabWorkspace: tab => tab.workspace, currentWorkspace: () => workspace, workspaces: () => spaces } });
  const contextObject = { window, FluxionDuplicateTabsCore: core, Cu: { reportError: e => errors.push(e) },
    Services: { prompt: { BUTTON_POS_0: 1, BUTTON_POS_1: 256, BUTTON_TITLE_IS_STRING: 127,
      BUTTON_TITLE_CANCEL: 2, BUTTON_POS_1_DEFAULT: 16777216,
      confirmEx(...args) { prompts.push(args); f.duringPrompt(); return f.consent; } } } };
  vm.runInNewContext(source, contextObject);
  return Object.assign(f, { item: popup.children[1], gBrowser, contextObject,
    setContext(value) { context = value; }, switchWorkspace(value) { workspace = value; }, removeWorkspace() { spaces = []; } });
}
function invoke(f) { f.popup.emit("popupshowing"); f.item.emit("command"); }

test("cleanup is explicit, counted, Cancel-default, one-shot and uses native recoverable closes", () => {
  const f = fixture(); f.popup.emit("popupshowing");
  assert.equal(f.item.getAttribute("label"), "Close 3 Duplicate Tabs…");
  assert.equal(f.attempts.length, 0); f.item.emit("command"); f.item.emit("command");
  assert.equal(f.prompts.length, 1); assert.ok(f.prompts[0][3] & 16777216);
  assert.equal(f.prompts[0][4], "Close 3 Tabs");
  assert.deepEqual(f.attempts.map(a => a.tab.id), [1, 2, 3]);
  for (const attempt of f.attempts) assert.deepEqual({ ...attempt.options }, { animate: false });
  assert.equal(f.tabs.length, 1); assert.equal(f.gBrowser.selectedTab, f.tabs[0]);
});

test("cancelling review or native beforeunload never retries or continues closing", () => {
  const f = fixture(); f.consent = 1; invoke(f); assert.equal(f.attempts.length, 0);
  f.consent = 0; f.cancelClose = true; invoke(f);
  assert.equal(f.attempts.length, 1); assert.equal(f.tabs.length, 4);
});

test("every protected tab remains and can anchor an unprotected duplicate", () => {
  const protections = [t => { t.selected = true; }, t => { t.multiselected = true; }, t => { t.pinned = true; },
    t => { t.group = {}; }, t => { t.splitview = {}; }, t => { t.soundPlaying = true; }, t => { t.muted = true; },
    t => { t.activeMediaBlocked = true; }, t => { t._pendingPermitUnload = true; },
    ...["camera", "microphone", "screen"].map(k => t => { t.linkedBrowser._sharingState = { webRTC: { sharing: k, paused: true } }; }),
    ...["multiselected", "pinned", "fluxion-peek", "busy", "soundplaying", "muted", "activemedia-blocked", "pictureinpicture", "sharing", "undiscardable"]
      .map(k => t => t.setAttribute(k, "true"))];
  for (const protect of protections) {
    const f = fixture(), protectedTab = f.tabs[1]; protect(protectedTab); invoke(f);
    assert.deepEqual(f.attempts.map(a => a.tab.id), [2, 3], String(protect)); assert.ok(protectedTab.parentNode);
  }
  const f = fixture(); f.setContext([f.tabs[1], f.tabs[2]]); invoke(f);
  assert.deepEqual(f.attempts.map(a => a.tab.id), [3]);
});

test("ended Gecko capture grace records do not indefinitely protect ordinary duplicates", () => {
  const f = fixture(); f.tabs[1].linkedBrowser._sharingState = { webRTC: {} }; invoke(f);
  assert.deepEqual(f.attempts.map(a => a.tab.id), [1, 2, 3]);
});

test("private-window cleanup is explicit and has no history, persistence or network dependency", () => {
  const f = fixture(); f.window.isPrivate = true; invoke(f);
  assert.equal(f.attempts.length, 3);
  assert.doesNotMatch(source, /Services\.prefs|PlacesUtils|fetch\(|localStorage|IOUtils|SessionStore\.\w/);
});

test("exact identity isolates URL fragments, queries, containers, workspaces and privileged pages", () => {
  for (const change of [t => { t.workspace = "two"; }, t => { t.userContextId = 2; },
    t => { t.linkedBrowser.currentURI.spec += "other"; }, t => { t.linkedBrowser.currentURI.spec = "about:preferences"; }]) {
    const f = fixture(); change(f.tabs[1]); change(f.tabs[2]); change(f.tabs[3]);
    invoke(f);
    // Three web tabs with a different exact key can still deduplicate amongst
    // themselves; a different workspace or internal URL is never eligible.
    if (f.tabs[1].workspace === "two" || f.tabs[1].linkedBrowser.currentURI.spec.startsWith("about:")) assert.equal(f.attempts.length, 0);
    else assert.deepEqual(f.attempts.map(a => a.tab.id), [2, 3]);
    assert.ok(f.tabs[0].parentNode); assert.equal(f.tabs[1].id, 1);
  }
});

test("menu snapshots and modal consent fail closed on changed targets, keepers, protection or scope", () => {
  const changes = [f => { f.tabs[1].linkedBrowser.currentURI.spec += "changed"; }, f => { f.tabs[0].linkedBrowser.currentURI.spec += "changed"; },
    f => { f.tabs[1].workspace = "two"; }, f => { f.tabs[1].userContextId = 2; },
    f => { f.tabs[1].linkedBrowser = { currentURI: { spec: f.tabs[1].linkedBrowser.currentURI.spec } }; },
    f => { f.tabs[1].parentNode = {}; }, f => { f.tabs[1].group = {}; }, f => f.tabs.reverse(),
    f => { f.tabs[1].ownerGlobal = {}; }, f => { f.tabs[1].parentNode = null; }, f => { f.tabs[1].closing = true; },
    f => f.tabs.splice(1, 1), f => f.switchWorkspace("two"), f => f.removeWorkspace(), f => { f.window.closed = true; },
    f => { f.gBrowser.selectedTab = f.tabs[1]; }, f => f.window.emit("unload")];
  for (const change of changes) for (const duringModal of [false, true]) {
    const f = fixture(); f.popup.emit("popupshowing");
    if (duringModal) f.duringPrompt = () => change(f); else change(f);
    f.item.emit("command"); assert.equal(f.attempts.length, 0, `${duringModal}: ${change}`);
  }
});

test("native modal reentry cannot launch a second cleanup; mutations during page prompts stop subsequent closes", () => {
  const f = fixture(); f.duringPrompt = () => { invoke(f); };
  f.duringClose = () => { f.tabs[2].linkedBrowser.currentURI.spec += "changed"; };
  invoke(f); assert.equal(f.prompts.length, 1); assert.deepEqual(f.attempts.map(a => a.tab.id), [1]);
});

test("menu invalidation, failure, repeat evaluation and unload leave no stale commands or listeners", () => {
  for (const event of ["TabMove", "TabClose", "TabBrowserInserted"]) {
    const f = fixture(); f.popup.emit("popupshowing"); f.tabContainer.emit(event); f.item.emit("command"); assert.equal(f.prompts.length, 0);
  }
  const f = fixture(); vm.runInNewContext(source, f.contextObject); assert.equal(f.popup.children.length, 3);
  f.popup.emit("popupshowing"); f.popup.emit("popuphidden"); f.item.emit("command"); assert.equal(f.prompts.length, 0);
  f.duringClose = () => { throw new Error("native failure"); }; invoke(f); assert.equal(f.errors.length, 1);
  f.window.emit("unload"); assert.equal(f.popup.children.length, 2); assert.equal(f.window.FluxionDuplicateTabs, undefined);
  for (const listeners of f.tabContainer.listeners.values()) assert.equal(listeners.length, 0);
});
