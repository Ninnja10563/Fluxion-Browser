"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../chrome/fluxion-product-chrome-verification.js"), "utf8");
const first = source.indexOf("  function workspaceMenuEvidence("), last = source.indexOf("  async function nativeWorkspaceKey(", first);
assert.ok(first > 0 && last > first);

function fixture({ count = 1, currentIndex = 0 } = {}) {
  const workspaces = [{ id: "focus", name: "Focus" }, { id: "research", name: "Research" }].slice(0, count);
  const node = (label, attributes = {}, localName = "menuitem") => ({
    localName, hidden: false, attributes: { label, ...attributes },
    getAttribute(name) { return this.attributes[name] ?? null; },
    querySelector(selector) { return selector === "menupopup" && this.localName === "menu" ? { children: [{}, {}] } : null; },
  });
  const menu = { state: "open", isNativeMenu: true, children: [
    node("Rename Workspace…"), node("Change Icon", {}, "menu"), node("Change Accent", {}, "menu"), node("Edit Workspace Theme…"),
    ...workspaces.map((workspace, index) => node(workspace.name, {
      type: "radio", name: "fluxion-workspace-switch", checked: String(index === currentIndex),
    })),
    node("Move Workspace Earlier", { disabled: String(currentIndex === 0) }),
    node("Move Workspace Later", { disabled: String(currentIndex === count - 1) }),
    node("New Workspace…"), node("Delete Workspace…", { disabled: String(count === 1) }),
  ] };
  const sandbox = vm.createContext({ assert(value, message) { if (!value) throw Error(message); } });
  vm.runInContext(source.slice(first, last), sandbox);
  return { menu, workspaces, item: label => menu.children.find(item => item.getAttribute("label") === label),
    run: () => sandbox.workspaceMenuEvidence(menu, workspaces, workspaces[currentIndex].id) };
}

test("native workspace evidence accepts last-workspace safety and actual radio state", () => {
  const h = fixture(), evidence = h.run();
  assert.equal(evidence.state, "open");
  assert.equal(evidence.items.find(item => item.label === "Delete Workspace…").disabled, true);
  assert.equal(evidence.items.find(item => item.label === "Focus").checked, true);
});

test("native workspace evidence requires refreshed radio choices and boundary-sensitive commands", () => {
  for (const currentIndex of [0, 1]) {
    const h = fixture({ count: 2, currentIndex }), evidence = h.run();
    assert.equal(evidence.items.filter(item => item.name === "fluxion-workspace-switch").length, 2);
    assert.equal(evidence.items.find(item => item.label === "Delete Workspace…").disabled, false);
    assert.equal(evidence.items.find(item => item.label === "Move Workspace Earlier").disabled, currentIndex === 0);
  }
});

test("native menu assertion rejects stale entries, selection, order and unpopulated appearance submenus", () => {
  const changes = [
    h => { h.menu.children = h.menu.children.filter(item => item.getAttribute("label") !== "Research"); },
    h => { h.item("Research").attributes.checked = "true"; },
    h => { h.item("Research").attributes.label = "Old workspace name"; },
    h => { h.item("Focus").attributes.type = "checkbox"; },
    h => { h.item("Change Icon").querySelector = () => ({ children: [] }); },
    h => { h.item("Change Accent").localName = "menuitem"; },
    h => { h.item("Rename Workspace…").hidden = true; },
    h => { h.menu.state = "closed"; },
  ];
  for (const change of changes) {
    const h = fixture({ count: 2 }); change(h);
    assert.throws(h.run, /Workspace|workspace/);
  }
});

test("native menu assertion refuses unsafe deletion, unavailable creation and wrong reorder boundaries", () => {
  for (const [label, value] of [["Delete Workspace…", "false"], ["Move Workspace Earlier", "false"],
    ["Move Workspace Later", "false"], ["New Workspace…", "true"]]) {
    const h = fixture(); h.item(label).attributes.disabled = value;
    assert.throws(h.run, /Workspace|workspace/);
  }
});

function dockFixture(boxes) {
  const start = source.indexOf("  function workspaceDock("), end = source.indexOf("  async function workspaceHeading(", start);
  assert.ok(start > 0 && end > start);
  const buttons = boxes.map(box => ({ ...box, querySelector: () => ({ ...box, left: box.left + 6, right: box.right - 6 }) }));
  const flow = { left: 0, right: 232, top: 0, bottom: 800, querySelectorAll: () => buttons };
  const report = {};
  const sandbox = vm.createContext({ report, document: { getElementById: () => flow }, rect: node => node,
    painted: () => true, assert(value, message) { if (!value) throw Error(message); },
    contains: (outer, box) => box.left >= outer.left && box.right <= outer.right && box.top >= outer.top && box.bottom <= outer.bottom,
    overlaps: (a, b) => Math.min(a.right, b.right) > Math.max(a.left, b.left) && Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top),
  });
  vm.runInContext(source.slice(start, end), sandbox);
  return { run: count => sandbox.workspaceDock(count), report };
}

test("native dock gate measures symbol-group center for one and two workspaces", () => {
  for (const boxes of [[{ left: 101, right: 131, top: 760, bottom: 790 }],
    [{ left: 85, right: 115, top: 760, bottom: 790 }, { left: 117, right: 147, top: 760, bottom: 790 }]]) {
    const h = dockFixture(boxes); h.run(boxes.length);
    assert.equal(h.report.workspaceDock[0].offset, 0);
  }
});

test("native dock gate rejects shifted, overlapping, clipped or stale workspace symbols", () => {
  const scenarios = [
    { boxes: [{ left: 95, right: 125, top: 760, bottom: 790 }], count: 1 },
    { boxes: [{ left: 91, right: 121, top: 760, bottom: 790 }, { left: 111, right: 141, top: 760, bottom: 790 }], count: 2 },
    { boxes: [{ left: 101, right: 131, top: 780, bottom: 810 }], count: 1 },
    { boxes: [{ left: 101, right: 131, top: 760, bottom: 790 }], count: 2 },
  ];
  for (const { boxes, count } of scenarios) assert.throws(() => dockFixture(boxes).run(count), /workspace|Workspace|Centered/);
});
