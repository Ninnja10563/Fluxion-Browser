"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(require.resolve("../chrome/fluxion-new-tab.js"), "utf8");

function emitter(object = {}) {
  const listeners = new Map();
  return Object.assign(object, {
    addEventListener(type, handler) { const handlers = listeners.get(type) || new Set(); handlers.add(handler); listeners.set(type, handlers); },
    removeEventListener(type, handler) { listeners.get(type)?.delete(handler); },
    emit(type, properties = {}) { for (const handler of [...listeners.get(type) || []]) handler({ type, ...properties }); },
    listenerCount() { return [...listeners.values()].reduce((count, handlers) => count + handlers.size, 0); },
  });
}
function fixture({ context = 0, privateWindow = false, missing = null } = {}) {
  const document = { activeElement: null }, calls = [], microtasks = [], tabs = [], states = new Map();
  const stateFor = browser => { if (!states.has(browser)) states.set(browser, {}); return states.get(browser); };
  const modes = { get: browser => stateFor(browser).searchModes?.confirmed || null,
    set: (browser, mode) => { stateFor(browser).searchModes = { confirmed: mode }; } };
  let selected, workspace = "focus", fallback = () => Promise.resolve({ heuristicResult: { url: "https://example.net/" } });
  function makeTab(url, userContextId = 0) {
    const browser = { browserId: tabs.length + 1, currentURI: { spec: url }, lastLocationChange: 1,
      userTypedValue: null, focus() { document.activeElement = browser; urlbar.emit("focusout"); } };
    const tab = { parentNode: {}, closing: false, linkedBrowser: browser, workspace,
      getAttribute: name => name === "usercontextid" ? String(userContextId) : "" };
    tabs.push(tab); return tab;
  }
  const gBrowser = {
    tabs, tabContainer: emitter(), get selectedTab() { return selected; },
    set selectedTab(tab) { selected = tab; this.tabContainer.emit("TabSelect", { target: tab }); },
    get selectedBrowser() { return selected?.linkedBrowser; },
    getTabForBrowser: browser => tabs.find(tab => tab.parentNode && tab.linkedBrowser === browser),
    addTrustedTab(url, params) { calls.push({ kind: "add", url, params }); return makeTab(url, params.userContextId); },
  };
  const controller = {
    whereToOpen: event => event?.where || "current",
    willLoadInBackground: (where, params) => where === "tabshifted" || !!params.inBackground,
    loadURL(details) { calls.push({ kind: "load", details });
      const browser = tabs.find(tab => tab.linkedBrowser.browserId === details.browserId)?.linkedBrowser || gBrowser.selectedBrowser;
      browser.currentURI.spec = details.url;
      if (!details.params.avoidBrowserFocus) browser.focus();
      return { reverted: false, browserId: browser.browserId }; },
    openSERP(...args) { calls.push({ kind: "search", args }); },
    openSearchForm(...args) { calls.push({ kind: "form", args }); },
    resolveFallbackNavigation(...args) { return fallback(...args); },
    cancelQuery() { calls.push({ kind: "cancel-query" }); },
    switchToTab(...args) { calls.push({ kind: "switch", args }); },
  };
  const attributes = new Map(), input = {};
  const urlbar = emitter({ controller, value: "", inputField: input, isPrivate: privateWindow,
    setAttribute: (name, value) => attributes.set(name, value), removeAttribute: name => attributes.delete(name),
    contains: node => node === input,
    search(value) { this.value = value; selected.linkedBrowser.userTypedValue = value; document.activeElement = input; this.emit("input"); },
    select() { document.activeElement = input; },
    getSearchMode: browser => stateFor(browser).searchModes?.preview || modes.get(browser),
    getBrowserState: stateFor,
    _updateSearchModeUI(mode) { this.paintedMode = mode; },
    setSearchMode(mode, browser) {
      // Model Gecko's synchronous typed-value side effect. Product restore
      // must not invoke this engine-ready/possibly-asynchronous setter.
      calls.push({ kind: "set-search-mode" }); modes.set(browser, mode);
      if (mode && browser === selected.linkedBrowser) browser.userTypedValue = this.value;
    },
    set searchMode(mode) { stateFor(selected.linkedBrowser).searchModes = mode ? { confirmed: mode } : {}; },
    setURI() {
      this.value = selected.linkedBrowser.userTypedValue ?? selected.linkedBrowser.currentURI.spec;
      if (selected.linkedBrowser.userTypedValue === null) stateFor(selected.linkedBrowser).searchModes = {};
    },
    view: { close() { calls.push({ kind: "close-view" }); } },
  });
  const BrowserCommands = { openTab(options) { calls.push({ kind: "native-new", options }); return "native"; } };
  const window = emitter({ document, gBrowser, gURLBar: urlbar, BrowserCommands, closed: false,
    queueMicrotask: callback => microtasks.push(callback),
    FluxionUI: { currentWorkspace: () => workspace, tabWorkspace: tab => tab.workspace,
      setTabWorkspace: (tab, id) => { tab.workspace = id; } },
  });
  selected = makeTab("https://example.org/original", context);
  const original = selected, originals = { ...controller }, originalOpenTab = BrowserCommands.openTab;
  if (missing) delete controller[missing];
  const contextVM = vm.createContext({ window });
  const run = () => vm.runInContext(source, contextVM);
  run();
  return { window, urlbar, controller, gBrowser, original, originals, BrowserCommands, originalOpenTab,
    document, calls, modes, attributes, run,
    get api() { return window.FluxionNewTab; },
    makeTab, workspace(id) { workspace = id; window.emit("FluxionWorkspacesChanged"); },
    flush() { while (microtasks.length) microtasks.shift()(); },
    fallback(fn) { fallback = fn; },
    enter(url = "https://example.net/", params = {}) {
      return controller.loadURL({ url, where: controller.whereToOpen(), params, browserId: original.linkedBrowser.browserId });
    },
    escape(trusted = true) {
      const event = { key: "Escape", isTrusted: trusted, prevented: false, stopped: false,
        preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
      window.emit("keydown", event); return event;
    },
  };
}

test("New Tab and plain native Cmd-T focus one draft without creating a tab or navigating", () => {
  const f = fixture();
  assert.equal(f.api.begin(), null);
  assert.equal(f.api.pending, true);
  assert.equal(f.gBrowser.tabs.length, 1);
  assert.equal(f.document.activeElement, f.urlbar.inputField);
  f.urlbar.value = "unfinished query";
  assert.equal(f.BrowserCommands.openTab({ event: { type: "keydown", metaKey: true } }), null);
  assert.equal(f.urlbar.value, "unfinished query", "repeated New Tab preserves an existing draft");
  assert.equal(f.gBrowser.tabs.length, 1);
  assert.equal(f.original.linkedBrowser.currentURI.spec, "https://example.org/original");
});
test("Escape cancels the draft and restores the source address/search state without close history", () => {
  const f = fixture(), mode = { engineName: "Original" };
  f.original.linkedBrowser.userTypedValue = "prior unfinished address";
  f.modes.set(f.original.linkedBrowser, mode);
  f.api.begin(); f.urlbar.value = "abandoned query";
  f.escape(false); assert.equal(f.api.pending, true, "content/synthetic Escape cannot control privileged state");
  f.escape(); f.flush();
  assert.equal(f.api.pending, false);
  assert.equal(f.gBrowser.tabs.length, 1);
  assert.equal(f.original.linkedBrowser.userTypedValue, "prior unfinished address");
  assert.equal(f.urlbar.value, "prior unfinished address");
  assert.equal(f.modes.get(f.original.linkedBrowser).engineName, mode.engineName);
  assert.equal(f.calls.some(call => call.kind === "set-search-mode"), false);
  assert.equal(f.document.activeElement, f.original.linkedBrowser);
});
test("commit creates exactly one native target in source workspace/container and preserves native load parameters", () => {
  const f = fixture({ context: 7, privateWindow: true });
  const postData = {}, principal = {}, csp = {};
  f.api.begin();
  const result = f.enter("https://example.net/search", { postData, triggeringPrincipal: principal, csp, private: true, allowInheritPrincipal: false });
  f.flush();
  assert.equal(f.api.pending, false);
  assert.equal(f.gBrowser.tabs.length, 2);
  const target = f.gBrowser.selectedTab, call = f.calls.find(item => item.kind === "load");
  assert.notEqual(target, f.original);
  assert.equal(target.workspace, "focus"); assert.equal(target.getAttribute("usercontextid"), "7");
  assert.equal(call.details.where, "current"); assert.equal(result.browserId, target.linkedBrowser.browserId);
  assert.equal(call.details.params.postData, postData); assert.equal(call.details.params.triggeringPrincipal, principal);
  assert.equal(call.details.params.csp, csp); assert.equal(call.details.params.private, true);
  assert.equal(call.details.params.allowInheritPrincipal, false);
  assert.equal(f.original.linkedBrowser.currentURI.spec, "https://example.org/original");
  assert.equal(f.original.linkedBrowser.userTypedValue, null);
});
test("native search-mode and engine-home commits retain engine/query and target container", () => {
  for (const name of ["openSERP", "openSearchForm"]) {
    const f = fixture({ context: 3 }); f.api.begin();
    const args = name === "openSERP" ? ["engine-id", "native search words", "tab", false, 1] : ["engine-id", "tab", false, 1];
    f.controller[name](...args);
    assert.equal(f.api.pending, false); assert.equal(f.gBrowser.tabs.length, 2);
    assert.equal(f.gBrowser.selectedTab.getAttribute("usercontextid"), "3");
    const call = f.calls.find(item => item.kind === (name === "openSERP" ? "search" : "form"));
    assert.equal(call.args[0], "engine-id");
    const index = name === "openSERP" ? 2 : 1;
    assert.equal(call.args[index], "current"); assert.equal(call.args[index + 2], 2);
    if (index === 2) assert.equal(call.args[1], "native search words");
  }
});
test("native background and explicit window/save destinations retain their selection policy", () => {
  const f = fixture({ context: 2 }); f.api.begin();
  f.controller.loadURL({ url: "https://background.example/", where: "tabshifted", params: {}, browserId: 1 });
  assert.equal(f.gBrowser.tabs.length, 2); assert.equal(f.gBrowser.selectedTab, f.original);
  assert.equal(f.calls.find(item => item.kind === "load").details.params.avoidBrowserFocus, true);
  for (const where of ["window", "save"]) {
    const other = fixture(); other.api.begin();
    other.controller.loadURL({ url: "https://example.net/", where, params: { private: true }, browserId: 1 });
    assert.equal(other.gBrowser.tabs.length, 1);
    assert.equal(other.calls.find(item => item.kind === "load").details.where, where);
  }
});
test("explicit URL and clipboard/modified mouse New Tab actions still call Gecko unchanged", () => {
  for (const options of [{ url: "https://example.net/" }, { event: { button: 1, type: "auxclick" } },
    { event: { button: 0, type: "click", metaKey: true } }, { url: "" }]) {
    const f = fixture(); f.api.begin();
    assert.equal(f.BrowserCommands.openTab(options), "native");
    assert.equal(f.api.pending, false);
    assert.equal(f.calls.find(item => item.kind === "native-new").options, options);
  }
});
test("blur, workspace switch and tab switch cancel without applying draft text to another page", () => {
  for (const kind of ["blur", "workspace", "tab", "window-blur"]) {
    const f = fixture(); f.api.begin();
    if (kind === "blur") { f.document.activeElement = {}; f.urlbar.emit("focusout"); f.flush(); }
    if (kind === "workspace") f.workspace("other");
    if (kind === "tab") f.gBrowser.selectedTab = f.makeTab("https://other.example/");
    if (kind === "window-blur") f.window.emit("blur");
    assert.equal(f.api.pending, false, kind);
    assert.equal(f.original.linkedBrowser.userTypedValue, null, kind);
    assert.equal(f.calls.some(item => item.kind === "add"), false, kind);
  }
});
test("same-command blur cannot cancel a synchronous native suggestion commit", () => {
  const f = fixture(); f.api.begin();
  f.document.activeElement = {}; f.urlbar.emit("focusout");
  f.enter(); f.flush();
  assert.equal(f.gBrowser.tabs.length, 2); assert.equal(f.api.pending, false);
});
test("late fallback results are dropped after Escape, replacement draft, edited query or changed source", async () => {
  for (const mutation of ["escape", "replacement", "input", "navigate", "workspace", "tab-close"]) {
    const f = fixture(); let resolve;
    f.fallback(() => new Promise(done => { resolve = done; })); f.api.begin();
    const promise = f.controller.resolveFallbackNavigation({ searchString: "old query" });
    if (mutation === "escape") f.escape();
    if (mutation === "replacement") { f.api.cancel(); f.api.begin(); }
    if (mutation === "input") f.urlbar.emit("input");
    if (mutation === "navigate") { f.original.linkedBrowser.currentURI.spec = "https://new.example/"; f.original.linkedBrowser.lastLocationChange++; }
    if (mutation === "workspace") f.workspace("other");
    if (mutation === "tab-close") { f.original.closing = true; f.gBrowser.tabContainer.emit("TabClose", { target: f.original }); }
    resolve({ heuristicResult: { url: "https://late.example/" } });
    assert.equal(Object.keys(await promise).length, 0, mutation);
    assert.equal(f.calls.some(item => item.kind === "load" || item.kind === "add"), false, mutation);
  }
});
test("an ordinary pending address fallback cannot become a replacement draft's navigation", async () => {
  for (const cancelAgain of [false, true]) {
    const f = fixture(); let resolve;
    f.fallback(() => new Promise(done => { resolve = done; }));
    const promise = f.controller.resolveFallbackNavigation({ searchString: "ordinary old address" });
    f.api.begin(); if (cancelAgain) f.api.cancel();
    resolve({ fixup: { url: "https://stale.example/" } });
    assert.equal(Object.keys(await promise).length, 0);
    assert.equal(f.gBrowser.tabs.length, 1);
  }
});
test("confirmed and preview search modes restore synchronously without a delayed setter clobbering another draft", () => {
  for (const commit of [false, true]) {
    const f = fixture(), browser = f.original.linkedBrowser;
    const modes = { confirmed: { engineName: "Source engine", isPreview: false, entry: "oneoff" },
      preview: { source: 3, isPreview: true } };
    f.urlbar.getBrowserState(browser).searchModes = modes;
    browser.userTypedValue = "original query";
    f.api.begin(); f.urlbar.value = "new draft query";
    if (commit) f.enter(); else f.api.cancel();
    assert.equal(JSON.stringify(f.urlbar.getBrowserState(browser).searchModes), JSON.stringify(modes));
    assert.equal(browser.userTypedValue, "original query");
    assert.equal(f.calls.some(call => call.kind === "set-search-mode"), false);
    if (!commit) {
      assert.equal(f.urlbar.paintedMode.source, 3);
      f.api.begin(); f.urlbar.value = "replacement"; f.flush();
      assert.equal(f.urlbar.value, "replacement");
    }
  }
});
test("empty drafts do not create tabs, and Cmd-L returns to ordinary native address editing", () => {
  const f = fixture(); f.api.begin();
  f.window.emit("keydown", { key: "Enter", isTrusted: true });
  assert.equal(f.api.pending, true); assert.equal(f.gBrowser.tabs.length, 1);
  f.window.emit("keydown", { key: "l", metaKey: true, isTrusted: true,
    preventDefault() { throw new Error("Must retain native Cmd-L action"); } });
  assert.equal(f.api.pending, false); assert.equal(f.controller.whereToOpen(), "current");
  const details = { url: "https://ordinary.example/", where: "current", params: {}, browserId: 1 };
  f.controller.loadURL(details);
  assert.equal(f.calls.find(call => call.kind === "load").details, details);
  assert.equal(f.gBrowser.tabs.length, 1);
});
test("stale target browser and in-place page navigation cannot redirect a draft into another tab", () => {
  const f = fixture(); f.api.begin();
  f.controller.loadURL({ url: "https://unwanted.example/", where: "current", params: {}, browserId: 999 });
  assert.equal(f.api.pending, false); assert.equal(f.gBrowser.tabs.length, 1);
  assert.equal(f.calls.some(item => item.kind === "load"), false);
  f.api.begin(); f.original.linkedBrowser.lastLocationChange++; f.original.linkedBrowser.userTypedValue = "new page state";
  f.enter();
  assert.equal(f.gBrowser.tabs.length, 1); assert.equal(f.original.linkedBrowser.userTypedValue, "new page state");
  for (const name of ["openSERP", "openSearchForm"]) {
    const other = fixture(); other.api.begin();
    other.controller[name](...(name === "openSERP" ? ["engine", "query", "tab", false, 999] : ["engine", "tab", false, 999]));
    assert.equal(other.gBrowser.tabs.length, 1); assert.equal(other.api.pending, false);
    assert.equal(other.calls.some(call => call.kind === "search" || call.kind === "form"), false);
  }
});
test("ordinary navigation without a draft passes through; unload restores owned hooks only", async () => {
  const f = fixture();
  assert.equal(f.controller.whereToOpen(), "current");
  const details = { url: "https://ordinary.example/", where: "current", params: {}, browserId: 1 };
  f.controller.loadURL(details); assert.equal(f.calls.find(item => item.kind === "load").details, details);
  assert.ok((await f.controller.resolveFallbackNavigation({})).heuristicResult);
  const api = f.api; f.api.begin(); f.run(); assert.equal(f.api, api);
  const laterWrapper = () => "another feature"; f.controller.whereToOpen = laterWrapper;
  f.window.emit("unload");
  assert.equal(f.window.FluxionNewTab, undefined);
  assert.equal(f.controller.whereToOpen, laterWrapper);
  assert.equal(f.controller.loadURL, f.originals.loadURL);
  assert.equal(f.BrowserCommands.openTab, f.originalOpenTab);
  assert.equal(f.window.listenerCount() + f.urlbar.listenerCount() + f.gBrowser.tabContainer.listenerCount(), 0);
  assert.equal(api.begin(), null); assert.equal(f.gBrowser.tabs.length, 1);
});
test("unsupported address controllers leave native commands intact", () => {
  const f = fixture({ missing: "openSearchForm" });
  assert.equal(f.api, undefined); assert.equal(f.BrowserCommands.openTab, f.originalOpenTab);
});
