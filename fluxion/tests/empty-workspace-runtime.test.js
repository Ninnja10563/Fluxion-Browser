"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const source = fs.readFileSync(require.resolve("../chrome/fluxion-empty-workspace.js"), "utf8");
function emitter(value = {}) {
  const listeners = new Map();
  return Object.assign(value, {
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    emit(type, event = {}) { for (const fn of [...listeners.get(type) || []]) fn({ type, ...event }); },
    count() { return [...listeners.values()].reduce((sum, set) => sum + set.size, 0); },
  });
}
function node() {
  const attrs = new Map();
  return { getAttribute: name => attrs.get(name) ?? null, hasAttribute: name => attrs.has(name),
    setAttribute: (name, value) => attrs.set(name, value), removeAttribute: name => attrs.delete(name),
    toggleAttribute(name, force) { if (force) attrs.set(name, ""); else attrs.delete(name); },
    appendChild(child) { this.child = child; }, remove() { this.removed = true; } };
}
function fixture({ marker = false, url = "about:blank", lateUI = false, os = "Darwin" } = {}) {
  const root = node(), commands = new Map(["Browser:AddBookmarkAs", "Browser:BookmarkAllTabs"].map(id => [id, Object.assign(node(), { id })]));
  const document = { documentElement: root, createElementNS: () => node(), getElementById: id => commands.get(id) };
  const tasks = [], tabs = [], removed = [], calls = [];
  let selected, progress, disposedProgress = false, current = "focus", refreshes = 0;
  const make = (spec, workspace = current, marked = false) => {
    const tab = Object.assign(node(), { parentNode: {}, closing: false, workspace,
      linkedBrowser: { currentURI: { spec } } });
    if (marked) tab.setAttribute("fluxion-empty-workspace", "true");
    tabs.push(tab); return tab;
  };
  selected = make(url, current, marker);
  const initial = selected;
  const gBrowser = {
    tabs, tabContainer: emitter(), get selectedTab() { return selected; },
    set selectedTab(tab) { selected = tab; this.tabContainer.emit("TabSelect", { target: tab }); },
    get visibleTabs() { return tabs.filter(tab => !tab.hidden && tab.parentNode); },
    getTabForBrowser: browser => tabs.find(tab => tab.linkedBrowser === browser),
    addTrustedTab(spec, options) { calls.push({ kind: "add", spec, options }); const tab = make(spec); this.tabContainer.emit("TabOpen", { target: tab }); return tab; },
    removeTab(tab, options) { removed.push({ tab, options }); tab.parentNode = null; tabs.splice(tabs.indexOf(tab), 1); this.tabContainer.emit("TabClose", { target: tab }); },
    addTabsProgressListener(listener) { progress = listener; },
    removeTabsProgressListener(listener) { disposedProgress = listener === progress; },
  };
  const places = { bookmarkPage(...args) { calls.push({ kind: "page", args }); },
    bookmarkTabs(tabs, ...args) { calls.push({ kind: "tabs", tabs, args }); } };
  const originals = { ...places };
  const browserCommands = { closeTabOrWindow(...args) { calls.push({ kind: "close", receiver: this, args }); return "native-close"; },
    tryToCloseWindow(...args) { calls.push({ kind: "close-window", args }); return "native-window"; } };
  const originalClose = browserCommands.closeTabOrWindow;
  const ui = { currentWorkspace: () => current, tabWorkspace: tab => tab.workspace,
    setTabWorkspace(tab, workspace) { tab.workspace = workspace; tab.setAttribute("fluxion-workspace", workspace); },
    refresh() { refreshes++; } };
  const window = emitter({ document, gBrowser, PlacesCommandHook: places, BrowserCommands: browserCommands, closed: false,
    queueMicrotask: fn => tasks.push(fn), ...(lateUI ? {} : { FluxionUI: ui }) });
  vm.runInNewContext(source, { window, Services: { appinfo: { OS: os }, prefs: { getStringPref: () => "resource://fluxion/newtab/index.html" } } });
  return { window, root, commands, gBrowser, initial, make, calls, removed, places, originals, tasks, browserCommands, originalClose,
    get api() { return window.FluxionEmptyWorkspace; }, get refreshes() { return refreshes; },
    progressRemoved: () => disposedProgress,
    flush() { let limit = 50; while (tasks.length && limit--) tasks.shift()(); assert.ok(limit > 0, "lifecycle must settle without a timer loop"); },
    location(tab, spec, isTopLevel = true) { tab.linkedBrowser.currentURI.spec = spec; progress.onLocationChange(tab.linkedBrowser, { isTopLevel }); },
    installUI() { window.FluxionUI = ui; },
  };
}
test("ordinary user-created blank/New Tab tabs remain visible and unmarked", () => {
  for (const url of ["about:blank", "about:newtab", "about:privatebrowsing", "resource://fluxion/newtab/index.html"]) {
    const f = fixture({ url });
    assert.equal(f.api.isPlaceholder(f.initial), false);
    assert.equal(f.root.hasAttribute("data-fluxion-empty-workspace"), false);
    assert.equal(f.commands.get("Browser:AddBookmarkAs").hasAttribute("disabled"), false);
  }
});
test("an already-empty workspace ignores Close Tab but preserves explicit Close Window", () => {
  for (const os of ["Darwin", "Linux"]) {
    const f = fixture({ marker: true, os });
    let prevented = 0, stopped = 0;
    const event = { key: "w", metaKey: os === "Darwin", ctrlKey: os !== "Darwin", altKey: false, shiftKey: false,
      preventDefault() { prevented++; }, stopImmediatePropagation() { stopped++; } };
    f.window.emit("keydown", event);
    f.window.emit("command", { ...event, target: { id: "cmd_close" } });
    assert.equal(prevented, 2); assert.equal(stopped, 2);
    f.window.emit("keydown", { ...event, shiftKey: true });
    f.window.emit("command", { ...event, target: { id: "cmd_closeWindow" } });
    assert.equal(prevented, 2, "explicit window close remains native");
    f.api.promote(f.initial);
    f.window.emit("keydown", event);
    f.window.emit("command", { ...event, target: { id: "cmd_close" } });
    assert.equal(prevented, 2, "ordinary tab close remains native");
    assert.equal(f.removed.length, 0);
  }
});
test("native private start page remains empty only when explicitly marked", () => {
  const f = fixture({ marker: true, url: "about:privatebrowsing" });
  assert.equal(f.api.isPlaceholder(f.initial), true);
  assert.equal(f.root.hasAttribute("data-fluxion-empty-workspace"), true);
});
test("native Close Tab command guards empty accelerators but preserves real-tab batches and explicit window close", () => {
  const f = fixture({ marker: true }), event = { metaKey: true };
  assert.equal(f.browserCommands.closeTabOrWindow(event), undefined);
  assert.equal(f.calls.length, 0);
  assert.equal(f.browserCommands.tryToCloseWindow(event), "native-window");
  const real = f.make("https://example.test/");
  f.gBrowser.multiSelectedTabsCount = 2;
  f.gBrowser.selectedTabs = [f.initial, real];
  assert.equal(f.browserCommands.closeTabOrWindow(event), "native-close");
  assert.equal(f.calls.at(-1).receiver, f.browserCommands);
  assert.equal(f.calls.at(-1).args[0], event);
  f.gBrowser.multiSelectedTabsCount = 0;
  f.gBrowser.selectedTab = real;
  assert.equal(f.browserCommands.closeTabOrWindow(event), "native-close");
  f.window.emit("unload");
  assert.equal(f.browserCommands.closeTabOrWindow, f.originalClose);
});
test("native-restored explicit marker paints empty before chrome UI initializes without an unsupported SessionStore API", () => {
  const f = fixture({ marker: true, lateUI: true });
  assert.equal(f.root.hasAttribute("data-fluxion-empty-workspace"), true);
  f.installUI(); f.api.adopt(f.initial);
  assert.equal(f.initial.getAttribute("fluxion-workspace"), "focus");
  assert.equal(f.api.isPlaceholder(f.initial), true);
  assert.equal(f.commands.get("Browser:AddBookmarkAs").getAttribute("disabled"), "true");
});
test("new empty workspace creation is explicitly marked and does not select or mutate an existing page", () => {
  const f = fixture({ url: "https://example.test/" });
  const backing = f.api.create("work");
  assert.equal(f.api.isPlaceholder(backing), true);
  assert.equal(backing.workspace, "work");
  assert.equal(f.gBrowser.selectedTab, f.initial);
  f.gBrowser.selectedTab = backing; f.flush();
  assert.equal(f.root.hasAttribute("data-fluxion-empty-workspace"), true);
  assert.equal(f.initial.linkedBrowser.currentURI.spec, "https://example.test/");
});
test("real selected tab retires only its own workspace backing tab without undo history", () => {
  const f = fixture({ marker: true });
  const other = f.make("about:blank", "other", true); other.hidden = true;
  const real = f.make("https://example.test/", "focus");
  f.gBrowser.tabContainer.emit("TabOpen", { target: real }); f.flush();
  assert.equal(f.removed.length, 0, "background open must not discard the selected empty browser");
  f.gBrowser.selectedTab = real; f.flush();
  assert.equal(f.removed.length, 1);
  assert.equal(f.removed[0].tab, f.initial);
  assert.equal(f.removed[0].options.skipSessionStore, true);
  assert.equal(f.removed[0].options.animate, false);
  assert.ok(other.parentNode);
  assert.equal(f.root.hasAttribute("data-fluxion-empty-workspace"), false);
});
test("real top-level navigation promotes a backing tab; subframes and initial documents do not", () => {
  const f = fixture({ marker: true });
  f.location(f.initial, "about:newtab");
  assert.equal(f.api.isPlaceholder(f.initial), true);
  f.location(f.initial, "https://subframe.example/", false);
  assert.equal(f.api.isPlaceholder(f.initial), true);
  f.location(f.initial, "https://example.test/", true);
  assert.equal(f.api.isPlaceholder(f.initial), false);
  assert.equal(f.root.hasAttribute("data-fluxion-empty-workspace"), false);
  assert.equal(f.commands.get("Browser:AddBookmarkAs").hasAttribute("disabled"), false);
  assert.equal(f.api.promote(f.initial), false);
});
test("stale restored marker cannot hide a saved real URL", () => {
  const f = fixture({ marker: true, url: "https://restored.example/" });
  assert.equal(f.api.isPlaceholder(f.initial), false);
  assert.equal(f.root.hasAttribute("data-fluxion-empty-workspace"), false);
});
test("bookmark commands exclude backing browsers but retain ordinary explicit blank pages", async () => {
  const f = fixture({ marker: true });
  await f.places.bookmarkPage(); await f.places.bookmarkTabs();
  assert.equal(f.calls.length, 0);
  const real = f.make("about:blank");
  await f.places.bookmarkTabs([f.initial, real]);
  assert.equal(f.calls.length, 1); assert.deepEqual([...f.calls[0].tabs], [real]);
  f.gBrowser.selectedTab = real;
  await f.places.bookmarkPage("native argument");
  assert.equal(f.calls[1].kind, "page"); assert.deepEqual([...f.calls[1].args], ["native argument"]);
});
test("dispose restores owned hooks and controls and prevents queued cleanup from removing tabs", () => {
  const f = fixture({ marker: true }), real = f.make("https://example.test/");
  f.gBrowser.selectedTab = real;
  const laterWrapper = () => {};
  f.places.bookmarkPage = laterWrapper;
  f.window.emit("unload"); f.flush();
  assert.equal(f.progressRemoved(), true);
  assert.equal(f.gBrowser.tabContainer.count(), 0);
  assert.equal(f.window.FluxionEmptyWorkspace, undefined);
  assert.equal(f.places.bookmarkPage, laterWrapper);
  assert.equal(f.places.bookmarkTabs, f.originals.bookmarkTabs);
  assert.equal(f.removed.length, 0);
  assert.equal(f.root.hasAttribute("data-fluxion-empty-workspace"), false);
});
test("palette excludes backing tabs and page-only commands while retaining navigation and ordinary blank tabs", () => {
  const palette = fs.readFileSync(require.resolve("../chrome/fluxion-palette.js"), "utf8");
  const backing = { placeholder: true }, blank = { label: "Explicit blank", linkedBrowser: { currentURI: { displaySpec: "about:blank" } } };
  const context = vm.createContext({
    window: { FluxionEmptyWorkspace: { isPlaceholder: tab => !!tab?.placeholder }, FluxionAI: { config: () => ({ provider: "disabled" }) } },
    gBrowser: { selectedTab: backing, selectedTabs: [backing], tabs: [backing, blank] },
    ui: { nativeCommandAvailable: () => true, developerToolsAvailable: () => true, closedTabs: () => [],
      workspaces: () => [{ id: "work", name: "Work" }], currentWorkspace: () => "work", tabWorkspace: () => "work" },
    PrivateBrowsingUtils: { isWindowPrivate: () => true }, organisationSuggestion: () => null,
    splitSource: null, pendingSplitOrientation: "side-by-side", mode: "all", tabSearchItems: new WeakMap(),
  });
  vm.runInContext(palette.slice(palette.indexOf("  function commandItems()"), palette.indexOf("  function workspaceItems()")), context);
  const labels = [...context.commandItems()].map(item => item.label);
  for (const label of ["Duplicate current tab", "Close current tab", "New tab group", "Ask Current Page", "Find in Page", "Print", "Open split side by side", "Developer Tools"])
    assert.equal(labels.includes(label), false, label);
  for (const label of ["New tab", "New window", "Open settings", "Toggle Full Screen", "Extensions & Themes"])
    assert.equal(labels.includes(label), true, label);
  assert.deepEqual([...context.tabItems()].map(item => item.label), ["Explicit blank"]);
  context.gBrowser.selectedTab = blank;
  assert.ok([...context.commandItems()].some(item => item.label === "Duplicate current tab"));
});
