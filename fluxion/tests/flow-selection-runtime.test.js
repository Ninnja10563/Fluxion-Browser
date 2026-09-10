"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "../chrome/fluxion-chrome.js"), "utf8");
function block(start, end) {
  const first = source.indexOf(start), last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first);
  return source.slice(first, last);
}

function fixture(size = 1000) {
  const document = { activeElement: null, title: "" }, frames = [];
  class Element {
    constructor(className = "") {
      this.classes = new Set(className.split(" ").filter(Boolean)); this.attrs = new Map();
      this.children = []; this.listeners = new Map(); this.writes = 0; this.replacements = 0;
      this.ownerDocument = document; this.style = { setProperty() {} };
      this.classList = { contains: key => this.classes.has(key), toggle: (key, on) => {
        this.writes++; if (on) this.classes.add(key); else this.classes.delete(key);
      } };
      this.dataset = new Proxy({}, { set: (_, key, value) => {
        this.setAttribute(`data-${key.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}`, value); return true;
      } });
    }
    get isConnected() { return this.root || Boolean(this.parentNode?.isConnected); }
    get childElementCount() { return this.children.length; }
    set tabIndex(value) { this.writes++; this._tabIndex = value; }
    get tabIndex() { return this._tabIndex ?? -1; }
    setAttribute(key, value) { this.writes++; this.attrs.set(key, String(value)); }
    getAttribute(key) { return this.attrs.get(key) ?? null; }
    hasAttribute(key) { return this.attrs.has(key); }
    removeAttribute(key) { this.attrs.delete(key); }
    append(...children) { for (const child of children) { child.parentNode = this; this.children.push(child); } }
    appendChild(child) { this.append(child); return child; }
    replaceChildren(...children) {
      this.replacements++; for (const child of this.children) child.parentNode = null;
      this.children = []; this.append(...children);
    }
    matches(selector) {
      return selector.split(",").some(part => {
        const name = part.trim().match(/^\.([\w-]+)/)?.[1];
        return name && this.classes.has(name) && (!part.includes("[hidden]") || this.hidden);
      });
    }
    closest(selector) { for (let item = this; item; item = item.parentNode) if (item.matches(selector)) return item; return null; }
    querySelectorAll(selector) {
      return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
    }
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    emit(type, options = {}) { this.listeners.get(type)?.({ target: this, preventDefault() {}, stopPropagation() {}, ...options }); }
    focus() { document.activeElement = this; }
    scrollIntoView() { this.scrolled = true; }
  }
  const create = (_tag, className) => new Element(className);
  const pinnedTabs = new Element("fluxion-pinned-tabs"), tabsList = new Element("fluxion-tabs");
  pinnedTabs.root = tabsList.root = true;
  const tabs = Array.from({ length: size }, (_, index) => ({
    label: `Page ${index}`, parentNode: {}, workspace: "focus", linkedPanel: "panel", pinned: false,
    linkedBrowser: { currentURI: { displaySpec: `https://example.org/${index}` } },
    hasAttribute: () => false, multiselected: false,
  }));
  let selected = tabs[0];
  const gBrowser = { tabs, get selectedTabs() { return tabs.filter(tab => tab === selected || tab.multiselected); },
    clearMultiSelectedTabs() { for (const tab of tabs) tab.multiselected = false; },
    addToMultiSelectedTabs(tab) { tab.multiselected = true; context.scheduleRender({ type: "TabMultiSelect" }); },
    removeFromMultiSelectedTabs(tab) { tab.multiselected = false; context.scheduleRender({ type: "TabMultiSelect" }); },
    lockClearMultiSelectionOnce() {}, lastMultiSelectedTab: selected,
  };
  Object.defineProperty(gBrowser, "selectedTab", { get: () => selected, set(tab) {
    if (tab === selected) return; selected = tab; context.scheduleRender({ type: "TabSelect", target: tab });
  } });
  const context = vm.createContext({ document, gBrowser, navigator: { platform: "MacIntel" },
    window: { requestAnimationFrame: action => frames.push(action) },
    tabElements: new Map(), groupElements: new Map(), workspaceElements: new Map(),
    dirtyTabs: new Set(), rovingElements: new Map(), renderedMultiSelected: new Set(),
    renderedSelectedTab: null, renderedWorkspace: null, selectionDirty: false,
    currentWorkspace: "focus", structureDirty: true, renderQueued: false,
    pointerCloseHold: null, renderDeferredForClose: false, flowMenuSession: null, closingTabs: new Set(),
    focusTabAfterRender: null, focusGroupAfterRender: null, focusWorkspaceAfterRender: null,
    groupRenderSequence: 0, pinnedTabs, tabsList, pinnedLabel: {}, count: {},
    tabWorkspace: tab => tab.workspace, tabLabel: tab => tab?.label || "New tab", iconFor: () => "",
    renderWorkspaces() {}, resetTabDrag() {}, create, statusGlyph: () => new Element(), controlGlyph: () => new Element(),
    describeTab: () => ({ labels: [], indicators: [], audio: null }), splitOrientation: tab => tab.splitview.orientation,
    FluxionFlowNavigation: require("../chrome/core/flow-navigation.js"),
    FluxionFlowTabContent: require("../chrome/core/flow-tab-content.js"),
    FluxionTabGroups: require("../chrome/core/tab-groups.js"),
    FluxionSplitViews: require("../chrome/core/split-views.js"),
  });
  // Execute the shipped renderer, row event handlers, projections and scheduler
  // together. Only browser services and native DOM are supplied by this fixture.
  vm.runInContext(block("  function renderedTreeItems()", "  function clearTabDropFeedback()") +
    block("  function refreshTabElement(", "  function workspaceSymbol(") +
    block("  function createGroupElement(", "  function renderWorkspaces()") +
    block("  function render()", "  const popupSet ="), context);
  const flush = () => { while (frames.length) frames.shift()(); };
  context.render();
  const row = tab => context.tabElements.get(tab);
  const nodes = () => [...pinnedTabs.querySelectorAll(".fluxion-tab"), ...tabsList.querySelectorAll(".fluxion-tab")];
  return { context, document, tabs, gBrowser, pinnedTabs, tabsList, flush, row, nodes, Element };
}

