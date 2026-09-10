"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = name => fs.readFileSync(path.join(__dirname, "../chrome", name), "utf8");
const scripts = ["core/tab-transfer-drag.js", "core/tab-drop.js", "core/tab-selection.js", "fluxion-tab-transfer.js", "fluxion-window-tabs.js"].map(source);
const flush = () => new Promise(resolve => setImmediate(resolve));

class Node {
  constructor(localName, doc) { this.localName = localName; this.ownerDocument = doc; this.children = []; this.attrs = new Map(); this.dataset = {}; this.listeners = new Map(); this.nodeType = 1; }
  setAttribute(key, value) { this.attrs.set(key, String(value)); if (key.startsWith("data-")) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(value); }
  getAttribute(key) { return this.attrs.get(key) || ""; }
  hasAttribute(key) { return this.attrs.has(key); }
  removeAttribute(key) { this.attrs.delete(key); if (key.startsWith("data-")) delete this.dataset[key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())]; }
  appendChild(node) { return this.insertBefore(node, null); }
  insertBefore(node, before) { node.remove(); node.parentNode = this; const index = before ? this.children.indexOf(before) : -1; this.children.splice(index < 0 ? this.children.length : index, 0, node); return node; }
  remove() { if (this.parentNode?.children) this.parentNode.children = this.parentNode.children.filter(node => node !== this); this.parentNode = null; }
  replaceChildren(...nodes) { for (const child of [...this.children]) child.remove(); nodes.forEach(node => this.appendChild(node)); }
  get lastElementChild() { return this.children.at(-1); }
  get previousElementSibling() { return this.parentNode?.children[this.parentNode.children.indexOf(this) - 1]; }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
  matches(selector) { return selector.startsWith(".") ? this.getAttribute("class").split(" ").includes(selector.slice(1)) : selector === '[role="status"]' && this.getAttribute("role") === "status"; }
  closest(selector) { return this.matches(selector) ? this : this.parentNode?.closest?.(selector); }
  querySelector(selector) { for (const node of this.children) { if (node.matches(selector)) return node; const found = node.querySelector(selector); if (found) return found; } return null; }
  getBoundingClientRect() { return { left: 0, top: 100, width: 200, height: 30 }; }
  addEventListener(type, callback, options) { const list = this.listeners.get(type) || []; list.push({ callback, capture: options === true || options?.capture }); this.listeners.set(type, list); }
  removeEventListener(type, callback) { this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item.callback !== callback)); }
}

function fire(target, type, values = {}) {
  const event = { target, type, defaultPrevented: false, stopped: false,
    preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...values };
  const chain = []; for (let node = target; node; node = node.parentNode) chain.push(node);
  for (const capture of [true, false]) {
    for (const node of capture ? [...chain].reverse() : chain) {
      for (const item of node.listeners.get(type) || []) if (Boolean(item.capture) === capture) item.callback(event);
      if (event.stopped) return event;
    }
  }
  return event;
}

function dataTransfer(tabs = []) {
  const records = new Map(tabs.map((tab, index) => [index, tab]));
  return { mozItemCount: tabs.length, dropEffect: "none", mozUserCancelled: false,
    mozSetDataAt(type, tab, index) { assert.equal(type, "application/x-fluxion-tab"); records.set(index, tab); this.mozItemCount = records.size; },
    mozGetDataAt(type, index) { assert.equal(type, "application/x-fluxion-tab"); return records.get(index); } };
}

