"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const script = fs.readFileSync(path.join(__dirname, "../chrome/fluxion-tab-transfer.js"), "utf8");

function fixture({ newTabURL = "about:newtab" } = {}) {
  const windows = [], calls = [], errors = [];
  function createWindow(isPrivate = false) {
    const listeners = new Set();
    const window = { closed: false, isPrivate, setTimeout, gBrowserInit: { delayedStartupFinished: true } };
    window.focus = () => calls.push(["focus", window]);
    windows.push(window);
    const reindex = () => window.gBrowser.tabs.forEach((tab, index) => { tab._tPos = index; });
    function addTab(url = "https://example.test/") {
      const attrs = new Map([["fluxion-workspace", "a"]]);
      const tab = { ownerGlobal: window, parentNode: {}, pinned: false,
        get isOpen() { return !!this.parentNode && !this.closing; }, hidden: false, linkedBrowser: {
        currentURI: { spec: url }, browsingContext: { currentWindowGlobal: { nonce: {} }, sessionHistory: { count: 1 } },
      }, setAttribute: (key, value) => attrs.set(key, value), getAttribute: key => attrs.get(key) || "",
      hasAttribute: key => attrs.has(key), removeAttribute: key => attrs.delete(key) };
      window.gBrowser.tabs.push(tab); reindex();
      window.gBrowser.selectedTab ||= tab;
      return tab;
    }
    window.gBrowser = { tabs: [], tabContainer: { addEventListener: (_type, fn) => listeners.add(fn), removeEventListener: (_type, fn) => listeners.delete(fn) },
      get pinnedTabCount() { return this.tabs.filter(tab => tab.pinned).length; },
      addTrustedTab(url, options) {
        calls.push(["blank", window, url, options]);
        const tab = addTab(url); tab.hidden = !!window.hideAddedAnchor; return tab;
      },
      showTab(tab) { tab.hidden = false; calls.push(["show", tab]); },
      removeTab(tab, options) {
        calls.push(["remove", tab, options]); this.tabs = this.tabs.filter(item => item !== tab); tab.parentNode = null; reindex();
      },
      pinTab: tab => { tab.pinned = true; }, unpinTab: tab => { tab.pinned = false; }, ungroupTab: tab => { tab.group = null; },
      ungroupSplitView(split) { calls.push(["ungroupSplit", split]); split.tabs.forEach(tab => { tab.group = null; }); },
      adoptTab(old, options) {
        calls.push(["tab", old, options]);
        if (window.failTab === old) return null;
        const tab = addTab();
        // Native TabOpen precedes SessionStore's swap, including custom values.
        for (const listener of listeners) listener({ target: tab, detail: { adoptedTab: old } });
        tab.linkedBrowser = old.linkedBrowser;
        tab.setAttribute("fluxion-workspace", old.getAttribute("fluxion-workspace"));
        tab.setAttribute("fluxion-workspace-active", "true");
        if (old.ownerGlobal.closeOnLastVisible && !old.ownerGlobal.gBrowser.tabs.some(other =>
          other !== old && other.isOpen && !other.hidden)) old.ownerGlobal.closed = true;
        old.ownerGlobal.gBrowser.tabs = old.ownerGlobal.gBrowser.tabs.filter(item => item !== old);
        old.parentNode = null;
        window.afterAdopt?.(old, tab);
        return tab;
      },
      adoptSplitView(split, options) {
        calls.push(["split", split, options]);
        const tabs = split.tabs.map(old => this.adoptTab(old, options));
        if (tabs.some(tab => !tab)) throw new Error("partial native split failure");
        const adopted = makeSplit(tabs, split.splitViewId);
        if (window.insertionGroup) tabs.forEach(tab => { tab.group = window.insertionGroup; });
        return adopted;
      },
      adoptTabGroup(group, options) {
        calls.push(["group", group, options]);
        const tabs = group.tabs.map(old => this.adoptTab(old, options));
        if (tabs.some(tab => !tab)) throw new Error("partial native group failure");
        return makeGroup(tabs, group.id);
      },
    };
    window.FluxionUI = { currentWorkspace: () => window.workspace || "a", workspaces: () => [{ id: "a" }, { id: "b" }],
      withWorkspaceReconciliationPaused(callback) { window.paused = true; try { return callback(); } finally { window.paused = false; } },
      setTabWorkspace(tab, id) { tab.setAttribute("fluxion-workspace", id); return id; },
      splitOrientation: tab => tab.orientation || "stacked", setSplitOrientation: (tab, value) => { tab.orientation = value; },
      selectTab(tab) { window.gBrowser.selectedTab = tab; window.workspace = tab.getAttribute("fluxion-workspace"); },
      reconcileTransferredTabs() { calls.push(["reconcile", window]); },
    };
    window.OpenBrowserWindow = options => {
      calls.push(["window", options]);
      const target = createWindow(options.private); target.addTab(options.args?.data || "https://homepage.example/");
      window.onNewWindow?.(target); return target;
    };
    window.addTab = addTab;
    return window;
  }
  function makeSplit(tabs, splitViewId = "native-split") {
    const split = { tabs, splitViewId }; tabs.forEach(tab => { tab.splitview = split; }); return split;
  }
  function makeGroup(tabs, id = "native-group") {
    const group = { tabs, id, label: "Research", color: "blue", collapsed: true };
    tabs.forEach(tab => { tab.group = group; }); return group;
  }
  const source = createWindow(), target = createWindow();
  source.addTab(); target.addTab("about:blank");
  vm.runInNewContext(script, { window: source, ChromeUtils: { importESModule: () => ({ PrivateBrowsingUtils: { isWindowPrivate: win => win.isPrivate } }) },
    Services: { wm: { getEnumerator: () => windows }, prefs: { getStringPref: (key, fallback) => key === "fluxion.newtab.url" ? newTabURL : fallback } },
    SessionStore: { getCustomTabValue: (tab, key) => tab.getAttribute(key), deleteCustomTabValue: (tab, key) => tab.removeAttribute(key) },
    Cu: { reportError: error => errors.push(error) },
    Cc: { "@mozilla.org/supports-string;1": { createInstance: () => ({ data: "" }) } }, Ci: { nsISupportsString: {} },
  });
  return { source, target, api: source.FluxionTabTransfer, createWindow, calls, errors, makeSplit, makeGroup };
}

