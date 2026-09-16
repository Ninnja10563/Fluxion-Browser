"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(require.resolve("../chrome/fluxion-containers.js"), "utf8");

test("container startup default never changes a saved or locked opt-out", () => {
  const runtime = fs.readFileSync(require.resolve("../runtime/fluxion.cfg"), "utf8");
  const name = "privacy.userContext.enabled";
  const start = runtime.indexOf(`  if (!Services.prefs.prefIsLocked("${name}")) {`);
  assert.ok(start > 0);
  const statement = runtime.slice(start, runtime.indexOf("\n  }", start) + 4);
  for (const locked of [false, true]) for (const saved of [undefined, false]) {
    let defaultValue = false, writes = 0;
    const prefs = { prefIsLocked: key => { assert.equal(key, name); return locked; },
      getDefaultBranch: prefix => { assert.equal(prefix, ""); return { setBoolPref(key, value) {
        assert.equal(key, name); defaultValue = value; writes++;
      } }; } };
    vm.runInNewContext(statement, { Services: { prefs } });
    assert.equal(writes, locked ? 0 : 1);
    assert.equal(saved ?? defaultValue, saved === false || locked ? false : true);
  }
});

function fixture() {
  const observers = new Map(), prefObservers = new Map(), created = [], alerts = [], nodes = [];
  class Node {
    constructor(tag) { this.localName = tag; this.attrs = new Map(); this.listeners = new Map(); this.children = []; nodes.push(this); }
    setAttribute(key, value) { this.attrs.set(key, value); }
    getAttribute(key) { return this.attrs.get(key) || ""; }
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
    insertBefore(child, reference) {
      if (reference == null) return this.appendChild(child);
      const index = this.children.indexOf(reference);
      assert.ok(index >= 0, "insertBefore reference must belong to the menu");
      child.parentNode = this; this.children.splice(index, 0, child); return child;
    }
    replaceChildren() { this.children = []; }
    remove() { this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.parentNode = null; }
    addEventListener(type, callback) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(callback); }
    removeEventListener(type, callback) { this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item !== callback)); }
    emit(type) { for (const callback of this.listeners.get(type) || []) callback({ target: this }); }
  }
  const root = new Node("menupopup"), window = new Node("window");
  const originalCommands = ["Duplicate Tab", "Reload Tab", "Pin Tab"].map(label => {
    const item = new Node("menuitem"); item.setAttribute("label", label); root.appendChild(item); return item;
  });
  const document = { getElementById: id => id === "fluxion-tab-context" ? root : null, createXULElement: tag => new Node(tag) };
  let enabled = true, privateWindow = false, policy = {}, identityList = [
    { userContextId: 1, public: true, name: "Personal", icon: "circle", color: "blue" },
    { userContextId: 2, public: true, name: "Work", icon: "briefcase", color: "orange" },
  ];
  function tab(url, workspace = "focus", userContextId = 0) {
    const value = new Node("tab");
    Object.assign(value, { ownerGlobal: window, parentNode: {}, linkedPanel: "panel", workspace, _tPos: 0,
      linkedBrowser: { currentURI: { spec: url }, contentPrincipal: { isContentPrincipal: true, origin: url, originAttributes: { userContextId } } },
      toggleMuteAudio() { this.muted = !this.muted; } });
    if (userContextId) value.setAttribute("usercontextid", String(userContextId));
    return value;
  }
  const tabs = [tab("https://example.test/one"), tab("https://example.test/two"), tab("https://other.test/")];
  let context = tabs.slice(0, 2);
  const browser = { tabs, selectedTab: tabs[0], addTab(url, options) {
    const value = tab(url, "focus", options.userContextId);
    value.pinned = options.pinned; tabs.push(value); created.push({ tab: value, url, options }); return value;
  } };
  Object.assign(window, { document, gBrowser: browser, FluxionUI: {
    contextTabs: () => context, tabWorkspace: value => value.workspace, workspaces: () => [{ id: "focus" }, { id: "other" }],
    setTabWorkspace: (value, workspace) => { value.workspace = workspace; },
    withWorkspaceReconciliationPaused: action => action(), reconcileTransferredTabs() {},
  } });
  const identities = { getPublicIdentities: () => structuredClone(identityList.filter(value => value.public)),
    getPublicIdentityFromId: id => structuredClone(identityList.find(value => value.public && value.userContextId === id)),
    getUserContextLabel: id => identityList.find(value => value.userContextId === id).name };
  const Services = { prefs: { getBoolPref: () => enabled, addObserver: (key, value) => prefObservers.set(key, value), removeObserver: key => prefObservers.delete(key) },
    obs: { addObserver: (value, key) => observers.set(key, value), removeObserver: (_, key) => observers.delete(key) },
    policies: { getActivePolicies: () => policy }, prompt: { alert: (...args) => alerts.push(args) },
    scriptSecurityManager: { createNullPrincipal: attributes => ({ isNullPrincipal: true, originAttributes: attributes }),
      principalWithOA: (principal, attributes) => ({ ...principal, originAttributes: attributes }) } };
  const sandbox = { window, Services, Cu: { reportError() {} }, SessionStore: { getTabState: value => value.state },
    ChromeUtils: { importESModule: path => path.includes("ContextualIdentityService") ? { ContextualIdentityService: identities } :
      path.includes("PrivateBrowsingUtils") ? { PrivateBrowsingUtils: { isWindowPrivate: () => privateWindow } } :
      { E10SUtils: { deserializePrincipal: value => JSON.parse(value) } } } };
  vm.runInNewContext(source, sandbox);
  const menu = root.children.find(node => node.getAttribute("id") === "fluxion-container-menu"), popup = menu.children[0];
  return { window, root, menu, popup, originalCommands, tabs, browser, created, alerts, observers, prefObservers, api: window.FluxionContainers,
    show() { root.emit("popupshowing"); popup.emit("popupshowing"); }, context: value => { context = value; },
    identities: () => identityList, enabled: value => { enabled = value; }, private: value => { privateWindow = value; }, policy: value => { policy = value; } };
}