function fixture() {
  const windows = [], adoptions = [], alerts = [], errors = [], created = [];
  const Services = { wm: { getEnumerator: () => windows }, scriptSecurityManager: { isSystemPrincipal: value => value === "system" },
    prompt: { alert: (_window, _title, message) => alerts.push(message) }, prefs: { getStringPref: (_key, fallback) => fallback } };
  function createWindow(isPrivate = false) {
    const document = { createXULElement: name => new Node(name, document), getElementById: id => {
      const scan = node => node.getAttribute("id") === id ? node : node.children.map(scan).find(Boolean);
      return scan(document.root);
    } };
    document.root = new Node("root", document);
    const window = new Node("window", document);
    Object.assign(window, { document, isPrivate, closed: false, setTimeout, screenX: windows.length * 400, screenY: 0, outerWidth: 300, outerHeight: 300, gBrowserInit: { delayedStartupFinished: true } });
    windows.push(window);
    const flow = document.root.appendChild(new Node("aside", document)); flow.setAttribute("id", "fluxion-flow");
    const list = flow.appendChild(new Node("div", document)); list.setAttribute("class", "fluxion-tabs");
    const status = flow.appendChild(new Node("div", document)); status.setAttribute("role", "status");
    const context = document.root.appendChild(new Node("menupopup", document)); context.setAttribute("id", "fluxion-tab-context");
    const groupContext = document.root.appendChild(new Node("menupopup", document)); groupContext.setAttribute("id", "fluxion-group-context");
    const reindex = () => window.gBrowser.tabs.forEach((tab, index) => { tab._tPos = index; });
    window.addTab = (label = "Page", workspace = "a") => {
      const tab = new Node("tab", document);
      Object.assign(tab, { ownerGlobal: window, nodePrincipal: "system", parentNode: {}, label, linkedBrowser: {
        currentURI: { spec: label === "about:blank" ? label : `https://example.test/${label}` },
        browsingContext: { currentWindowGlobal: {}, sessionHistory: { count: 1 } },
      } });
      tab.setAttribute("fluxion-workspace", workspace);
      window.gBrowser.tabs.push(tab); reindex(); window.gBrowser.selectedTab ||= tab;
      return tab;
    };
    window.gBrowser = { tabs: [], selectedTabs: [], tabContainer: new Node("tabs", document),
      get pinnedTabCount() { return this.tabs.filter(tab => tab.pinned).length; },
      addTrustedTab: () => window.addTab("about:blank"),
      removeTab(tab) { this.tabs = this.tabs.filter(item => item !== tab); tab.parentNode = null; reindex(); },
      pinTab: tab => { tab.pinned = true; }, unpinTab: tab => { tab.pinned = false; }, ungroupTab: tab => { tab.group = null; },
      adoptTab(old, options) {
        adoptions.push({ old, target: window, options });
        const next = window.addTab(old.label); next.linkedBrowser = old.linkedBrowser;
        old.ownerGlobal.gBrowser.removeTab(old); return next;
      },
      adoptTabGroup(group, options) {
        const tabs = group.tabs.map(tab => this.adoptTab(tab, options));
        const adoptedGroup = { tabs, id: group.id, label: group.label, color: group.color, collapsed: false };
        tabs.forEach(tab => { tab.group = adoptedGroup; });
        return adoptedGroup;
      },
    };
    window.FluxionUI = { currentWorkspace: () => "a", workspaces: () => [{ id: "a", name: "Focus" }, { id: "b", name: "Build" }],
      tabWorkspace: tab => tab.getAttribute("fluxion-workspace"), contextTabs: () => window.contextTabs || [],
      groupContextTabs: () => window.groupContextTabs || [],
      withWorkspaceReconciliationPaused: callback => callback(), reconcileTransferredTabs() {},
      setTabWorkspace: (tab, id) => tab.setAttribute("fluxion-workspace", id),
      selectTab: tab => { window.gBrowser.selectedTab = tab; },
    };
    window.FluxionPeek = { isPeek: tab => tab.hasAttribute("fluxion-peek") };
    window.OpenBrowserWindow = options => { const target = createWindow(options.private); target.addTab("about:blank"); created.push(target); return target; };
    const scope = vm.createContext({ window, Services, Cu: { reportError: error => errors.push(error) },
      ChromeUtils: { importESModule: () => ({ PrivateBrowsingUtils: { isWindowPrivate: candidate => candidate.isPrivate } }) },
      SessionStore: { getCustomTabValue: (tab, key) => tab.getAttribute(key), deleteCustomTabValue: (tab, key) => tab.removeAttribute(key) } });
    scripts.forEach(script => vm.runInContext(script, scope));
    window.row = tab => { const row = list.appendChild(new Node("button", document)); row.setAttribute("class", "fluxion-tab"); row._fluxionTab = tab; return row; };
    Object.assign(window, { flow, list, status, context, groupContext }); return window;
  }
  const sourceWindow = createWindow(), target = createWindow();
  const sourceTab = sourceWindow.addTab("Original"), targetTab = target.addTab("Destination", "b");
  sourceWindow.addTab("Remaining"); sourceWindow.contextTabs = [sourceTab];
  return { sourceWindow, target, sourceTab, targetTab, createWindow, adoptions, alerts, errors, created };
}