test("native adoption preserves the live browser, pin and workspace while keeping a last-tab source alive", async () => {
  const f = fixture(), old = f.source.gBrowser.tabs[0], browser = old.linkedBrowser;
  old.pinned = true;
  const result = await f.api.move([old], f.target, { workspaceId: "b", selectTab: old });
  assert.equal(result.complete, true); assert.equal(result.tabs.length, 1);
  const moved = result.tabs[0];
  assert.notEqual(moved, old); assert.equal(moved.linkedBrowser, browser);
  assert.equal(moved.pinned, true); assert.equal(moved.getAttribute("fluxion-workspace"), "b");
  assert.equal(moved.hasAttribute("fluxion-workspace-active"), false);
  assert.equal(f.target.gBrowser.selectedTab, moved);
  assert.equal(f.source.gBrowser.tabs.length, 1);
  assert.equal(f.source.gBrowser.tabs[0].linkedBrowser.currentURI.spec, "about:newtab");
  assert.equal(f.calls.some(([kind]) => kind === "remove"), false);
  assert.equal(f.calls.filter(([kind]) => kind === "focus").length, 1);
  assert.ok(f.calls.find(([kind]) => kind === "focus")[1] === f.target);
});

test("private, stale, foreign and Peek inputs are rejected before native writes", async () => {
  for (const corrupt of [f => { f.target.isPrivate = true; }, f => { f.target.closed = true; },
    f => { f.source.gBrowser.tabs[0].setAttribute("fluxion-peek", "true"); },
    f => { f.source.gBrowser.tabs[0].parentNode = null; }]) {
    const f = fixture(), tab = f.source.gBrowser.tabs[0]; corrupt(f);
    const result = await f.api.move([tab], f.target);
    assert.equal(result.complete, false); assert.equal(f.calls.length, 0);
  }
  const f = fixture();
  assert.equal(f.api.eligibility([{ ...f.source.gBrowser.tabs[0] }], f.target).allowed, false);
  const forged = { splitview: { tabs: f.source.gBrowser.tabs } };
  assert.equal(f.api.eligibility([forged], f.target).allowed, false);
  assert.equal((await f.api.detach([forged])).complete, false);
  assert.equal(f.calls.length, 0);
  assert.equal(f.api.eligibility(f.source.gBrowser.tabs, f.target, { targetTab: f.source.gBrowser.tabs[0] }).allowed, false);
});