test("1,000-row native selection preserves controls and leaves unaffected DOM untouched", () => {
  const f = fixture();
  const original = f.nodes(), closes = original.map(row => row._fluxionParts.close);
  const writes = original.map(row => row.writes), replacements = f.tabsList.replacements;
  const external = new f.Element(); external.root = true; external.focus();
  f.gBrowser.selectedTab = f.tabs[700]; f.flush();
  assert.deepEqual(f.nodes(), original);
  assert.deepEqual(f.nodes().map(row => row._fluxionParts.close), closes);
  assert.equal(f.tabsList.replacements, replacements);
  assert.equal(f.document.activeElement, external);
  for (let i = 1; i < 1000; i++) if (i !== 700) assert.equal(original[i].writes, writes[i]);
  assert.equal(f.row(f.tabs[0]).getAttribute("data-active"), "false");
  assert.equal(f.row(f.tabs[700]).getAttribute("aria-selected"), "true");
  assert.equal(f.nodes().filter(row => row.tabIndex === 0).length, 1);
});

test("actual click, accelerator click and keyboard handlers do not force structural renders", () => {
  const f = fixture(20), original = f.nodes();
  f.row(f.tabs[3]).emit("click"); f.flush();
  f.row(f.tabs[5]).emit("click", { metaKey: true }); f.flush();
  assert.equal(f.row(f.tabs[5]).classList.contains("is-multiselected"), true);
  f.row(f.tabs[5]).emit("click", { metaKey: true }); f.flush();
  assert.equal(f.row(f.tabs[5]).getAttribute("aria-selected"), "false");
  f.row(f.tabs[3]).focus();
  f.row(f.tabs[3]).emit("keydown", { key: "ArrowDown" }); f.flush();
  assert.equal(f.gBrowser.selectedTab, f.tabs[4]);
  assert.equal(f.document.activeElement, f.row(f.tabs[4]));
  f.row(f.tabs[4]).emit("keydown", { key: "Enter" }); f.flush();
  assert.equal(f.document.activeElement, f.row(f.tabs[4]));
  assert.deepEqual(f.nodes(), original);
});

test("expanded group and split active indicators update without replacing wrappers", () => {
  const f = fixture(8), group = { id: "g", label: "Research", color: "blue", collapsed: false };
  f.tabs[2].group = f.tabs[3].group = group;
  const split = { tabs: [f.tabs[4], f.tabs[5]], orientation: "side-by-side",
    get hasActiveTab() { return this.tabs.includes(f.gBrowser.selectedTab); } };
  for (const tab of split.tabs) tab.splitview = split;
  f.context.scheduleRender(); f.flush();
  const rows = f.nodes(), heading = f.context.groupElements.get(group);
  const wrapper = f.row(f.tabs[4]).closest(".fluxion-split");
  f.gBrowser.selectedTab = f.tabs[2]; f.flush();
  assert.equal(heading.classList.contains("has-active"), true);
  f.gBrowser.selectedTab = f.tabs[4]; f.flush();
  assert.equal(heading.classList.contains("has-active"), false);
  assert.equal(wrapper.getAttribute("data-active"), "true");
  f.gBrowser.selectedTab = f.tabs[7]; f.flush();
  assert.equal(wrapper.getAttribute("data-active"), "false");
  assert.deepEqual(f.nodes(), rows);
});

