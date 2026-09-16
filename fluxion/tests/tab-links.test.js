"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), vm = require("node:vm");
const core = require("../chrome/core/tab-links.js");
const source = fs.readFileSync(require.resolve("../chrome/fluxion-tab-links.js"), "utf8");

test("links retain native query/fragment bytes while removing only authority credentials", () => {
  for (const [input, expected] of [
    ["https://example.org/a%2fb?b=2&a=%2f+#part%2f", "https://example.org/a%2fb?b=2&a=%2f+#part%2f"],
    ["https://u:p%40ss@example.org/a?login=u:p@elsewhere#@tail", "https://example.org/a?login=u:p@elsewhere#@tail"],
    ["http://user@[::1]:8080/?#", "http://[::1]:8080/?#"],
    ["https://user:pass@example.org", "https://example.org"],
    ["https://a@b@example.org/path", "https://example.org/path"],
  ]) assert.equal(core.shareableURL(input), expected);
  for (const input of ["file:///tmp/private", "about:config", "chrome://browser/content/", "resource://fluxion/",
    "javascript:alert(1)", "data:text/plain,secret", "ftp://example.org/", "view-source:https://example.org", "blob:https://example.org/x",
    "https://", "https:///user:secret@example.org/path", "https:////user:secret@example.org/path",
    "https://a\\@b/", "https://a/\nhttps://b/", "https://a/\t", null, {}])
    assert.equal(core.shareableURL(input), null, String(input));
});

function fixture() {
  class Node {
    constructor() { this.attrs = new Map(); this.listeners = new Map(); this.children = []; }
    setAttribute(k, v) { this.attrs.set(k, v); }
    getAttribute(k) { return this.attrs.get(k) || ""; }
    toggleAttribute(k, on) { if (on) this.attrs.set(k, ""); else this.attrs.delete(k); }
    addEventListener(type, fn) { this.listeners.set(type, [...(this.listeners.get(type) || []), fn]); }
    removeEventListener(type, fn) { this.listeners.set(type, (this.listeners.get(type) || []).filter(f => f !== fn)); }
    emit(type) { for (const fn of this.listeners.get(type) || []) fn({ target: this }); }
    insertBefore(node, before) { node.parentNode = this; this.children.splice(before ? this.children.indexOf(before) : this.children.length, 0, node); }
    remove() { this.parentNode.children = this.parentNode.children.filter(n => n !== this); }
  }
  const window = new Node(), popup = new Node(), tabContainer = new Node(), copies = [], errors = [];
  popup.children.push(new Node(), new Node()); const first = popup.children[0];
  const tabs = [0, 1, 2].map(i => Object.assign(new Node(), { parentNode: tabContainer, ownerGlobal: window,
    workspace: "one", linkedBrowser: { currentURI: { spec: `https://example.org/${i}?raw=%2f#part` } } }));
  let context = tabs.slice(0, 2), workspace = "one", spaces = [{ id: "one" }, { id: "two" }], throwClipboard = false;
  const gBrowser = { tabs, tabContainer, selectedTab: tabs[2], getTabForBrowser: browser => tabs.find(t => t.linkedBrowser === browser) };
  Object.assign(window, { document: { getElementById: () => popup, createXULElement: () => new Node() }, gBrowser,
    FluxionUI: { contextTabs: () => context, tabWorkspace: tab => tab.workspace, currentWorkspace: () => workspace, workspaces: () => spaces } });
  const contextObject = { window, FluxionTabLinksCore: core, Ci: { nsIClipboardHelper: {} }, Cu: { reportError: e => errors.push(e) },
    Cc: { "@mozilla.org/widget/clipboardhelper;1": { getService() { return { copyString(text) {
      if (throwClipboard) throw new Error("clipboard unavailable"); copies.push(text);
    } }; } } } };
  vm.runInNewContext(source, contextObject);
  const item = popup.children[1];
  return { window, popup, item, tabs, copies, errors, tabContainer, first, gBrowser, contextObject,
    setContext(value) { context = value; }, switchWorkspace(value) { workspace = value; },
    removeWorkspace() { spaces = []; }, failClipboard() { throwClipboard = true; } };
}