test("container account-copy action follows Duplicate without replacing or reordering native commands", () => {
  const f = fixture();
  assert.deepEqual(f.root.children.map(item => item.getAttribute("label")),
    ["Duplicate Tab", "Open in Container", "Reload Tab", "Pin Tab"]);
  assert.equal(f.root.children[0], f.originalCommands[0]);
  assert.equal(f.root.children[0].localName, "menuitem");
  assert.deepEqual(f.root.children.filter(item => item !== f.menu), f.originalCommands);
  f.show();
  assert.equal(f.menu.hidden, false);
  assert.equal(f.popup.children.length, 2);
  f.window.emit("unload");
  assert.deepEqual(f.root.children, f.originalCommands);
});

test("container menu uses public Gecko identities and frozen multi-selection, opens fresh same-workspace URLs without removing originals", () => {
  const f = fixture(); f.tabs[0].workspace = "other"; f.tabs[0].pinned = true; f.tabs[0].muted = true;
  f.tabs[0].documentGlobal = f.window; delete f.tabs[0].ownerGlobal;
  f.identities().push({ userContextId: 999, public: false, name: "Internal" });
  f.show();
  assert.equal(f.menu.getAttribute("label"), "Open 2 Tabs in Container");
  assert.deepEqual(f.popup.children.map(item => item.getAttribute("label")), ["Personal", "Work"]);
  f.context([f.tabs[2]]); f.popup.children[1].emit("command");
  assert.deepEqual(f.created.map(value => value.url), ["https://example.test/one", "https://example.test/two"]);
  assert.deepEqual(f.created.map(value => value.tab.workspace), ["other", "focus"]);
  assert.ok(f.tabs.slice(0, 3).every(value => value.parentNode));
  assert.equal(f.created[0].options.userContextId, 2);
  assert.equal(f.created[0].options.triggeringPrincipal.originAttributes.userContextId, 2);
  assert.equal(f.created[0].options.triggeringPrincipal.origin, "https://example.test/one");
  assert.equal(f.created[0].options.pinned, true); assert.equal(f.created[0].tab.muted, true);
  assert.equal(f.browser.selectedTab, f.created[0].tab);
  assert.deepEqual(Object.keys(f.created[0].options).sort(), ["pinned", "tabIndex", "triggeringPrincipal", "userContextId"]);
});