test("foreign native tab payload uses the actual adapter with destination workspace and insertion edge", async () => {
  const f = fixture(), row = f.target.row(f.targetTab), transfer = dataTransfer([f.sourceTab]);
  const over = fire(row, "dragover", { dataTransfer: transfer, clientX: 50, clientY: 129 });
  assert.equal(over.defaultPrevented, true); assert.equal(row.dataset.dropIntent, "reorder-after");
  fire(row, "drop", { dataTransfer: transfer, clientX: 50, clientY: 129 }); await flush();
  assert.equal(f.adoptions.length, 1); assert.equal(f.adoptions[0].old, f.sourceTab);
  assert.equal(f.adoptions[0].target, f.target); assert.equal(f.adoptions[0].options.tabIndex, 1);
  assert.equal(f.target.gBrowser.selectedTab.getAttribute("fluxion-workspace"), "b");
  assert.equal(row.dataset.dropIntent, undefined); assert.match(f.target.status.textContent, /1 tab moved/);
});

test("private, stale and forged foreign payloads perform no adoption", async () => {
  for (const mutate of [f => { f.target.isPrivate = true; }, f => { f.sourceTab.closing = true; },
    f => { f.sourceTab.nodePrincipal = "content"; }, f => { f.sourceWindow.gBrowser.tabs = []; }]) {
    const f = fixture(); mutate(f);
    fire(f.target.row(f.targetTab), "drop", { dataTransfer: dataTransfer([f.sourceTab]), clientX: 1, clientY: 100 }); await flush();
    assert.equal(f.adoptions.length, 0); assert.equal(f.created.length, 0);
  }
});

test("native multiselection payload moves into the explicit workspace while group headings reject foreign grouping", async () => {
  const f = fixture(), originals = [...f.sourceWindow.gBrowser.tabs];
  f.sourceWindow.gBrowser.selectedTabs = originals;
  const row = f.sourceWindow.row(f.sourceTab), transfer = dataTransfer();
  fire(row, "dragstart", { dataTransfer: transfer }); assert.equal(transfer.mozItemCount, 2);
  const group = f.target.list.appendChild(new Node("button", f.target.document)); group.setAttribute("class", "fluxion-group-heading");
  fire(group, "drop", { dataTransfer: transfer }); await flush(); assert.equal(f.adoptions.length, 0);
  const workspace = f.target.flow.appendChild(new Node("button", f.target.document));
  workspace.setAttribute("class", "fluxion-workspace"); workspace.setAttribute("data-workspace-id", "b");
  fire(workspace, "drop", { dataTransfer: transfer }); await flush();
  assert.deepEqual(f.adoptions.map(item => item.old), originals);
  assert.equal(f.sourceWindow.gBrowser.tabs.length, 1, "last-tab source receives native anchor");
  assert.ok(f.target.gBrowser.tabs.slice(1).every(tab => tab.getAttribute("fluxion-workspace") === "b"));
});

test("Peek context menu explains promotion and exposes no actionable destination", async () => {
  const f = fixture(); f.sourceTab.setAttribute("fluxion-peek", "true");
  fire(f.sourceWindow.context, "popupshowing");
  const popup = f.sourceWindow.document.getElementById("fluxion-move-window-popup"); fire(popup, "popupshowing");
  assert.equal(popup.children.length, 1); assert.equal(popup.children[0].getAttribute("disabled"), "true");
  assert.match(popup.children[0].getAttribute("label"), /Keep Peek as Tab/);
  fire(popup.children[0], "command"); await flush(); assert.equal(f.adoptions.length, 0); assert.equal(f.created.length, 0);
});

test("local drag remains available to the existing local handler", async () => {
  const f = fixture(), row = f.sourceWindow.row(f.sourceTab); let local = 0;
  row.addEventListener("drop", () => local++);
  const event = fire(row, "drop", { dataTransfer: dataTransfer([f.sourceTab]), clientX: 1, clientY: 100 }); await flush();
  assert.equal(local, 1); assert.equal(event.defaultPrevented, false); assert.equal(f.adoptions.length, 0);
});

test("drag-out ignores Escape, untrusted input, and drops inside a foreign private window", async () => {
  for (const values of [{ mozUserCancelled: true, x: 1000 }, { isTrusted: false, x: 1000 }, { x: 850 }]) {
    const f = fixture(); f.createWindow(true);
    const row = f.sourceWindow.row(f.sourceTab), transfer = dataTransfer();
    fire(row, "dragstart", { dataTransfer: transfer });
    if (values.mozUserCancelled) transfer.mozUserCancelled = true;
    fire(row, "dragend", { dataTransfer: transfer, isTrusted: values.isTrusted ?? true, screenX: values.x, screenY: 10 }); await flush();
    assert.equal(f.created.length, 0); assert.equal(f.adoptions.length, 0);
  }
});