test("whole groups and split closure use native container adoption and preserve IDs", async () => {
  for (const kind of ["group", "split"]) {
    const f = fixture(), a = f.source.gBrowser.tabs[0], b = f.source.addTab();
    const container = kind === "group" ? f.makeGroup([a, b]) : f.makeSplit([a, b]);
    const result = await f.api.move(kind === "group" ? [a, b] : [a], f.target, { selectTab: b });
    assert.equal(result.complete, true); assert.equal(result.tabs.length, 2);
    assert.equal(result.selectedTab, result.tabs[1]);
    assert.equal(f.calls.filter(call => call[0] === kind).length, 1);
    if (kind === "group") {
      assert.equal(result.tabs[0].group.id, container.id); assert.equal(result.tabs[0].group.collapsed, true);
    } else {
      assert.equal(result.tabs[0].splitview.splitViewId, container.splitViewId);
      assert.equal(result.tabs[0].orientation, "stacked");
    }
  }
});

test("partial group failure reports adopted live nodes and leaves surviving source tabs untouched", async () => {
  const f = fixture(), a = f.source.gBrowser.tabs[0], b = f.source.addTab();
  f.makeGroup([a, b]); f.target.failTab = b;
  const result = await f.api.move([a, b], f.target, { workspaceId: "b" });
  assert.equal(result.complete, false); assert.match(result.error, /partial native group/);
  assert.equal(result.tabs.length, 1); assert.equal(result.tabs[0].getAttribute("fluxion-workspace"), "b");
  assert.ok(f.source.gBrowser.tabs.includes(b)); assert.ok(b.parentNode);
  assert.equal(f.calls.some(([kind]) => kind === "remove"), false);
  assert.equal(f.calls.some(([kind]) => kind === "focus"), false);
});

test("detach uses native window startup, revalidates source and removes only untouched empty destination tab", async () => {
  const f = fixture(), tab = f.source.gBrowser.tabs[0];
  const result = await f.api.detach([tab], { selectedTab: tab });
  assert.equal(result.complete, true); assert.ok(result.window !== f.source);
  const removal = f.calls.find(([kind]) => kind === "remove")[2];
  assert.equal(removal.skipSessionStore, true); assert.equal(removal.animate, false);
  assert.equal(result.window.gBrowser.tabs.length, 1);
  const changed = fixture();
  changed.source.onNewWindow = target => { target.gBrowser.tabs[0].linkedBrowser.currentURI.spec = "https://keep.example/"; };
  const moved = await changed.api.detach(changed.source.gBrowser.tabs);
  assert.equal(moved.complete, true); assert.equal(moved.window.gBrowser.tabs.length, 2);
  const stale = fixture();
  stale.source.onNewWindow = () => { stale.source.gBrowser.tabs[0].closing = true; };
  assert.equal((await stale.api.detach(stale.source.gBrowser.tabs)).complete, false);
  assert.equal(stale.calls.some(([kind]) => kind === "tab"), false);
});

test("background group transfers preserve destination selection and collapsed state", async () => {
  const f = fixture(), a = f.source.gBrowser.tabs[0], b = f.source.addTab();
  const selected = f.target.gBrowser.selectedTab;
  f.makeGroup([a, b]);
  const result = await f.api.move([a, b], f.target, { selectTab: false });
  assert.equal(result.complete, true);
  assert.ok(f.target.gBrowser.selectedTab === selected);
  assert.equal(result.tabs[0].group.collapsed, true);
  assert.equal(f.calls.find(([kind]) => kind === "group")[2].selectTab, false);
  assert.equal(f.calls.some(([kind]) => kind === "focus"), false);
});

test("partial selection leaves the source group intact and preserves original workspaces by default", async () => {
  const f = fixture(), a = f.source.gBrowser.tabs[0], b = f.source.addTab();
  const group = f.makeGroup([a, b]);
  a.setAttribute("fluxion-workspace", "b");
  const result = await f.api.move([a], f.target);
  assert.equal(result.complete, true); assert.equal(result.tabs[0].getAttribute("fluxion-workspace"), "b");
  assert.ok(!result.tabs[0].group); assert.ok(b.group === group);
  assert.equal(f.calls.some(([kind]) => kind === "group" || kind === "blank"), false);
});

test("moving the last visible tab retains a real source anchor and hidden workspace pages", async () => {
  const f = fixture(), moving = f.source.gBrowser.tabs[0], hidden = f.source.addTab("https://keep-hidden.example/");
  hidden.hidden = true; hidden.setAttribute("fluxion-workspace", "b");
  f.source.closeOnLastVisible = true;
  f.source.hideAddedAnchor = true;
  const result = await f.api.move([moving], f.target);
  assert.equal(result.complete, true); assert.equal(f.source.closed, false);
  assert.ok(f.source.gBrowser.tabs.includes(hidden));
  assert.equal(hidden.linkedBrowser.currentURI.spec, "https://keep-hidden.example/");
  const anchor = f.calls.find(([kind]) => kind === "blank");
  assert.ok(anchor); assert.equal(anchor[3].tabIndex, 0); assert.equal(anchor[3].skipAnimation, true);
  assert.equal(f.calls.filter(([kind]) => kind === "show").length, 1);
  assert.equal(f.source.gBrowser.tabs.filter(tab => tab.isOpen && !tab.hidden).length, 1);
});