test("collapsed projections and pending topology changes retain structural fallback", () => {
  const f = fixture(8), group = { id: "g", label: "Research", color: "blue", collapsed: true };
  f.tabs[2].group = f.tabs[3].group = group;
  f.context.scheduleRender(); f.flush();
  assert.equal(f.row(f.tabs[2]), undefined);
  f.gBrowser.selectedTab = f.tabs[2]; f.flush();
  assert.ok(f.row(f.tabs[2])); assert.equal(f.row(f.tabs[3]), undefined);
  f.gBrowser.selectedTab = f.tabs[3]; f.flush();
  assert.equal(f.row(f.tabs[2]), undefined); assert.ok(f.row(f.tabs[3]));
  f.gBrowser.selectedTab = f.tabs[7]; f.flush();
  assert.equal(f.row(f.tabs[3]), undefined);
  const old = f.row(f.tabs[7]);
  f.context.scheduleRender({ type: "TabMove" });
  f.gBrowser.selectedTab = f.tabs[6]; f.flush();
  assert.notEqual(f.row(f.tabs[7]), old);
});

test("pinned and ordinary trees keep independent roving stops; external focus is retained", () => {
  const f = fixture(8); f.tabs[0].pinned = f.tabs[1].pinned = true;
  f.context.scheduleRender(); f.flush();
  f.gBrowser.selectedTab = f.tabs[5]; f.flush();
  assert.equal(f.pinnedTabs.querySelectorAll(".fluxion-tab").filter(row => row.tabIndex === 0).length, 1);
  assert.equal(f.tabsList.querySelectorAll(".fluxion-tab").filter(row => row.tabIndex === 0).length, 1);
  f.row(f.tabs[0]).focus(); f.row(f.tabs[0]).emit("keydown", { key: "ArrowRight" }); f.flush();
  assert.equal(f.document.activeElement, f.row(f.tabs[1]));
  assert.equal(f.gBrowser.selectedTab, f.tabs[1]);
});

test("pointer close hold never reconstructs placeholders during selection", () => {
  const f = fixture(8), original = f.nodes();
  f.context.pointerCloseHold = { tabs: new Set(), closed: new Set() };
  f.gBrowser.selectedTab = f.tabs[3]; f.flush();
  assert.deepEqual(f.nodes(), original);
  assert.equal(f.context.renderDeferredForClose, true);
  assert.equal(f.row(f.tabs[3]).getAttribute("aria-selected"), "true");
});

test("native selection leaves an unrelated focused row or group completely untouched", () => {
  const f = fixture(12), group = { id: "g", label: "Research", color: "blue", collapsed: false };
  f.tabs[5].group = f.tabs[6].group = group;
  f.context.scheduleRender(); f.flush();
  for (const element of [f.row(f.tabs[8]), f.context.groupElements.get(group)]) {
    f.context.focusFlowItem(element);
    const before = element.writes;
    f.gBrowser.selectedTab = f.tabs[f.gBrowser.selectedTab === f.tabs[1] ? 2 : 1]; f.flush();
    assert.equal(f.document.activeElement, element);
    assert.equal(element.writes, before);
    assert.equal(f.tabsList.querySelectorAll(".fluxion-tab, .fluxion-group-heading").filter(item => item.tabIndex === 0).length, 1);
  }
});

test("coalesced selection and content update settle latest state without topology work", () => {
  const f = fixture(12), original = f.nodes();
  f.gBrowser.selectedTab = f.tabs[2];
  f.gBrowser.addToMultiSelectedTabs(f.tabs[3]);
  f.gBrowser.removeFromMultiSelectedTabs(f.tabs[3]);
  f.gBrowser.addToMultiSelectedTabs(f.tabs[4]);
  f.tabs[4].label = "Changed during selection";
  f.context.scheduleRender({ type: "TabAttrModified", target: f.tabs[4], detail: { changed: ["label"] } });
  f.gBrowser.selectedTab = f.tabs[6]; f.flush();
  assert.deepEqual(f.nodes(), original);
  assert.equal(f.row(f.tabs[6]).getAttribute("data-active"), "true");
  assert.equal(f.row(f.tabs[2]).getAttribute("data-active"), "false");
  assert.equal(f.row(f.tabs[3]).classList.contains("is-multiselected"), false);
  assert.equal(f.row(f.tabs[4]).classList.contains("is-multiselected"), true);
  assert.equal(f.row(f.tabs[4])._fluxionParts.title.textContent, "Changed during selection");
});

test("workspace and pin topology changes win over pending selection", () => {
  const f = fixture(8);
  const original = f.row(f.tabs[0]);
  f.tabs[2].pinned = true;
  f.gBrowser.selectedTab = f.tabs[2];
  f.context.scheduleRender({ type: "TabPinned" }); f.flush();
  assert.notEqual(f.row(f.tabs[0]), original);
  assert.equal(f.row(f.tabs[2]).closest(".fluxion-pinned-tabs"), f.pinnedTabs);
  f.tabs[7].workspace = "build"; f.context.currentWorkspace = "build";
  f.gBrowser.selectedTab = f.tabs[7]; f.flush();
  assert.equal(f.nodes().length, 1);
  assert.equal(f.nodes()[0]._fluxionTab, f.tabs[7]);
});
