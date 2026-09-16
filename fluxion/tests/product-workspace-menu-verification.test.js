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
    hasAttribute(name) { return Object.hasOwn(this.attributes, name); },
    querySelector(selector) { return selector === "menupopup" && this.localName === "menu" ? { children: [{}, {}] } : null; },
  });
  const menu = { state: "open", isNativeMenu: true, children: [
    node("Rename Workspace…"), node("Change Icon", {}, "menu"), node("Workspace Appearance…"),
    ...workspaces.map((workspace, index) => node(workspace.name, {
      type: "radio", name: "fluxion-workspace-switch", checked: String(index === currentIndex),
    })),
    node("Move Workspace Earlier", { disabled: String(currentIndex === 0) }),
    node("Move Workspace Later", { disabled: String(currentIndex === count - 1) }),
    node("New Workspace…"), node("Delete Workspace…", { disabled: String(count === 1) }),
  ] };
  for (const item of menu.children) for (const key of ["disabled", "checked"]) {
    if (item.attributes[key] === "false") delete item.attributes[key];
  }
  menu.querySelectorAll = () => menu.children;
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
    h => { h.item("Workspace Appearance…").attributes.label = "Change Accent"; },
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

test("native menu assertion rejects false-valued boolean attributes that mislead Cocoa rendering", () => {
  for (const [label, key] of [["New Workspace…", "disabled"], ["Research", "checked"]]) {
    const h = fixture({ count: 2 }); h.item(label).attributes[key] = "false";
    assert.throws(h.run, /must remove false/);
  }
});

function activationFixture({ untrusted = false, wrongActivation = false } = {}) {
  const start = source.indexOf("  async function activateWorkspaceRadio("), end = source.indexOf("  function workspaceDock(", start);
  assert.ok(start > 0 && end > start);
  const h = fixture({ count: 2 });
  let observe, selectedIndex = -1, current = "focus";
  h.menu.state = "closed";
  h.menu.addEventListener = (_type, listener) => { observe = listener; };
  h.menu.removeEventListener = () => { observe = null; };
  for (const item of h.menu.children) {
    item.parentNode = h.menu;
    item.disabled = item.getAttribute("disabled") === "true";
  }
  const enabled = h.menu.children.filter(item => !item.disabled), keys = [], report = { workspaceHeading: {} };
  const sandbox = vm.createContext({ report,
    window: { FluxionUI: { workspaces: () => h.workspaces, currentWorkspace: () => current, switchWorkspace: id => { current = id; } } },
    assert(value, message) { if (!value) throw Error(message); },
    wait(predicate, message) { if (!predicate()) throw Error(message); }, delay() {},
    async nativeWorkspaceKey(action) {
      keys.push(action);
      if (action === "select-open") { h.menu.state = "open"; return; }
      if (action === "select-return") { h.menu.state = "closed"; if (!wrongActivation) current = "research"; return; }
      const target = enabled[++selectedIndex];
      if (target.localName === "menuitem") observe({ target, isTrusted: !untrusted });
    },
  });
  vm.runInContext(source.slice(start, end), sandbox);
  return { run: () => sandbox.activateWorkspaceRadio(h.menu, { focus() {} }, "research"), keys, report,
    current: () => current, listenerRemoved: () => observe === null };
}

test("native workspace activation waits for observed leaves before Return and restores fixture workspace", async () => {
  const h = activationFixture(); await h.run();
  assert.equal(h.report.workspaceHeading.activation.activated, "research");
  assert.deepEqual(Array.from(h.report.workspaceHeading.activation.highlighted),
    ["Rename Workspace…", "Workspace Appearance…", "Focus", "Research"]);
  assert.equal(h.keys.at(-1), "select-return");
  assert.equal(h.current(), "focus");
  assert.equal(h.listenerRemoved(), true);
});