test("private windows, disabled preferences and enterprise-disabled containers cannot open from stale menus", () => {
  for (const deny of [f => f.private(true), f => f.enabled(false), f => f.policy({ Containers: { Enabled: false } })]) {
    const f = fixture(); f.show(); const item = f.popup.children[0]; deny(f); item.emit("command");
    assert.equal(f.created.length, 0); f.show(); assert.equal(f.menu.hidden, true);
  }
});

test("navigated, closed, moved or container-changed source tabs invalidate the complete batch", () => {
  for (const mutate of [f => { f.tabs[1].linkedBrowser.currentURI.spec = "https://changed.test"; },
    f => { f.tabs[1].closing = true; }, f => { f.tabs[1].workspace = "other"; },
    f => { f.tabs[1].setAttribute("usercontextid", "2"); }]) {
    const f = fixture(); f.show(); mutate(f); f.popup.children[0].emit("command"); assert.equal(f.created.length, 0);
  }
});

test("deleted/recreated identity, renamed identity, hidden popup and unloaded windows cannot revive an old action", () => {
  for (const mutate of [f => f.observers.get("contextual-identity-deleted").observe(),
    f => { f.identities()[0].name = "Renamed"; }, f => f.root.emit("popuphidden"), f => f.window.emit("unload")]) {
    const f = fixture(); f.show(); const item = f.popup.children[0]; mutate(f); item.emit("command"); assert.equal(f.created.length, 0);
  }
  const f = fixture(), snapshot = f.api.capture(f.tabs.slice(0, 1));
  f.observers.get("contextual-identity-deleted").observe();
  assert.equal(f.api.open(snapshot, 1).length, 0);
});

test("same-container entries are disabled while mixed batches only open different identities", () => {
  const f = fixture(); f.tabs[0].setAttribute("usercontextid", "1"); f.context([f.tabs[0]]); f.show();
  assert.equal(f.popup.children[0].getAttribute("disabled"), "true");
  f.popup.children[0].emit("command"); assert.equal(f.created.length, 0);
  f.context(f.tabs.slice(0, 2)); f.show(); f.popup.children[0].emit("command");
  assert.equal(f.created.length, 1); assert.equal(f.created[0].url, "https://example.test/two");
});

test("lazy tabs deserialize only the principal and malformed state fails before any batch creation", () => {
  const f = fixture(); f.tabs[0].linkedPanel = null;
  f.tabs[0].state = JSON.stringify({ triggeringPrincipal_base64: JSON.stringify({ isNullPrincipal: true }), formdata: { secret: "not copied" } });
  f.show(); f.popup.children[0].emit("command");
  assert.equal(f.created[0].options.triggeringPrincipal.isNullPrincipal, true);
  assert.equal(f.created[0].options.triggeringPrincipal.originAttributes.userContextId, 1);
  const broken = fixture(); broken.tabs[1].linkedPanel = null; broken.tabs[1].state = "not-json";
  broken.show(); broken.popup.children[0].emit("command");
  assert.equal(broken.created.length, 0); assert.equal(broken.alerts.length, 1);
  broken.window.emit("unload"); assert.equal(broken.observers.size, 0); assert.equal(broken.prefObservers.size, 0);
});
