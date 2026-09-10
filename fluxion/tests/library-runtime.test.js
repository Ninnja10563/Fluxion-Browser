"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const settle = () => new Promise(resolve => setImmediate(resolve));

// Execute the complete shipped chrome script and its real pure helpers. Only
// browser/DOM IO is replaced; SQL resolution is deliberately controllable.
function harness({ section = "history", initialURI = "about:downloads#history", downloads = [] } = {}) {
  const elements = [];
  let document;
  class Element {
    constructor(tag = "div") {
      Object.assign(this, { tag, children: [], attributes: new Map(), listeners: new Map(),
        dataset: {}, style: {}, value: "", hidden: false, disabled: false, ownText: "", isConnected: true });
      elements.push(this);
    }
    get textContent() { return this.ownText + this.children.map(child => child.textContent).join(""); }
    set textContent(value) { this.ownText = String(value); this.children = []; }
    setAttribute(key, value) { this.attributes.set(key, String(value)); }
    getAttribute(key) { return this.attributes.get(key) ?? null; }
    hasAttribute(key) { return this.attributes.has(key); }
    toggleAttribute(key, force) { if (force) this.setAttribute(key, ""); else this.attributes.delete(key); }
    append(...children) {
      for (const child of children) {
        if (child.tag === "fragment") this.append(...child.children);
        else { this.children.push(child); child.parentNode = this; }
      }
    }
    appendChild(child) { this.append(child); return child; }
    get firstChild() { return this.children[0] || null; }
    get nextSibling() {
      const siblings = this.parentNode?.children || [];
      return siblings[siblings.indexOf(this) + 1] || null;
    }
    insertBefore(child, next) {
      if (child.parentNode) child.parentNode.children = child.parentNode.children.filter(item => item !== child);
      const index = next ? this.children.indexOf(next) : -1;
      this.children.splice(index < 0 ? this.children.length : index, 0, child);
      child.parentNode = this;
    }
    closest(selector) {
      if (selector === `.${this.className}`) return this;
      return this.parentNode?.closest(selector) || null;
    }
    replaceChildren(...children) { this.children = []; this.ownText = ""; this.append(...children); }
    remove() {
      this.isConnected = false;
      if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this);
    }
    addEventListener(type, fn) { this.listeners.set(type, [...(this.listeners.get(type) || []), fn]); }
    removeEventListener(type, fn) { this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item !== fn)); }
    dispatch(type) {
      for (const fn of this.listeners.get(type) || []) fn({ target: this, preventDefault() {}, stopPropagation() {} });
    }
    focus() { document.activeElement = this; }
  }
  document = { documentElement: new Element(), body: new Element(),
    createElementNS: (_ns, tag) => new Element(tag), createDocumentFragment: () => new Element("fragment"),
    getElementById: id => elements.find(node => node.id === id),
  };
  document.activeElement = document.body;
  const browserBox = new Element(); browserBox.id = "browser";
  const deck = new Element(); deck.id = "tabbrowser-tabbox";
  const tab = new Element();
  tab.setAttribute("fluxion-library-section", section);
  tab.linkedBrowser = { currentURI: { spec: initialURI } };
  const queries = [], errors = [], timers = new Map();
  let nextTimer = 0;
  let observerRemoved = false;
  let progressListener;
  let downloadView;
  const Downloads = { PUBLIC: 1, getList: async () => ({ getAll: async () => [...downloads],
    addView: async view => { downloadView = view; }, removeView() {} }) };
  const db = { execute: (sql, params) => new Promise((resolve, reject) => queries.push({ sql, params, resolve, reject })) };
  const PlacesUtils = { promiseDBConnection: async () => db,
    bookmarks: { toolbarGuid: "toolbar_____", menuGuid: "menu________", unfiledGuid: "unfiled_____", mobileGuid: "mobile______" },
    observers: { addListener() {}, removeListener() { observerRemoved = true; } },
  };
  const window = Object.assign(new Element(), { document,
    setTimeout(fn) { const id = ++nextTimer; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
    FluxionUI: { refresh() {}, currentWorkspace: () => "work" },
  });
  const context = vm.createContext({ window, document,
    gBrowser: { tabs: [tab], selectedTab: tab, selectedBrowser: tab.linkedBrowser,
      tabContainer: new Element(), addTabsProgressListener(listener) { progressListener = listener; }, removeTabsProgressListener() {} },
    ChromeUtils: { importESModule: () => ({ PlacesUtils, Downloads, PrivateBrowsingUtils: { isWindowPrivate: () => false } }) },
    SessionStore: { persistTabAttribute() {} },
    Cu: { reportError: error => errors.push(error) },
    Services: { env: { get: () => "" }, prefs: { setStringPref() {}, savePrefFile() {} } },
  });
  for (const file of ["core/library-data.js", "core/library-query.js", "core/library-changes.js", "core/library-downloads.js", "fluxion-library.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../chrome", file), "utf8"), context, { filename: file });
  }
  const byClass = name => elements.find(node => node.className === name);
  const input = byClass("fluxion-library-search");
  return { window, document, queries, errors, timers, input,
    commitURI(uri) { tab.linkedBrowser.currentURI.spec = uri; progressListener.onLocationChange(tab.linkedBrowser); },
    downloadChanged(download) { downloadView.onDownloadChanged(download); },
    list: byClass("fluxion-library-list"), root: document.getElementById("fluxion-library"),
    next: elements.find(node => node.getAttribute("aria-label") === "Next Library page"),
    content: byClass("fluxion-library-content"), observerRemoved: () => observerRemoved,
    type(text) { input.focus(); input.value = text; input.dispatch("input"); },
    flush() { const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()); },
  };
}

