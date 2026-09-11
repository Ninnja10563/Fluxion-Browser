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
      const styles = new Map();
      this.ownerDocument = document; this.style = {
        setProperty: (key, value) => { this.writes++; styles.set(key, String(value)); },
        getPropertyValue: key => styles.get(key) || "",
      };
      this.classList = { contains: key => this.classes.has(key), toggle: (key, on) => {
        const next = on === undefined ? !this.classes.has(key) : Boolean(on);
        if (this.classes.has(key) !== next) this.writes++;
        if (next) this.classes.add(key); else this.classes.delete(key);
        return next;
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
    append(...children) { for (const child of children) { child.remove(); child.parentNode = this; this.children.push(child); } }
    appendChild(child) { this.append(child); return child; }
    contains(node) { for (; node; node = node.parentNode) if (node === this) return true; return false; }
    remove() {
      if (!this.parentNode) return;
      this.parentNode.removeChild(this);
    }
    removeChild(child) {
      const index = this.children.indexOf(child);
      if (index < 0) throw new Error("NotFoundError");
      if (child.contains(document.activeElement)) document.activeElement = null;
      this.children.splice(index, 1); child.parentNode = null;
      return child;
    }
    insertBefore(child, before) {
      if (child.parentNode && child.contains(document.activeElement)) document.activeElement = null;
      this.moveBefore(child, before);
    }
    moveBefore(child, before) {
      // Atomic native moveBefore preserves focus, unlike remove/insertBefore.
      if (child.parentNode) child.parentNode.children.splice(child.parentNode.children.indexOf(child), 1);
      const index = before ? this.children.indexOf(before) : this.children.length;
      this.children.splice(index, 0, child); child.parentNode = this;
      this.moves = (this.moves || 0) + 1;
    }
    replaceChildren(...children) {
      if (this.contains(document.activeElement)) document.activeElement = null;
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
      if (selector.startsWith(":scope > ")) return this.children.filter(child => child.matches(selector.slice(9)));
      return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
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
  const registrations = new Map();
  const emit = (target, type, origin = target) => {
    for (const listener of registrations.get(target)?.get(type) || []) listener({ type, target: origin });
    // Native bubbling is child-to-parent only: parent TabMultiSelect must not
    // reach a listener incorrectly installed on the tab-strip child.
    if (target.parentEventTarget) emit(target.parentEventTarget, type, origin);
  };
  const gBrowser = { tabs, get selectedTabs() { return tabs.filter(tab => tab === selected || tab.multiselected); },
    clearMultiSelectedTabs() { for (const tab of tabs) tab.multiselected = false; emit(this, "TabMultiSelect"); },
    addToMultiSelectedTabs(tab) { tab.multiselected = true; emit(this, "TabMultiSelect"); },
    removeFromMultiSelectedTabs(tab) { tab.multiselected = false; emit(this, "TabMultiSelect"); },
    lockClearMultiSelectionOnce() {}, lastMultiSelectedTab: selected,
  };
  gBrowser.tabContainer = { parentEventTarget: gBrowser };
  Object.defineProperty(gBrowser, "selectedTab", { get: () => selected, set(tab) {
    if (tab === selected) return; selected = tab; emit(gBrowser.tabContainer, "TabSelect", tab);
  } });
  const context = vm.createContext({ document, gBrowser, navigator: { platform: "MacIntel" },
    window: { requestAnimationFrame: action => frames.push(action) },
    on(target, type, listener) {
      if (!registrations.has(target)) registrations.set(target, new Map());
      const listeners = registrations.get(target);
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    tabElements: new Map(), groupElements: new Map(), workspaceElements: new Map(),
    dirtyTabs: new Set(), rovingElements: new Map(), renderedMultiSelected: new Set(),
    renderedSelectedTab: null, renderedWorkspace: null, renderedFlat: false, selectionDirty: false,
    currentWorkspace: "focus", structureDirty: true, renderQueued: false,
    pointerCloseHold: null, renderDeferredForClose: false, flowMenuSession: null, closingTabs: new Set(),
    focusTabAfterRender: null, focusGroupAfterRender: null, focusWorkspaceAfterRender: null,
    groupRenderSequence: 0, pinnedTabs, tabsList, pinnedLabel: {}, count: {},
    tabWorkspace: tab => tab.workspace, tabLabel: tab => tab?.label || "New tab", iconFor: () => "",
    renderWorkspaces() {}, resetTabDrag() {}, create, statusGlyph: () => new Element(), controlGlyph: () => new Element(),
    describeTab: () => ({ labels: [], indicators: [], audio: null }), splitOrientation: tab => tab.splitview.orientation,
    FluxionFlowNavigation: require("../chrome/core/flow-navigation.js"),
    FluxionFlowTabContent: require("../chrome/core/flow-tab-content.js"),
    FluxionFlowTree: require("../chrome/core/flow-tree.js"),
    FluxionTabGroups: require("../chrome/core/tab-groups.js"),
    FluxionSplitViews: require("../chrome/core/split-views.js"),
  });
  // Execute the shipped renderer, row event handlers, projections and scheduler
  // together. Only browser services and native DOM are supplied by this fixture.
  vm.runInContext(block("  function renderedTreeItems()", "  function clearTabDropFeedback()") +
    block("  function refreshTabElement(", "  function workspaceSymbol(") +
    block("  function refreshGroupElement(", "  function renderWorkspaces()") +
    block("  function reconcileFlowTabs(", "  const popupSet =") +
    block('  for (const eventName of [\n    "TabOpen",', '  on(gBrowser.tabContainer, "TabSelect", () => {'), context);
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

test("collapsed projections and pending topology changes retain unrelated row identity", () => {
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
  assert.equal(f.row(f.tabs[7]), old, "group membership changes must not rebuild unrelated rows");
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

test("Gecko parent-dispatched multiselection reaches the shipped subscription without a row click", () => {
  const f = fixture(20), original = f.nodes();
  f.gBrowser.addToMultiSelectedTabs(f.tabs[3]); f.flush();
  assert.equal(f.row(f.tabs[3]).classList.contains("is-multiselected"), true);
  assert.equal(f.row(f.tabs[3]).getAttribute("aria-selected"), "true");
  f.gBrowser.addToMultiSelectedTabs(f.tabs[4]); f.flush();
  f.gBrowser.removeFromMultiSelectedTabs(f.tabs[3]); f.flush();
  assert.equal(f.row(f.tabs[3]).getAttribute("aria-selected"), "false");
  assert.equal(f.row(f.tabs[4]).getAttribute("aria-selected"), "true");
  f.gBrowser.clearMultiSelectedTabs(); f.flush();
  assert.equal(f.row(f.tabs[4]).classList.contains("is-multiselected"), false);
  assert.equal(f.row(f.tabs[0]).getAttribute("aria-selected"), "true");
  assert.deepEqual(f.nodes(), original);
});

test("workspace and pin topology changes win over pending selection", () => {
  const f = fixture(8);
  const original = f.row(f.tabs[0]);
  f.tabs[2].pinned = true;
  f.gBrowser.selectedTab = f.tabs[2];
  f.context.scheduleRender({ type: "TabPinned" }); f.flush();
  assert.equal(f.row(f.tabs[0]), original, "unaffected flat row survives pinning another tab");
  assert.equal(f.row(f.tabs[2]).closest(".fluxion-pinned-tabs"), f.pinnedTabs);
  f.tabs[7].workspace = "build"; f.context.currentWorkspace = "build";
  f.gBrowser.selectedTab = f.tabs[7]; f.flush();
  assert.equal(f.nodes().length, 1);
  assert.equal(f.nodes()[0]._fluxionTab, f.tabs[7]);
});

test("1000 flat tabs retain rows and close controls across native open, close and reorder", () => {
  const f = fixture(), original = f.nodes(), closes = original.map(row => row._fluxionParts.close);
  const originalWrites = original.map(row => row.writes);
  const added = { ...f.tabs[9], label: "Added", linkedBrowser: { currentURI: { displaySpec: "https://new.example/" } } };
  f.tabs.push(added); f.context.scheduleRender({ type: "TabOpen", target: added }); f.flush();
  for (let index = 0; index < original.length; index++) {
    assert.equal(f.row(f.tabs[index]), original[index]);
    assert.equal(original[index]._fluxionParts.close, closes[index]);
    assert.equal(original[index].writes, originalWrites[index]);
  }
  const addedRow = f.row(added); f.tabs.splice(f.tabs.indexOf(added), 1); added.parentNode = null;
  f.context.scheduleRender({ type: "TabClose", target: added }); f.flush();
  assert.equal(addedRow.isConnected, false); assert.deepEqual(f.nodes(), original);
  const moved = f.tabs.splice(800, 1)[0]; f.tabs.splice(4, 0, moved);
  const beforeMoves = f.tabsList.moves || 0;
  f.context.scheduleRender({ type: "TabMove", target: moved }); f.flush();
  assert.equal(f.nodes()[4], original[800]);
  assert.equal((f.tabsList.moves || 0) - beforeMoves, 1);
  for (const row of original) assert.equal(f.row(row._fluxionTab), row);
  f.tabs.splice(4, 1); f.tabs.splice(950, 0, moved);
  const beforeForward = f.tabsList.moves;
  f.context.scheduleRender({ type: "TabMove", target: moved }); f.flush();
  assert.equal(f.nodes()[950], original[800]);
  assert.equal(f.tabsList.moves - beforeForward, 1, "moving toward the end must not relocate unaffected siblings");
});

test("flat structural updates preserve exact focused close/audio controls and fallback insertion focus", () => {
  const f = fixture(20), row = f.row(f.tabs[8]);
  row._fluxionParts.close.focus();
  const moved = f.tabs.splice(8, 1)[0]; f.tabs.splice(2, 0, moved);
  f.context.scheduleRender({ type: "TabMove", target: moved }); f.flush();
  assert.equal(f.document.activeElement, row._fluxionParts.close);
  // Model an older Gecko without state-preserving moveBefore.
  const nativeMove = f.tabsList.moveBefore.bind(f.tabsList);
  f.tabsList.moveBefore = undefined;
  f.tabsList.insertBefore = (child, before) => {
    if (child.contains(f.document.activeElement)) f.document.activeElement = null;
    nativeMove(child, before);
  };
  const audio = row._fluxionParts.audio;
  f.context.describeTab = () => ({ labels: [], indicators: [], audio: { kind: "playing", action: "Mute tab" } });
  f.context.refreshTabElement(moved, row); audio.focus();
  f.tabs.splice(2, 1); f.tabs.unshift(moved);
  f.context.scheduleRender({ type: "TabMove", target: moved }); f.flush();
  assert.equal(f.document.activeElement, audio);
  assert.equal(f.row(moved), row);
});

test("pin role changes replace only affected row and retain independent tree tab stops", () => {
  const f = fixture(10), original = f.nodes();
  f.tabs[4].pinned = true;
  f.context.scheduleRender({ type: "TabPinned", target: f.tabs[4] }); f.flush();
  assert.notEqual(f.row(f.tabs[4]), original[4]);
  assert.equal(f.row(f.tabs[4]).getAttribute("role"), "tab");
  for (let index = 0; index < 10; index++) if (index !== 4) assert.equal(f.row(f.tabs[index]), original[index]);
  for (const container of [f.pinnedTabs, f.tabsList]) assert.equal(container.children.filter(row => row.tabIndex === 0).length, 1);
  const pinned = f.row(f.tabs[4]); f.tabs[4].pinned = false;
  f.context.scheduleRender({ type: "TabUnpinned", target: f.tabs[4] }); f.flush();
  assert.notEqual(f.row(f.tabs[4]), pinned);
  assert.equal(f.row(f.tabs[4]).getAttribute("role"), "treeitem");
  assert.equal(f.tabsList.children.filter(row => row.tabIndex === 0).length, 1);
});

test("native split creation and removal retain unrelated and member rows across wrapper changes", () => {
  const f = fixture(12), original = f.row(f.tabs[8]);
  const member = f.row(f.tabs[2]), close = member._fluxionParts.close;
  const split = { tabs: [f.tabs[2], f.tabs[3]], orientation: "side-by-side", hasActiveTab: false };
  for (const tab of split.tabs) tab.splitview = split;
  f.context.scheduleRender({ type: "SplitViewCreated" }); f.flush();
  assert.equal(f.row(f.tabs[8]), original);
  assert.equal(f.row(f.tabs[2]), member);
  assert.equal(f.row(f.tabs[2])._fluxionParts.close, close);
  assert.ok(f.row(f.tabs[2]).closest(".fluxion-split"));
  const grouped = f.row(f.tabs[8]);
  f.context.scheduleRender({ type: "TabMove" }); f.flush();
  assert.equal(f.row(f.tabs[8]), grouped);
  for (const tab of split.tabs) delete tab.splitview;
  const beforeRemoval = f.row(f.tabs[8]);
  f.context.scheduleRender({ type: "SplitViewRemoved" }); f.flush();
  assert.equal(f.row(f.tabs[8]), beforeRemoval);
  assert.equal(f.row(f.tabs[2]), member);
  assert.equal(f.row(f.tabs[2]).closest(".fluxion-split"), null);
  const flat = f.row(f.tabs[8]);
  f.context.scheduleRender({ type: "TabMove" }); f.flush();
  assert.equal(f.row(f.tabs[8]), flat);
});

test("grouping and ungrouping retain member controls, adjust hierarchy and preserve exact close focus", () => {
  const f = fixture(12), member = f.row(f.tabs[2]), neighbor = f.row(f.tabs[9]);
  const close = member._fluxionParts.close; close.focus();
  const group = { id: "group-move", label: "Research", color: "blue", collapsed: false };
  f.tabs[2].group = f.tabs[3].group = group;
  f.context.scheduleRender({ type: "TabGrouped" }); f.flush();
  assert.equal(f.row(f.tabs[2]), member);
  assert.equal(member.getAttribute("aria-level"), "2");
  assert.equal(f.document.activeElement, close);
  assert.equal(f.row(f.tabs[9]), neighbor);
  delete f.tabs[2].group;
  f.context.scheduleRender({ type: "TabUngrouped" }); f.flush();
  assert.equal(f.row(f.tabs[2]), member);
  assert.equal(member.getAttribute("aria-level"), "1");
  assert.equal(member.closest(".fluxion-group"), null);
  assert.equal(f.document.activeElement, close);
  assert.equal(f.row(f.tabs[3]).getAttribute("aria-level"), "2");
});

test("group metadata updates retain heading/container identity and current counts and focus", () => {
  const f = fixture(12), group = { id: "metadata", label: "Research", color: "blue", collapsed: false };
  f.tabs[2].group = f.tabs[3].group = group;
  f.context.scheduleRender(); f.flush();
  const heading = f.context.groupElements.get(group), wrapper = heading.parentNode;
  const content = wrapper.querySelector(".fluxion-group-tabs"), id = content.id;
  heading.focus(); group.label = "Reference"; group.color = "green"; f.tabs[4].group = group;
  f.context.scheduleRender({ type: "TabGroupUpdate" }); f.flush();
  assert.equal(f.context.groupElements.get(group), heading);
  assert.equal(heading.parentNode, wrapper);
  assert.equal(wrapper.querySelector(".fluxion-group-tabs"), content);
  assert.equal(content.id, id);
  assert.equal(heading.getAttribute("aria-controls"), id);
  assert.equal(heading.getAttribute("aria-owns"), id);
  assert.match(heading.getAttribute("aria-label"), /Reference, 3 tabs, expanded/);
  assert.equal(wrapper.querySelector(".fluxion-group-name").textContent, "Reference");
  assert.equal(wrapper.querySelector(".fluxion-group-count").textContent, "3");
  assert.equal(wrapper.style.getPropertyValue("--group-accent"), "#667c69");
  assert.equal(f.document.activeElement, heading);
});

test("collapsed grouped split shows only active pane and keeps unaffected headings and rows stable", () => {
  const f = fixture(12), group = { id: "nested", label: "Comparison", color: "blue", collapsed: false };
  f.tabs[2].group = f.tabs[3].group = f.tabs[4].group = group;
  const split = { tabs: [f.tabs[2], f.tabs[3]], hasActiveTab: true };
  for (const tab of split.tabs) { tab.splitview = split; tab.splitOrientation = "stacked"; }
  f.gBrowser.selectedTab = f.tabs[2]; f.context.scheduleRender(); f.flush();
  const member = f.row(f.tabs[2]), heading = f.context.groupElements.get(group), neighbor = f.row(f.tabs[9]);
  assert.ok(member.closest(".fluxion-split"));
  group.collapsed = true; f.context.scheduleRender({ type: "TabGroupCollapse" }); f.flush();
  assert.equal(f.row(f.tabs[2]), member);
  assert.equal(member.closest(".fluxion-split"), null);
  assert.equal(f.row(f.tabs[3]), undefined);
  assert.equal(f.row(f.tabs[4]), undefined);
  assert.equal(heading.getAttribute("aria-expanded"), "false");
  assert.equal(heading.parentNode.querySelector(".fluxion-group-count").textContent, "+2");
  f.gBrowser.selectedTab = f.tabs[3]; f.flush();
  assert.equal(f.row(f.tabs[2]), undefined);
  assert.ok(f.row(f.tabs[3]));
  assert.equal(f.row(f.tabs[3]).closest(".fluxion-split"), null);
  assert.equal(f.context.groupElements.get(group), heading);
  assert.equal(f.row(f.tabs[9]), neighbor);
  group.collapsed = false; f.context.scheduleRender({ type: "TabGroupExpand" }); f.flush();
  assert.equal(f.row(f.tabs[3]).closest(".fluxion-split").getAttribute("data-orientation"), "stacked");
  assert.equal(heading.parentNode.querySelectorAll(".fluxion-tab").length, 3);
});

test("native collapse returns removed child focus to surviving heading without stealing external focus", () => {
  for (const externalFocus of [false, true]) {
    const f = fixture(10), group = { id: "focus-fallback", label: "Research", collapsed: false };
    f.tabs[2].group = f.tabs[3].group = group;
    f.context.scheduleRender(); f.flush();
    const heading = f.context.groupElements.get(group);
    const close = f.row(f.tabs[2])._fluxionParts.close;
    close.focus();
    let external;
    if (externalFocus) { external = new f.Element(); external.root = true; external.focus(); }
    group.collapsed = true;
    f.context.scheduleRender({ type: "TabGroupCollapse" }); f.flush();
    assert.equal(close.isConnected, false);
    assert.equal(f.document.activeElement, externalFocus ? external : heading);
    assert.equal(f.context.groupElements.get(group), heading);
  }
});

test("split member order and orientation refresh without recreating wrappers or close controls", () => {
  const f = fixture(10), split = { tabs: [f.tabs[2], f.tabs[3]], hasActiveTab: false };
  for (const tab of split.tabs) { tab.splitview = split; tab.splitOrientation = "side-by-side"; }
  f.context.scheduleRender(); f.flush();
  const first = f.row(f.tabs[2]), second = f.row(f.tabs[3]), wrapper = first.parentNode;
  const close = first._fluxionParts.close; close.focus();
  split.tabs.reverse();
  for (const tab of split.tabs) tab.splitOrientation = "stacked";
  f.context.scheduleRender({ type: "SplitViewTabChange" }); f.flush();
  assert.equal(first.parentNode, wrapper); assert.equal(second.parentNode, wrapper);
  assert.deepEqual(wrapper.children, [second, first]);
  assert.equal(wrapper.getAttribute("data-orientation"), "stacked");
  assert.equal(wrapper.getAttribute("aria-label"), "Stacked split view");
  assert.equal(first._fluxionParts.close, close);
  assert.equal(f.document.activeElement, close);
});

test("split projections never move members across separate group containers", () => {
  const f = fixture(10), a = { id: "a", label: "A", collapsed: false }, b = { id: "b", label: "B", collapsed: false };
  f.tabs[2].group = a; f.tabs[3].group = b;
  const split = { tabs: [f.tabs[2], f.tabs[3]], hasActiveTab: false };
  for (const tab of split.tabs) tab.splitview = split;
  f.context.scheduleRender(); f.flush();
  assert.equal(f.row(f.tabs[2]).closest(".fluxion-split"), null);
  assert.equal(f.row(f.tabs[3]).closest(".fluxion-split"), null);
  assert.equal(f.row(f.tabs[2]).closest(".fluxion-group"), f.context.groupElements.get(a).parentNode);
  assert.equal(f.row(f.tabs[3]).closest(".fluxion-group"), f.context.groupElements.get(b).parentNode);
  assert.equal(f.nodes().length, f.tabs.length);
});

test("leaving a workspace removes absent rows and groups; same persisted group id cannot reuse stale handlers", () => {
  const f = fixture(8), oldGroup = { id: "restored-id", label: "Old", color: "blue", collapsed: false };
  f.tabs[2].group = f.tabs[3].group = oldGroup;
  f.context.scheduleRender(); f.flush();
  const oldHeading = f.context.groupElements.get(oldGroup), oldRow = f.row(f.tabs[2]);
  for (const tab of f.tabs) tab.workspace = "other";
  f.context.scheduleRender(); f.flush();
  assert.equal(f.nodes().length, 0); assert.equal(oldHeading.isConnected, false);
  assert.equal(oldRow.isConnected, false); assert.equal(f.context.groupElements.size, 0);
  const restored = { ...oldGroup, label: "Restored" };
  for (const tab of f.tabs) tab.workspace = "focus";
  f.tabs[2].group = f.tabs[3].group = restored;
  f.context.scheduleRender(); f.flush();
  const heading = f.context.groupElements.get(restored);
  assert.ok(heading); assert.notEqual(heading, oldHeading);
  assert.equal(f.context.groupElements.has(oldGroup), false);
  heading.emit("click"); f.flush();
  assert.equal(restored.collapsed, true); assert.equal(oldGroup.collapsed, false);
});

test("arbitrary flat reorder batches produce native order without losing row identity", () => {
  const f = fixture(50), original = new Map(f.tabs.map(tab => [tab, f.row(tab)]));
  f.tabs.reverse(); f.context.scheduleRender({ type: "TabMove" }); f.flush();
  assert.deepEqual(f.nodes().map(row => row._fluxionTab), f.tabs);
  const evens = f.tabs.filter((_, index) => index % 2 === 0), odds = f.tabs.filter((_, index) => index % 2 !== 0);
  f.tabs.splice(0, f.tabs.length, ...odds, ...evens);
  f.context.scheduleRender({ type: "TabMove" }); f.flush();
  assert.deepEqual(f.nodes().map(row => row._fluxionTab), f.tabs);
  for (const tab of f.tabs) assert.equal(f.row(tab), original.get(tab));
});

test("adjacent forward LIS ties may move the equivalent neighbor while preserving identity and focus", () => {
  const f = fixture(8), moved = f.tabs[2], neighbor = f.tabs[3];
  const movedRow = f.row(moved), neighborRow = f.row(neighbor);
  f.gBrowser.selectedTab = neighbor; f.flush();
  neighborRow._fluxionParts.close.focus();
  const rows = f.nodes(), writes = rows.map(row => row.writes), relocations = [];
  const moveBefore = f.tabsList.moveBefore.bind(f.tabsList);
  f.tabsList.moveBefore = (row, before) => { relocations.push(row); moveBefore(row, before); };
  f.tabs.splice(2, 2, neighbor, moved);
  f.context.scheduleRender({ type: "TabMove", target: moved }); f.flush();
  // Both one-node edits are minimal. The deterministic LIS keeps A and moves
  // B before it, rather than promising that only native event.target is moved.
  assert.deepEqual(relocations, [neighborRow]);
  assert.equal(f.nodes()[2], neighborRow); assert.equal(f.nodes()[3], movedRow);
  assert.equal(f.document.activeElement, neighborRow._fluxionParts.close);
  for (let index = 0; index < rows.length; index++) {
    assert.equal(f.row(rows[index]._fluxionTab), rows[index]);
    assert.equal(rows[index].writes, writes[index]);
  }
  assert.equal(f.gBrowser.selectedTab, neighbor);
});

test("existing pinned controls keep focus and identity while membership and pin order update ARIA", () => {
  const f = fixture(14);
  for (const tab of f.tabs.slice(0, 3)) tab.pinned = true;
  f.context.scheduleRender({ type: "TabPinned", target: f.tabs[2] }); f.flush();
  const pinned = f.tabs.slice(0, 3), identities = new Map(pinned.map(tab => [tab, f.row(tab)]));
  const controls = new Map(pinned.map(tab => [tab, f.row(tab)._fluxionParts.close]));
  f.gBrowser.selectedTab = pinned[1]; f.flush();
  controls.get(pinned[1]).focus();
  const treeIdentities = new Map(f.tabs.slice(3).map(tab => [tab, f.row(tab)]));
  const verify = expected => {
    assert.deepEqual(f.pinnedTabs.children.map(row => row._fluxionTab), expected);
    for (let index = 0; index < expected.length; index++) {
      const row = f.row(expected[index]);
      assert.equal(row.getAttribute("role"), "tab");
      assert.equal(row.getAttribute("aria-posinset"), String(index + 1));
      assert.equal(row.getAttribute("aria-setsize"), String(expected.length));
    }
    for (const tab of pinned) {
      assert.equal(f.row(tab), identities.get(tab));
      assert.equal(f.row(tab)._fluxionParts.close, controls.get(tab));
    }
    assert.equal(f.document.activeElement, controls.get(pinned[1]));
    for (const container of [f.pinnedTabs, f.tabsList]) {
      assert.equal(container.children.filter(row => row.tabIndex === 0).length, 1);
    }
  };
  verify(pinned);

  const added = f.tabs[8], oldOrdinaryRow = f.row(added);
  added.pinned = true;
  f.tabs.splice(f.tabs.indexOf(added), 1); f.tabs.splice(1, 0, added);
  f.context.scheduleRender({ type: "TabPinned", target: added }); f.flush();
  verify([pinned[0], added, pinned[1], pinned[2]]);
  assert.notEqual(f.row(added), oldOrdinaryRow);
  for (const [tab, row] of treeIdentities) if (tab !== added) assert.equal(f.row(tab), row);

  const addedPinRow = f.row(added);
  f.tabs.splice(f.tabs.indexOf(pinned[2]), 1); f.tabs.unshift(pinned[2]);
  f.context.scheduleRender({ type: "TabMove", target: pinned[2] }); f.flush();
  verify([pinned[2], pinned[0], added, pinned[1]]);
  assert.equal(f.row(added), addedPinRow);

  added.pinned = false;
  f.tabs.splice(f.tabs.indexOf(added), 1); f.tabs.push(added);
  f.context.scheduleRender({ type: "TabUnpinned", target: added }); f.flush();
  verify([pinned[2], pinned[0], pinned[1]]);
  assert.notEqual(f.row(added), addedPinRow);
  assert.equal(f.row(added).getAttribute("role"), "treeitem");
  assert.equal(f.row(added).getAttribute("aria-posinset"), null);
  assert.equal(f.row(added).getAttribute("aria-setsize"), null);
});

test("structural measurements must establish focused-owner roving state before collecting mutations", () => {
  const stale = fixture(30);
  stale.gBrowser.selectedTab = stale.tabs[13]; stale.flush();
  stale.row(stale.tabs[13])._fluxionParts.close.focus();
  stale.gBrowser.selectedTab = stale.tabs[2]; stale.flush();
  assert.equal(stale.row(stale.tabs[13]).tabIndex, 0, "native selection preserves the existing focused tree entry");
  assert.equal(stale.row(stale.tabs[2]).tabIndex, -1);
  stale.row(stale.tabs[2])._fluxionParts.close.focus();
  const beforeStale = stale.row(stale.tabs[13]).writes;
  stale.tabs[20].pinned = true;
  stale.context.scheduleRender({ type: "TabPinned", target: stale.tabs[20] }); stale.flush();
  assert.equal(stale.row(stale.tabs[13]).writes, beforeStale + 1,
    "focusing after selection defers legitimate roving reconciliation into the next render");

  const ready = fixture(30);
  ready.gBrowser.selectedTab = ready.tabs[13]; ready.flush();
  ready.row(ready.tabs[13])._fluxionParts.close.focus();
  const owner = ready.tabs[2], control = ready.row(owner)._fluxionParts.close;
  control.focus();
  ready.gBrowser.selectedTab = owner; ready.flush();
  assert.equal(ready.document.activeElement, control);
  assert.equal(ready.gBrowser.selectedTab, owner);
  assert.equal(ready.row(owner).tabIndex, 0, "focus-before-selection settles the exact measured keyboard entry");
  const original = ready.nodes().map(row => [row, row.writes]);
  ready.tabs[20].pinned = true;
  ready.context.scheduleRender({ type: "TabPinned", target: ready.tabs[20] }); ready.flush();
  for (const [row, writes] of original) {
    if (row._fluxionTab === ready.tabs[20]) continue;
    assert.equal(ready.row(row._fluxionTab), row);
    assert.equal(row.writes, writes);
  }
  assert.equal(ready.document.activeElement, control);
});

test("shipped Enter establishes requested row focus despite Gecko moving focus during native selection", () => {
  const f = fixture(30);
  f.gBrowser.selectedTab = f.tabs[13]; f.flush();
  f.row(f.tabs[13])._fluxionParts.close.focus();
  const owner = f.tabs[2], row = f.row(owner), close = row._fluxionParts.close;
  row.focus();
  row.emit("keydown", { key: "Enter" });
  // Native gBrowser may focus the selected browser synchronously. The shipped
  // keyboard request must survive that focus movement until its render frame.
  const browserFocus = new f.Element(); browserFocus.root = true; browserFocus.focus();
  f.flush();
  assert.equal(f.gBrowser.selectedTab, owner);
  assert.equal(f.document.activeElement, row);
  assert.equal(row.tabIndex, 0);
  assert.equal(f.row(f.tabs[13]).tabIndex, -1);
  close.focus(); f.flush();
  assert.equal(f.document.activeElement, close); assert.equal(row.tabIndex, 0);
  const before = f.nodes().map(item => [item, item.writes]);
  f.tabs[20].pinned = true;
  f.context.scheduleRender({ type: "TabPinned", target: f.tabs[20] }); f.flush();
  for (const [item, writes] of before) {
    if (item._fluxionTab === f.tabs[20]) continue;
    assert.equal(f.row(item._fluxionTab), item); assert.equal(item.writes, writes);
  }
  assert.equal(f.document.activeElement, close);
});