test("native workspace activation rejects untrusted selection and a Return that changes no workspace", async () => {
  const untrusted = activationFixture({ untrusted: true });
  await assert.rejects(untrusted.run(), /first highlighted leaf/);
  assert.equal(untrusted.keys.includes("select-return"), false);
  assert.equal(untrusted.listenerRemoved(), true);
  const unchanged = activationFixture({ wrongActivation: true });
  await assert.rejects(unchanged.run(), /did not activate/);
  assert.equal(unchanged.report.workspaceHeading.activation.activated, undefined);
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

test("bookmarks palette gate compares actual painted sidebar surface, not its transparent layout rail", () => {
  const start = source.indexOf("  function bookmarksSurface("), end = source.indexOf("  function sidebarColumns(", start);
  assert.ok(start > 0 && end > start);
  const style = { backgroundColor: "rgb(31, 31, 31)", color: "rgb(239, 239, 235)", boxShadow: "none",
    borderTopWidth: "0px", borderRightWidth: "0px", borderBottomWidth: "0px", borderLeftWidth: "0px" };
  const nodes = { "#PersonalToolbar": { style: { ...style } }, "#nav-bar": { style: { ...style } },
    "#fluxion-flow": { style: { ...style, backgroundColor: "rgba(0, 0, 0, 0)" } },
    "#fluxion-flow > .fluxion-surface": { style: { ...style } } };
  const report = {}, context = vm.createContext({ report, painted: Boolean,
    document: { querySelector: selector => nodes[selector] }, window: { getComputedStyle: node => node.style },
    assert(value, message) { if (!value) throw Error(message); } });
  vm.runInContext(source.slice(start, end), context);
  context.bookmarksSurface("dark");
  assert.equal(report.bookmarksSurfaces[0].surfaces[2].id, "#fluxion-flow > .fluxion-surface");
  nodes["#PersonalToolbar"].style.backgroundColor = "rgb(42, 41, 50)";
  assert.throws(() => context.bookmarksSurface("mismatch"), /does not match/);
  nodes["#PersonalToolbar"].style.backgroundColor = style.backgroundColor;
  nodes["#PersonalToolbar"].style.borderBottomWidth = "1px";
  assert.throws(() => context.bookmarksSurface("separator"), /separator/);
});

test("bookmark preview gate awaits actual native color convergence and rejects a persistent mismatch", async () => {
  const start = source.indexOf("  function bookmarksSurface("), end = source.indexOf("  function sidebarColumns(", start);
  for (const persistent of [false, true]) {
    const style = { backgroundColor: "rgb(233, 234, 231)", boxShadow: "none",
      borderTopWidth: "0px", borderRightWidth: "0px", borderBottomWidth: "0px", borderLeftWidth: "0px" };
    const bookmarks = { style: { ...style, backgroundColor: "rgb(31, 31, 31)" } }, node = { style };
    let now = 0, attempts = 0;
    const report = {}, context = vm.createContext({ report, painted: Boolean,
      document: { querySelector: selector => selector === "#PersonalToolbar" ? bookmarks : node },
      window: { performance: { now: () => now }, getComputedStyle: target => target.style },
      async wait(condition, message, timeout) {
        assert.equal(timeout, 2000);
        while (!condition()) {
          attempts++; now += 50;
          if (now >= timeout) throw Error(message);
          if (!persistent && now >= 100) bookmarks.style.backgroundColor = style.backgroundColor;
        }
      }, assert(value, message) { if (!value) throw Error(message); } });
    vm.runInContext(source.slice(start, end), context);
    if (persistent) {
      await assert.rejects(context.settledBookmarksSurface("light"), /did not converge/);
      assert.equal(report.bookmarksSurfaces, undefined, "failed convergence cannot emit passing surface evidence");
    } else {
      await context.settledBookmarksSurface("light");
      assert.equal(attempts, 2);
      assert.equal(report.bookmarksPaintConvergence[0].elapsed, 100);
      assert.ok(report.bookmarksSurfaces[0].surfaces.every(surface => surface.background === style.backgroundColor));
    }
  }
});
