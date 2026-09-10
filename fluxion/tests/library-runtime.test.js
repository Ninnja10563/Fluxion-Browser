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
    get ownerDocument() { return document; }
    get localName() { return this.tag; }
    setAttribute(key, value) { this.attributes.set(key, String(value)); if (key === "disabled") this.disabled = true; }
    getAttribute(key) { return this.attributes.get(key) ?? null; }
    removeAttribute(key) { this.attributes.delete(key); if (key === "disabled") this.disabled = false; }
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
    contains(node) { return node === this || this.children.some(child => child.contains(node)); }
    querySelectorAll(selector) {
      const selectors = selector.split(",").map(value => value.trim());
      const matches = node => selectors.some(value => value.startsWith(".")
        ? (node.className || "").split(/\s+/).includes(value.slice(1)) : node.tag === value);
      return this.children.flatMap(child => [...(matches(child) ? [child] : []), ...child.querySelectorAll(selector)]);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    openPopup(anchor) { this.anchorNode = anchor; this.state = "open"; this.dispatch("popupshown"); }
    openPopupAtScreen() { this.openPopup(null); }
    hidePopup() { if (this.state === "open") { this.state = "closed"; this.dispatch("popuphidden"); } }
    scrollIntoView() { this.scrolledIntoView = true; }
    replaceChildren(...children) { this.children = []; this.ownText = ""; this.append(...children); }
    remove() {
      this.isConnected = false;
      if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this);
    }
    addEventListener(type, fn) { this.listeners.set(type, [...(this.listeners.get(type) || []), fn]); }
    removeEventListener(type, fn) { this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item !== fn)); }
    dispatch(type, fields = {}) {
      const event = { type, target: this, defaultPrevented: false, stopped: false,
        preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; },
        stopImmediatePropagation() { this.stopped = true; }, ...fields };
      for (let node = this; node; node = node.parentNode) {
        for (const fn of node.listeners.get(type) || []) fn(event);
        if (event.stopped) break;
      }
    }
    click() { this.dispatch("click"); }
    focus() { document.activeElement = this; this.dispatch("focusin"); }
  }
  document = { documentElement: new Element(), body: new Element(),
    createElementNS: (_ns, tag) => new Element(tag), createDocumentFragment: () => new Element("fragment"),
    createXULElement: tag => new Element(tag),
    getElementById: id => elements.find(node => node.id === id),
  };
  document.activeElement = document.body;
  const browserBox = new Element(); browserBox.id = "browser";
  const deck = new Element(); deck.id = "tabbrowser-tabbox";
  const popupSet = new Element(); popupSet.id = "mainPopupSet";
  const tab = new Element();
  tab.setAttribute("fluxion-library-section", section);
  tab.linkedBrowser = { currentURI: { spec: initialURI } };
  const queries = [], errors = [], opened = [], timers = new Map();
  let nextTimer = 0;
  let observerRemoved = false;
  let placesObserver;
  let progressListener;
  let downloadView;
  const Downloads = { PUBLIC: 1, getList: async () => ({ getAll: async () => [...downloads],
    addView: async view => { downloadView = view; }, removeView() {} }) };
  const db = { execute: (sql, params) => new Promise((resolve, reject) => queries.push({ sql, params, resolve, reject })) };
  const PlacesUtils = { promiseDBConnection: async () => db,
    bookmarks: { toolbarGuid: "toolbar_____", menuGuid: "menu________", unfiledGuid: "unfiled_____", mobileGuid: "mobile______" },
    observers: { addListener(_types, listener) { placesObserver = listener; }, removeListener() { observerRemoved = true; } },
  };
  const window = Object.assign(new Element(), { document,
    setTimeout(fn) { const id = ++nextTimer; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
    FluxionUI: { refresh() {}, currentWorkspace: () => "work", setTabWorkspace() {} },
  });
  const context = vm.createContext({ window, document, URL,
    gBrowser: { tabs: [tab], selectedTab: tab, selectedBrowser: tab.linkedBrowser,
      addTrustedTab(url) { opened.push(url); return new Element("tab"); },
      tabContainer: new Element(), addTabsProgressListener(listener) { progressListener = listener; }, removeTabsProgressListener() {} },
    ChromeUtils: { importESModule: () => ({ PlacesUtils, Downloads, PrivateBrowsingUtils: { isWindowPrivate: () => false } }) },
    SessionStore: { persistTabAttribute() {} },
    Cu: { reportError: error => errors.push(error) },
    Services: { env: { get: () => "" }, prefs: { setStringPref() {}, savePrefFile() {} } },
  });
  for (const file of ["core/url.js", "core/library-data.js", "core/library-query.js", "core/library-changes.js", "core/library-downloads.js", "core/library-navigation.js", "fluxion-library.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../chrome", file), "utf8"), context, { filename: file });
  }
  const byClass = name => elements.find(node => node.className === name);
  const input = byClass("fluxion-library-search");
  return { window, document, queries, errors, timers, input, opened,
    menu: document.getElementById("fluxion-library-item-menu"),
    placesChanged(events) { placesObserver(events); },
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

test("background Places updates retain reading geometry and restore owned row focus without stale activation", async () => {
  const h = harness(); await settle();
  h.queries[0].resolve(rows("reading", 100)); await settle();
  const row = h.list.children[20];
  row.firstChild.focus(); h.content.scrollTop = 1200;
  h.placesChanged([{ type: "page-title-changed" }]);
  const timer = [...h.timers.keys()][0];
  h.placesChanged([{ type: "page-visited" }]);
  assert.equal([...h.timers.keys()][0], timer, "continuous events retain first refresh deadline");
  assert.equal(h.list.children[20], row);
  assert.equal(h.document.activeElement, row.firstChild);
  assert.equal(h.content.scrollTop, 1200);
  let prevented = false, stopped = false;
  h.list.listeners.get("click")[0]({ preventDefault() { prevented = true; }, stopImmediatePropagation() { stopped = true; } });
  assert.ok(prevented && stopped, "retained stale actions must be blocked");
  h.flush(); await settle();
  h.queries[1].resolve(rows("reading", 100).map(row => ({
    getResultByName: name => name === "title" ? "updated title" : row.getResultByName(name),
  }))); await settle();
  assert.ok(h.document.activeElement === h.list.children[20].firstChild);
  assert.equal(h.content.scrollTop, 1200);
  assert.match(h.list.textContent, /updated/);
});

test("deletions clear retained evidence immediately and explicit search cancels background focus recovery", async () => {
  const h = harness(); await settle();
  h.queries[0].resolve(rows("private old")); await settle();
  h.list.children[0].firstChild.focus();
  h.placesChanged([{ type: "page-title-changed" }]);
  h.type("new query");
  assert.doesNotMatch(h.list.textContent, /private old/);
  h.flush(); await settle();
  h.queries[1].resolve(rows("new query")); await settle();
  assert.equal(h.document.activeElement, h.input);
  h.placesChanged([{ type: "history-cleared" }]);
  assert.doesNotMatch(h.list.textContent, /new query 0/);
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

test("actual Library menu binds the selected row and invokes its native Open command", async () => {
  const h = harness(); await settle();
  h.queries[0].resolve(rows("menu", 100)); await settle();
  assert.equal(h.list.children.filter(row => row.firstChild.tabIndex === 0).length, 1);
  assert.ok(h.list.children.every(row => row.querySelector(".fluxion-library-more").tabIndex === -1));
  const target = h.list.children[17];
  const more = target.querySelector(".fluxion-library-more");
  more.focus(); more.click();
  assert.equal(h.menu.state, "open");
  assert.equal(h.menu.anchorNode, more);
  const open = h.menu.children.find(node => node.getAttribute("label") === "Open");
  assert.equal(open.getAttribute("aria-label"), "Open menu 17");
  open.dispatch("command"); await settle();
  assert.deepEqual(h.opened, ["https://example.test/menu/17"]);
  assert.equal(h.menu.state, "closed");
  assert.deepEqual(h.errors, []);
});

test("new search dismisses the shared menu without focus theft and invalidates captured old commands", async () => {
  const h = harness(); await settle();
  h.queries[0].resolve(rows("old menu")); await settle();
  const more = h.list.firstChild.querySelector(".fluxion-library-more");
  more.focus(); more.click();
  const open = h.menu.firstChild;
  h.type("new query");
  assert.equal(h.menu.state, "closed");
  assert.equal(h.document.activeElement, h.input);
  open.dispatch("command"); await settle();
  assert.deepEqual(h.opened, []);
  assert.deepEqual(h.errors, []);
});

test("a menu command queued before invalidation cannot activate its stale Places item", async () => {
  const h = harness(); await settle();
  h.queries[0].resolve(rows("queued menu")); await settle();
  h.list.firstChild.querySelector(".fluxion-library-more").click();
  h.menu.firstChild.dispatch("command");
  h.type("replacement");
  await settle();
  assert.deepEqual(h.opened, []);
  assert.equal(h.document.activeElement, h.input);
  assert.deepEqual(h.errors, []);
});
