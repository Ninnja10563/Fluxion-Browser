"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../chrome/fluxion-chrome.js"), "utf8");
function block(start, end) {
  const first = source.indexOf(start), last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first, `Missing shipped source boundaries: ${start}`);
  return source.slice(first, last);
}
function fixture() {
  class Element {
    constructor() { this.listeners = new Map(); this.attributes = new Map(); this.dataset = {}; }
    addEventListener(type, handler) { this.listeners.set(type, handler); }
    setAttribute(name, value) { this.attributes.set(name, value); }
    removeAttribute(name) {
      this.attributes.delete(name);
      const key = name.replace(/^data-/, "").replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      delete this.dataset[key];
    }
    closest() { return null; }
    contains(value) { return value === this; }
    getBoundingClientRect() { return { top: 0, left: 0, width: 200, height: 40 }; }
    emit(type, options = {}) {
      const event = { clientX: 100, clientY: 20, dataTransfer: { data: new Map(), setData(key, value) { this.data.set(key, value); } },
        prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...options };
      this.listeners.get(type)?.(event); return event;
    }
  }
  const tabs = Array.from({ length: 8 }, (_, id) => ({ id, label: `Tab ${id}`, parentNode: {}, isConnected: true, workspace: "focus" }));
  const calls = [], moves = [], splits = [];
  let failNative = false;
  const group = { tabs: tabs.slice(0, 2), parentNode: {}, isConnected: true, label: "Source" };
  const target = { tabs: tabs.slice(4, 6), parentNode: {}, isConnected: true, label: "Target", addTabs(units) {
    if (failNative) throw new Error("native grouping failed"); calls.push(Array.from(units));
  } };
  for (const tab of group.tabs) tab.group = group;
  for (const tab of target.tabs) tab.group = target;
  const split = { tabs: tabs.slice(2, 4), parentNode: {}, isConnected: true };
  for (const tab of split.tabs) tab.splitview = split;
  const context = vm.createContext({ dragTab: null, dragTabs: [], dragGroup: null, dragTargetElement: null,
    dragAnnouncement: { textContent: "" }, currentWorkspace: "focus", tabElements: new Map(),
    tabWorkspace: tab => tab.workspace, tabLabel: tab => tab.label, contextTabs: tab => [tab], scheduleRender() {},
    window: { getComputedStyle: () => ({ direction: "ltr" }) },
    gBrowser: { tabs, moveTabBefore(a, b) { if (failNative) throw new Error("native move failed"); moves.push([a, b, "before"]); },
      moveTabAfter(a, b) { if (failNative) throw new Error("native move failed"); moves.push([a, b, "after"]); } },
    applyTabDrop: (moving, destination, intent) => splits.push({ moving: Array.from(moving), destination, intent }),
    FluxionFlowDrag: require("../chrome/core/flow-drag.js"), FluxionTabDrop: require("../chrome/core/tab-drop.js"),
    FluxionSplitViews: require("../chrome/core/split-views.js"),
  });
  // Run actual shipped registration closures plus their planning/feedback and
  // keyboard-menu functions. Native mutation is a recorder, not browser proof.
  vm.runInContext(block("  function clearTabDropFeedback()", "  function reorderTabsAt(") +
    block("  function adjacentGroupTarget(", "  function workspaceSnapshot()") +
    `function installTab(tab,item) {${block('    item.addEventListener("dragstart",', '    tabElements.set(tab, item);')}}\n` +
    `function installGroup(group,heading) {${block('    heading.addEventListener("dragstart",', '    const groupTabs = create(')}}`, context);
  const rows = tabs.map(tab => { const element = new Element(); context.installTab(tab, element); return element; });
  const heading = new Element(), sourceHeading = new Element();
  context.installGroup(target, heading); context.installGroup(group, sourceHeading);
  return { tabs, group, target, split, rows, heading, sourceHeading, context, calls, moves, splits,
    fail() { failNative = true; } };
}
function reset(f) {
  assert.equal(f.context.dragTab, null); assert.equal(f.context.dragGroup, null);
  assert.equal(f.context.dragTabs.length, 0); assert.equal(f.context.dragTargetElement, null);
  assert.equal(f.context.dragAnnouncement.textContent, "");
}
test("actual pane drag handlers pass one intact native split wrapper to the group and reset", () => {
  for (const index of [2, 3]) {
    const f = fixture(); f.rows[index].emit("dragstart");
    const over = f.heading.emit("dragover");
    assert.equal(over.prevented, true); assert.equal(over.dataTransfer.dropEffect, "move");
    f.heading.emit("drop");
    assert.deepEqual(f.calls, [[f.split]]); assert.equal(f.moves.length, 0); reset(f);
  }
});
test("external text without a local drag cannot group, reorder or split tabs", () => {
  const f = fixture();
  assert.equal(f.heading.emit("dragover").prevented, false);
  f.heading.emit("drop"); f.rows[6].emit("drop");
  assert.equal(f.calls.length + f.moves.length + f.splits.length, 0); reset(f);
});
test("group drag uses reorder path, while ordinary tab center drop retains split intent", () => {
  const f = fixture();
  const start = f.sourceHeading.emit("dragstart");
  assert.equal(start.stopped, true); assert.equal(start.dataTransfer.data.get("application/x-fluxion-group"), "group");
  f.rows[6].emit("dragover", { clientY: 30 }); f.rows[6].emit("drop", { clientY: 30 });
  assert.deepEqual(f.moves, [[f.group, f.tabs[6], "after"]]); assert.equal(f.splits.length, 0); reset(f);
  f.rows[6].emit("dragstart"); f.rows[7].emit("drop");
  assert.equal(f.splits.length, 1); assert.equal(f.splits[0].intent.action, "split"); reset(f);
});
test("native grouping and movement exceptions still clear state and insertion feedback", () => {
  for (const movingGroup of [false, true]) {
    const f = fixture();
    (movingGroup ? f.sourceHeading : f.rows[2]).emit("dragstart"); f.heading.emit("dragover"); f.fail();
    assert.throws(() => f.heading.emit("drop"), /native .* failed/);
    assert.equal(f.heading.attributes.has("data-dragover"), false); reset(f);
  }
});
test("drop revalidates changed workspace or closed source and dragend always clears feedback", () => {
  for (const invalidate of [f => { f.tabs[3].workspace = "other"; }, f => { f.tabs[3].closing = true; }]) {
    const f = fixture(); f.rows[2].emit("dragstart"); f.heading.emit("dragover"); invalidate(f); f.heading.emit("drop");
    assert.equal(f.calls.length, 0); reset(f);
  }
  const f = fixture(); f.sourceHeading.emit("dragstart"); f.rows[6].emit("dragover");
  f.sourceHeading.emit("dragend"); reset(f);
});
test("keyboard menu reorder finds an adjacent ordinary target even when there is only one group", () => {
  const f = fixture();
  for (const tab of f.target.tabs) delete tab.group;
  for (const tab of f.split.tabs) delete tab.splitview;
  assert.equal(f.context.adjacentGroupTarget(f.group, -1), null);
  assert.equal(f.context.adjacentGroupTarget(f.group, 1), f.tabs[2]);
  f.context.reorderGroup(f.group, 1);
  assert.deepEqual(f.moves, [[f.group, f.tabs[2], "after"]]);
});