test("genuine drag-out dispatch and New Window menu use native detach", async () => {
  for (const mode of ["drag", "menu"]) {
    const f = fixture();
    if (mode === "drag") {
      const row = f.sourceWindow.row(f.sourceTab), transfer = dataTransfer();
      fire(row, "dragstart", { dataTransfer: transfer });
      fire(row, "dragend", { dataTransfer: transfer, isTrusted: true, screenX: 1000, screenY: 1000 });
    } else {
      fire(f.sourceWindow.context, "popupshowing");
      const popup = f.sourceWindow.document.getElementById("fluxion-move-window-popup"); fire(popup, "popupshowing");
      fire(f.sourceWindow.document.getElementById("fluxion-move-new-window"), "command");
    }
    await flush(); assert.equal(f.created.length, 1); assert.equal(f.adoptions.length, 1);
    assert.equal(f.created[0].gBrowser.tabs.length, 1); assert.equal(f.created[0].gBrowser.tabs[0].label, "Original");
  }
});

test("menu captures original tabs, while adapter revalidates closed destinations at command time", async () => {
  for (const closeTarget of [false, true]) {
    const f = fixture(); fire(f.sourceWindow.context, "popupshowing");
    f.sourceWindow.contextTabs = [f.sourceWindow.gBrowser.tabs[1]];
    const popup = f.sourceWindow.document.getElementById("fluxion-move-window-popup"); fire(popup, "popupshowing");
    const item = popup.children.find(node => node.hasAttribute("data-fluxion-window-target")); assert.ok(item);
    f.target.closed = closeTarget; fire(item, "command"); await flush();
    if (closeTarget) { assert.equal(f.adoptions.length, 0); assert.match(f.alerts[0], /open Fluxion window/); }
    else { assert.equal(f.adoptions.length, 1); assert.equal(f.adoptions[0].old, f.sourceTab); }
  }
});

test("queued drop revalidates a removed destination tab before mutating native tabs", async () => {
  const f = fixture();
  fire(f.target.row(f.targetTab), "drop", { dataTransfer: dataTransfer([f.sourceTab]), clientX: 20, clientY: 100 });
  f.target.gBrowser.removeTab(f.targetTab); await flush();
  assert.equal(f.adoptions.length, 0); assert.match(f.alerts[0], /destination tab/);
});

test("group menu snapshots every member independently of selected tabs and later context changes", async () => {
  const f = fixture(), second = f.sourceWindow.addTab("Grouped second");
  const members = [f.sourceTab, second], outside = f.sourceWindow.gBrowser.tabs[1];
  const group = { tabs: members, id: "research-group", label: "Research", color: "green", collapsed: true };
  members.forEach(tab => { tab.group = group; });
  f.sourceWindow.gBrowser.selectedTab = outside;
  f.sourceWindow.gBrowser.selectedTabs = [outside];
  f.sourceWindow.contextTabs = [outside];
  f.sourceWindow.groupContextTabs = members;
  fire(f.sourceWindow.groupContext, "popupshowing");
  // A later heading/context change cannot retarget the already-open menu.
  f.sourceWindow.groupContextTabs = [outside];
  fire(f.sourceWindow.context, "popupshowing");
  const popup = f.sourceWindow.document.getElementById("fluxion-move-group-window-popup");
  assert.ok(popup); fire(popup, "popupshowing");
  const item = popup.children.find(node => node.hasAttribute("data-fluxion-window-target")); assert.ok(item);
  f.target.FluxionUI.currentWorkspace = () => "b";
  fire(item, "command"); await flush();
  assert.deepEqual(f.adoptions.map(item => item.old), members);
  assert.ok(f.sourceWindow.gBrowser.tabs.includes(outside));
  const adopted = f.target.gBrowser.tabs.filter(tab => tab.group);
  assert.equal(adopted.length, 2); assert.equal(adopted[0].group, adopted[1].group);
  assert.equal(adopted[0].group.label, "Research"); assert.equal(adopted[0].group.color, "green");
  assert.equal(adopted[0].group.collapsed, true);
  assert.ok(adopted.every(tab => tab.getAttribute("fluxion-workspace") === "a"), "destination workspace is also captured at menu creation");
});