test("a destination closed during adoption returns surviving results without selecting a dead node", async () => {
  const f = fixture(), tab = f.source.gBrowser.tabs[0];
  f.target.afterAdopt = () => { f.target.closed = true; f.target.gBrowser = null; };
  const result = await f.api.move([tab], f.target);
  assert.equal(result.complete, false); assert.equal(result.tabs.length, 0);
  assert.equal(result.selectedTab, null);
});

test("unknown workspaces and stale target tabs are rejected without creating a source anchor", async () => {
  const f = fixture(), tab = f.source.gBrowser.tabs[0];
  assert.equal((await f.api.move([tab], f.target, { workspaceId: "deleted" })).complete, false);
  assert.equal(f.calls.length, 0);
  const target = f.target.gBrowser.tabs[0]; target.closing = true;
  assert.equal((await f.api.move([tab], f.target, { targetTab: target })).complete, false);
  assert.equal(f.calls.length, 0);
});

test("a split inserted beside a grouped tab is ungrouped as an intact native wrapper", async () => {
  const f = fixture(), a = f.source.gBrowser.tabs[0], b = f.source.addTab();
  const split = f.makeSplit([a, b]);
  const targetTab = f.target.gBrowser.tabs[0];
  f.target.insertionGroup = f.makeGroup([targetTab]);
  f.target.gBrowser.ungroupTab = () => { throw new Error("Individual ungrouping would dismantle the split"); };
  const result = await f.api.move([a], f.target, { targetTab, position: "after" });
  assert.equal(result.complete, true); assert.equal(result.tabs.length, 2);
  assert.ok(result.tabs[0].splitview === result.tabs[1].splitview);
  assert.equal(result.tabs[0].splitview.splitViewId, split.splitViewId);
  assert.ok(result.tabs.every(tab => !tab.group));
  assert.equal(f.calls.filter(([kind]) => kind === "ungroupSplit").length, 1);
});

test("missing grouped-split ungroup capability is rejected before adoption", async () => {
  const f = fixture(), a = f.source.gBrowser.tabs[0], b = f.source.addTab();
  f.makeSplit([a, b]);
  const targetTab = f.target.gBrowser.tabs[0]; f.makeGroup([targetTab]);
  delete f.target.gBrowser.ungroupSplitView;
  assert.equal((await f.api.move([a], f.target, { targetTab })).complete, false);
  assert.equal(f.calls.length, 0);
});

test("detach explicitly opens blank and preserves any changed page, history or document", async () => {
  const newTabURL = "file:///Applications/Fluxion.app/Contents/Resources/fluxion/newtab/index.html";
  for (const change of ["unchanged", "zero-history", "unknown-history", "no-document", "address-draft", "navigation", "same-url-history", "same-url-document", "homepage", "configured-newtab"]) {
    const f = fixture({ newTabURL });
    f.source.onNewWindow = target => {
      const initial = target.gBrowser.tabs[0];
      if (change === "homepage") initial.linkedBrowser.currentURI.spec = "https://homepage.example/";
      if (change === "configured-newtab") initial.linkedBrowser.currentURI.spec = newTabURL;
      if (change === "zero-history") initial.linkedBrowser.browsingContext.sessionHistory.count = 0;
      if (change === "unknown-history") delete initial.linkedBrowser.browsingContext.sessionHistory;
      if (change === "no-document") initial.linkedBrowser.browsingContext.currentWindowGlobal = null;
      if (change === "address-draft") initial.linkedBrowser.userTypedValue = "keep this unfinished address";
      target.afterAdopt = () => {
        if (change === "navigation") initial.linkedBrowser.currentURI.spec = "https://keep.example/";
        if (change === "same-url-history") initial.linkedBrowser.browsingContext.sessionHistory.count = 2;
        if (change === "same-url-document") initial.linkedBrowser.browsingContext.currentWindowGlobal = {};
      };
    };
    const result = await f.api.detach(f.source.gBrowser.tabs);
    assert.equal(result.complete, true, change);
    assert.equal(f.calls.find(([kind]) => kind === "window")[1].args.data, "about:blank");
    const pristine = change === "unchanged" || change === "zero-history";
    assert.equal(result.window.gBrowser.tabs.length, pristine ? 1 : 2, change);
    assert.equal(f.calls.some(([kind]) => kind === "remove"), pristine, change);
  }
});