test("explicit native command copies frozen ordered selection once without selecting/navigating or persistence", () => {
  const f = fixture(); f.setContext([f.tabs[1], f.tabs[0], f.tabs[1]]);
  f.popup.emit("popupshowing"); assert.equal(f.copies.length, 0);
  assert.equal(f.item.getAttribute("label"), "Copy 2 Tab Links");
  assert.equal(f.popup.children[0], f.first);
  f.setContext([f.tabs[2]]); f.item.emit("command"); f.item.emit("command");
  assert.deepEqual(f.copies, [f.tabs[0].linkedBrowser.currentURI.spec + "\n" + f.tabs[1].linkedBrowser.currentURI.spec]);
  assert.equal(f.gBrowser.selectedTab, f.tabs[2]); assert.equal(f.tabs.length, 3);
  assert.equal(f.window.FluxionTabLinks.available, true);
});

test("single private explicit copy is permitted without a history/store/service dependency", () => {
  const f = fixture(); f.window.isPrivate = true; f.setContext([f.tabs[0]]);
  f.tabs[0].linkedBrowser.currentURI.spec = "https://reader:secret@example.org/?private#fragment";
  f.popup.emit("popupshowing"); assert.equal(f.item.getAttribute("label"), "Copy Tab Link");
  f.item.emit("command"); assert.deepEqual(f.copies, ["https://example.org/?private#fragment"]);
  assert.doesNotMatch(source, /Services\.prefs|SessionStore|PlacesUtils|fetch\(|localStorage|PrivateBrowsingUtils/);
});

test("one unsafe scheme disables the whole batch instead of silently copying a subset", () => {
  const f = fixture(); f.tabs[1].linkedBrowser.currentURI.spec = "file:///secret";
  f.popup.emit("popupshowing"); assert.equal(f.item.attrs.has("disabled"), true);
  f.item.emit("command"); assert.deepEqual(f.copies, []);
  f.setContext([f.tabs[0]]); f.popup.emit("popupshowing"); assert.equal(f.item.attrs.has("disabled"), false);
});

test("stale URL/workspace/container/browser/parent/group/order/owner and detached or closing tabs reject the entire snapshot", () => {
  const changes = [f => { f.tabs[1].linkedBrowser.currentURI.spec += "changed"; }, f => { f.tabs[1].workspace = "two"; },
    f => f.tabs[1].setAttribute("usercontextid", "2"), f => { f.tabs[1].linkedBrowser = { currentURI: { spec: f.tabs[1].linkedBrowser.currentURI.spec } }; },
    f => { f.tabs[1].parentNode = {}; }, f => { f.tabs[1].group = {}; }, f => f.tabs.reverse(),
    f => { f.tabs[1].ownerGlobal = {}; }, f => { f.tabs[1].parentNode = null; }, f => { f.tabs[1].closing = true; },
    f => f.tabs.splice(1, 1), f => f.switchWorkspace("two"), f => f.removeWorkspace(), f => { f.window.closed = true; },
    f => f.tabContainer.emit("TabMove"), f => f.tabContainer.emit("TabClose"), f => f.tabContainer.emit("TabBrowserInserted"),
    f => f.popup.emit("popuphidden"), f => f.window.emit("unload")];
  for (const change of changes) {
    const f = fixture(); f.popup.emit("popupshowing"); change(f); f.item.emit("command"); assert.equal(f.copies.length, 0, String(change));
  }
});

test("unload removes callbacks, duplicate module evaluation is inert, and clipboard failure is single-use", () => {
  const f = fixture(); vm.runInNewContext(source, f.contextObject); assert.equal(f.popup.children.length, 3);
  f.popup.emit("popupshowing"); f.failClipboard(); f.item.emit("command"); f.item.emit("command"); assert.equal(f.errors.length, 1);
  f.window.emit("unload"); assert.equal(f.popup.children.length, 2); assert.equal(f.window.FluxionTabLinks, undefined);
  for (const callbacks of f.tabContainer.listeners.values()) assert.equal(callbacks.length, 0);
});