function rows(title, count = 1) {
  return Array.from({ length: count }, (_, index) => {
    const row = { id: 1000 - index, cursorTimestamp: 1000000 - index,
      title: `${title} ${index}`, url: `https://example.test/${title}/${index}`, visited: 1000, visits: 1 };
    return { getResultByName: name => row[name] };
  });
}

test("initial about:downloads commit retains native download rows and focused controls during progress", async () => {
  const download = { target: { path: "/profile/transfer.txt" }, source: { url: "http://127.0.0.1/transfer" },
    startTime: new Date(), stopped: true, succeeded: false, canceled: false,
    currentBytes: 0, totalBytes: 100, hasProgress: true, progress: 0 };
  const h = harness({ section: "downloads", initialURI: "about:blank", downloads: [download] });
  await settle();
  const row = h.list.children.find(node => node._fluxionDownload === download);
  assert.ok(row);
  const remove = row._fluxionParts.controls.remove;
  remove.focus();
  h.commitURI("about:downloads#downloads");
  await settle();
  assert.equal(h.list.children.find(node => node._fluxionDownload === download), row);
  assert.equal(h.document.activeElement, remove);
  Object.assign(download, { stopped: false, currentBytes: 25, progress: 25 });
  h.downloadChanged(download); h.flush(); await settle();
  assert.equal(h.list.children.find(node => node._fluxionDownload === download), row);
  assert.equal(row._fluxionParts.controls.cancel.hidden, false);
  assert.equal(row._fluxionParts.controls.remove, remove);
  assert.equal(h.document.activeElement, remove);
  assert.deepEqual(h.errors, []);
});

test("older full Library query results cannot overwrite a newer search", async () => {
  const h = harness(); await settle();
  h.type("newest"); h.flush(); await settle();
  assert.equal(h.queries.length, 2);
  assert.equal(h.queries[1].params.search, "newest");
  h.queries[1].resolve(rows("newest")); await settle();
  h.queries[0].resolve(rows("obsolete")); await settle();
  assert.match(h.list.textContent, /newest/);
  assert.doesNotMatch(h.list.textContent, /obsolete/);
  assert.equal(h.root.dataset.queryState, "ready");
});

test("superseded page advance cannot steal focus or scroll from a new search", async () => {
  const h = harness(); await settle();
  h.queries[0].resolve(rows("first page", 101)); await settle();
  assert.equal(h.next.disabled, false);
  h.next.focus(); h.next.dispatch("click"); await settle();
  assert.ok(h.queries[1].params.cursorTimestamp);
  h.type("focused search"); h.content.scrollTop = 237;
  h.flush(); await settle();
  h.queries[2].resolve(rows("focused search")); await settle();
  h.queries[1].resolve(rows("stale page")); await settle();
  assert.equal(h.document.activeElement, h.input);
  assert.equal(h.content.scrollTop, 237);
  assert.match(h.list.textContent, /focused search/);
  assert.doesNotMatch(h.list.textContent, /stale page/);
});

test("stale query rejection cannot end newer loading or clear its eventual results", async () => {
  const h = harness(); await settle();
  h.type("pending"); h.flush(); await settle();
  h.queries[0].reject(new Error("obsolete failure")); await settle();
  assert.equal(h.root.dataset.queryState, "loading");
  h.queries[1].resolve(rows("pending")); await settle();
  const outdated = h.window.FluxionLibrary.refresh(); await settle();
  h.type("latest"); h.flush(); await settle();
  h.queries[3].resolve(rows("latest")); await settle();
  h.queries[2].reject(new Error("late failure")); await outdated; await settle();
  assert.equal(h.root.dataset.queryState, "ready");
  assert.match(h.list.textContent, /latest/);
  assert.deepEqual(h.errors, []);
});

test("unload cancels debounce and prevents pending Library queries rendering", async () => {
  const h = harness(); await settle();
  h.type("not executed");
  assert.equal(h.timers.size, 1);
  const before = h.list.textContent;
  h.window.dispatch("unload");
  assert.equal(h.timers.size, 0);
  assert.equal(h.observerRemoved(), true);
  h.queries[0].resolve(rows("after unload")); await settle();
  assert.equal(h.list.textContent, before);
  assert.equal(h.root.isConnected, false);
  assert.equal(h.queries.length, 1);
  assert.deepEqual(h.errors, []);
});
