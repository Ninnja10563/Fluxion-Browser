"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../chrome/fluxion-chrome.js"), "utf8");
function block(start, end) {
  const first = source.indexOf(start), last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first);
  return source.slice(first, last);
}

function fixture() {
  const frames = [], cleanup = [];
  const document = { body: {}, documentElement: {}, focused: true, hasFocus() { return this.focused; } };
  class Node {
    constructor(name) { this.name = name; this.listeners = new Map(); this.isConnected = true;
      this.attrs = {}; this.dataset = {}; this.state = "closed"; this.children = []; }
    setAttribute(name, value) { this.attrs[name] = String(value); }
    removeAttribute(name) { delete this.attrs[name]; }
    getAttribute(name) { return this.attrs[name] ?? null; }
    get nextSibling() { return this.parent?.children[this.parent.children.indexOf(this) + 1] || null; }
    appendChild(node) { this.insertBefore(node, null); return node; }
    insertBefore(node, before) {
      node.remove(); this.children.splice(before ? this.children.indexOf(before) : this.children.length, 0, node); node.parent = this;
    }
    remove() { if (this.parent?.children) { const index = this.parent.children.indexOf(this); if (index >= 0) this.parent.children.splice(index, 1); } this.parent = null; }
    addEventListener(type, callback, capture = false) {
      const list = this.listeners.get(type) || []; list.push({ callback, capture }); this.listeners.set(type, list);
    }
    removeEventListener(type, callback) {
      this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item.callback !== callback));
    }
    dispatch(type, target = this, detail = {}) {
      const event = { type, target, defaultPrevented: false, stopped: false,
        preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() { this.stopped = true; },
        stopPropagation() { this.stopped = true; }, ...detail };
      for (const { callback } of [...(this.listeners.get(type) || [])].sort((a, b) => Number(b.capture) - Number(a.capture))) {
        callback(event); if (event.stopped) break;
      }
      return event;
    }
    hidePopup() { this.hides = (this.hides || 0) + 1; this.state = "closed"; this.dispatch("popuphidden"); }
    openPopup(...args) { this.openArgs = args; this.state = "open"; this.dispatch("popupshowing"); }
    openPopupAtScreen(...args) { this.screenArgs = args; this.state = "open"; this.dispatch("popupshowing"); }
    focus() { document.activeElement = this; }
    contains(node) { return node === this || node?.parent === this; }
  }
  const flow = new Node("flow"), contextMenu = new Node("tabs"), groupMenu = new Node("groups"), workspaceMenu = new Node("workspaces");
  flow.dataset.state = "expanded";
  const workspaceHeading = new Node("heading"), workspaceMoreButton = new Node("workspace-more");
  workspaceHeading.parent = flow; workspaceMoreButton.parent = workspaceHeading;
  workspaceMoreButton.setAttribute("aria-expanded", "false");
  const a = { parentNode: {}, workspace: "build" }, b = { parentNode: {}, workspace: "build" };
  const tabElements = new Map(), groupElements = new Map(), workspaceElements = new Map();
  const row = (name, parent = flow) => { const node = new Node(name); node.parent = parent; return node; };
  tabElements.set(a, row("a")); tabElements.set(b, row("b"));
  workspaceElements.set("build", row("workspace-build")); workspaceElements.set("focus", row("workspace-focus"));
  const window = { closed: false, requestAnimationFrame: fn => frames.push(fn),
    FluxionFlowMenuSession: require("../chrome/core/flow-menu-session.js") };
  const Services = { focus: { activeWindow: window } };
  const gBrowser = { tabs: [a, b], selectedTabs: [a, b], tabGroups: [] };
  const context = vm.createContext({ window, document, Services, gBrowser, flow, contextMenu, groupMenu, workspaceMenu,
    currentWorkspace: "build", workspaces: [{ id: "build", name: "Build", icon: "diamond", accent: "blue" },
      { id: "focus", name: "Focus", icon: "circle", accent: "slate" }],
    contextTab: a, contextGroup: null, contextWorkspace: "build", flowMenuSession: null,
    contextWorkspaceAnchor: null, workspaceHeading, workspaceMoreButton,
    focusOpenMenus: new Set(), scheduleFocusSurfaceHide() {},
    tabElements, groupElements, workspaceElements, cleanup, newTabButton: row("new-tab"),
    renderedPinnedTabElements: () => [], renderedTreeItems: () => [...tabElements.values(), ...groupElements.values()],
    tabWorkspace: tab => tab.workspace, focusFlowItem: element => element?.focus(),
    on(node, type, callback, capture) { node.addEventListener(type, callback, capture); cleanup.push(() => node.removeEventListener(type, callback)); },
  });
  // Execute shipped handlers, not copies; only the surrounding browser/DOM IO
  // is modeled. Core menu lifecycle and selection are their shipped modules.
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../chrome/core/tab-selection.js"), "utf8"), context);
  vm.runInContext(block("  function contextTabs(", "  function splitOrientation("), context);
  const actions = [];
  vm.runInContext(block("  function setNativeMenuFlag(", "  const xul ="), context);
  Object.assign(context, {
    FluxionWorkspaces: require("../chrome/core/workspaces.js"), FluxionWorkspaceIcons: require("../chrome/core/workspace-icons.js"),
    xul(name, attributes = {}) { const node = new Node(name); for (const [key, value] of Object.entries(attributes)) {
      if (key === "checked" || key === "disabled") context.setNativeMenuFlag(node, key, value === true || value === "true");
      else node.setAttribute(key, value);
    } return node; },
    appendAction(parent, label, callback, attributes = {}) {
      const node = context.xul("menuitem", { label, ...attributes });
      node.addEventListener("command", callback); parent.appendChild(node); return node;
    },
    renameWorkspace: id => actions.push(["rename", id]), reorderWorkspace: (id, direction) => actions.push(["move", id, direction]),
    updateWorkspaceAppearance: (id, appearance) => actions.push(["appearance", id, appearance]),
    deleteWorkspace: id => actions.push(["delete", id]), addWorkspace: () => actions.push(["new"]),
    switchWorkspace: id => { actions.push(["switch", id]); context.currentWorkspace = id; },
  });
  vm.runInContext(block("  function openWorkspaceMenu(", "  popupSet.append(contextMenu, groupMenu, workspaceMenu)"), context);
  vm.runInContext(block("  function initialiseFlowMenus()", "  on(modeButton,"), context);
  tabElements.get(a).focus();
  return { context, window, document, Services, gBrowser, flow, contextMenu, groupMenu, workspaceMenu,
    a, b, tabElements, groupElements, workspaceElements, row, workspaceHeading, workspaceMoreButton, actions,
    activate(item) { const event = workspaceMenu.dispatch("command", item); if (!event.defaultPrevented) item.dispatch("command"); return event; },
    flush() { while (frames.length) frames.shift()(); },
    open() { return contextMenu.dispatch("popupshowing"); },
    dispose() { while (cleanup.length) cleanup.pop()(); },
  };
}

test("real Flow capture keeps exact opened selection through command and ignores submenu hidden", () => {
  const f = fixture(); f.open(); f.gBrowser.selectedTabs = [f.b];
  f.contextMenu.dispatch("popuphidden", {});
  assert.deepEqual(Array.from(f.context.contextTabs()), [f.a, f.b]);
  let observed;
  f.contextMenu.addEventListener("command", () => { observed = f.context.contextTabs(); });
  assert.equal(f.contextMenu.dispatch("command").defaultPrevented, false);
  assert.deepEqual(Array.from(observed), [f.a, f.b]);
  f.contextMenu.dispatch("popuphidden"); f.flush();
  assert.equal(f.context.contextTab, null);
  assert.equal(f.contextMenu.dispatch("command").defaultPrevented, true);
});

test("removed and adopted source nodes reject real command propagation before action", () => {
  for (const kind of ["closed", "adopted"]) {
    const f = fixture(); f.open(); let actions = 0;
    f.contextMenu.addEventListener("command", () => actions++);
    if (kind === "closed") f.a.parentNode = null;
    else f.gBrowser.tabs = [f.b]; // Adopted native tab no longer belongs to this browser.
    const command = f.contextMenu.dispatch("command");
    assert.equal(command.defaultPrevented, true, kind); assert.equal(command.stopped, true, kind);
    assert.equal(actions, 0, kind); assert.equal(f.contextMenu.hides, 1, kind);
    assert.equal(f.context.contextTab, null, kind);
  }
});

test("Escape resolves replacement anchor after structural render rather than detached DOM", () => {
  const f = fixture(); const old = f.tabElements.get(f.a); f.open();
  old.isConnected = false;
  const replacement = f.row("replacement"); f.tabElements.set(f.a, replacement);
  f.document.activeElement = f.document.documentElement;
  f.contextMenu.dispatch("popuphidden"); f.flush();
  assert.ok(f.document.activeElement === replacement);
});

test("command, other-window focus and external controls never receive cancel restoration", () => {
  for (const mode of ["command", "other-window", "external"]) {
    const f = fixture(); f.open();
    const elsewhere = mode === "command" ? f.tabElements.get(f.b) : {};
    if (mode === "command") f.contextMenu.dispatch("command");
    if (mode === "other-window") f.Services.focus.activeWindow = {};
    f.document.activeElement = elsewhere;
    f.contextMenu.dispatch("popuphidden"); f.flush();
    assert.ok(f.document.activeElement === elsewhere, mode);
  }
});

test("dismissal must not steal deliberate focus from a different Flow control", () => {
  const f = fixture(); f.open();
  const other = f.workspaceElements.get("focus");
  other.focus(); f.contextMenu.dispatch("popuphidden"); f.flush();
  assert.ok(f.document.activeElement === other);
});

test("workspace switch invalidates old menu and unload cancels scheduled focus", () => {
  const f = fixture(); f.open();
  f.context.currentWorkspace = "focus";
  assert.equal(f.context.flowMenuSession.reconcile(), false);
  assert.equal(f.contextMenu.hides, 1);
  const neutral = f.document.documentElement; f.document.activeElement = neutral;
  f.dispose(); f.flush(); assert.ok(f.document.activeElement === neutral);
});

test("external group membership and workspace deletion invalidate owned menus", () => {
  const grouped = fixture();
  const group = { tabs: [grouped.a, grouped.b] };
  grouped.a.group = group; grouped.b.group = group;
  grouped.gBrowser.tabGroups = [group]; grouped.context.contextGroup = group;
  grouped.groupElements.set(group, grouped.row("group")); grouped.groupElements.get(group).focus();
  grouped.groupMenu.dispatch("popupshowing");
  group.tabs = [grouped.b]; grouped.a.group = null;
  assert.equal(grouped.groupMenu.dispatch("command").defaultPrevented, true);
  assert.equal(grouped.groupMenu.hides, 1);
  const workspace = fixture();
  workspace.workspaceElements.get("build").focus(); workspace.workspaceMenu.dispatch("popupshowing");
  workspace.context.workspaces = [{ id: "focus" }];
  assert.equal(workspace.workspaceMenu.dispatch("command").defaultPrevented, true);
  assert.equal(workspace.workspaceMenu.hides, 1);
});

test("invalidated missing keyboard anchor falls back to a surviving row only with owned neutral focus", () => {
  const f = fixture(); f.open();
  f.a.parentNode = null; f.gBrowser.tabs = [f.b]; f.tabElements.delete(f.a);
  f.document.activeElement = f.document.documentElement;
  f.context.flowMenuSession.reconcile(); f.flush();
  assert.ok(f.document.activeElement === f.tabElements.get(f.b));
});

test("heading click and ArrowDown open the native workspace menu at the same stable button and Escape restores it", () => {
  for (const type of ["click", "keydown"]) {
    const f = fixture(), button = f.workspaceMoreButton;
    const event = button.dispatch(type, button, { key: "ArrowDown" });
    assert.equal(f.workspaceMenu.openArgs[0], button);
    assert.deepEqual(f.workspaceMenu.openArgs.slice(1, 6), ["after_start", 0, 2, false, false]);
    assert.equal(f.context.flowMenuSession.context(f.workspaceMenu).anchor, button);
    assert.equal(f.context.contextWorkspace, "build");
    assert.equal(button.getAttribute("aria-expanded"), "true");
    assert.equal(f.workspaceHeading.dataset.menuOpen, "true");
    assert.equal(event.defaultPrevented, type === "keydown");
    f.workspaceMenu.dispatch("popuphidden", {});
    assert.equal(button.getAttribute("aria-expanded"), "true", "Submenu dismissal cannot reset the open root menu");
    f.document.activeElement = f.document.documentElement;
    f.workspaceMenu.hidePopup(); f.flush();
    assert.equal(f.document.activeElement, button, "Escape must return to heading options, not the bottom workspace dock");
    assert.equal(button.getAttribute("aria-expanded"), "false");
    assert.equal(f.workspaceHeading.dataset.menuOpen, undefined);
    assert.equal(f.context.contextWorkspaceAnchor, null);
    assert.equal(f.context.contextWorkspace, null);
    assert.equal(f.context.focusOpenMenus.size, 0);
    assert.deepEqual(f.actions, []);
  }
});

test("heading toggle closes an open menu and other keyboard keys keep their native behavior", () => {
  const f = fixture(), button = f.workspaceMoreButton;
  for (const key of ["Tab", "ArrowUp", "Enter", " "]) {
    const event = button.dispatch("keydown", button, { key });
    assert.equal(event.defaultPrevented, false);
    assert.equal(f.workspaceMenu.state, "closed");
  }
  button.dispatch("click");
  button.dispatch("click"); f.flush();
  assert.equal(f.workspaceMenu.hides, 1);
  assert.equal(f.workspaceMenu.state, "closed");
  assert.equal(button.getAttribute("aria-expanded"), "false");
  assert.equal(f.document.activeElement, button);
});

test("heading context menu preserves pointer-owned focus and cannot open a deleted workspace", () => {
  const f = fixture(), external = {};
  f.document.activeElement = external;
  const event = f.workspaceHeading.dispatch("contextmenu", f.workspaceHeading, { button: 2, screenX: 105, screenY: 205 });
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(f.workspaceMenu.screenArgs, [105, 205, true]);
  assert.equal(f.document.activeElement, external);
  f.workspaceMenu.hidePopup(); f.flush();
  assert.equal(f.document.activeElement, external);
  f.context.openWorkspaceMenu("deleted", f.workspaceMoreButton);
  assert.equal(f.workspaceMenu.state, "closed");
  assert.equal(f.context.contextWorkspaceAnchor, null);
});

test("heading menu cancellation does not steal deliberate focus, and fallback avoids hidden or disconnected heading buttons", () => {
  for (const owner of ["other-window", "external", "different-flow", "compact", "disconnected"]) {
    const f = fixture(); f.workspaceMoreButton.dispatch("click");
    const other = owner === "different-flow" ? f.tabElements.get(f.b) : {};
    if (owner === "other-window") f.Services.focus.activeWindow = {};
    const fallback = owner === "compact" || owner === "disconnected";
    if (fallback) {
      if (owner === "compact") f.flow.dataset.state = "compact";
      else f.workspaceMoreButton.isConnected = false;
      f.document.activeElement = f.document.documentElement;
    }
    else f.document.activeElement = other;
    f.workspaceMenu.hidePopup(); f.flush();
    assert.equal(f.document.activeElement, fallback ? f.workspaceElements.get("build") : other, owner);
    assert.equal(f.workspaceMoreButton.getAttribute("aria-expanded"), "false");
  }
});

test("workspace radios rebuild from live order and names, use current checked state and invoke the real switch action", () => {
  const f = fixture(), radios = () => f.workspaceMenu.children.filter(item => item.getAttribute("name") === "fluxion-workspace-switch");
  f.workspaceMoreButton.dispatch("click");
  const old = radios();
  assert.deepEqual(old.map(item => [item.getAttribute("label"), item.getAttribute("checked")]), [["Build", "true"], ["Focus", null]]);
  f.workspaceMenu.hidePopup(); f.flush();
  f.context.workspaces = [f.context.workspaces[1], { ...f.context.workspaces[0], name: "Development" }];
  f.workspaceMoreButton.dispatch("click");
  const current = radios();
  assert.deepEqual(current.map(item => item.getAttribute("label")), ["Focus", "Development"]);
  assert.ok(old.every(item => item.parent === null));
  assert.equal(current[0].getAttribute("checked"), null);
  assert.equal(f.activate(current[0]).defaultPrevented, false);
  assert.deepEqual(f.actions, [["switch", "focus"]]);
  const content = {}; f.document.activeElement = content;
  f.workspaceMenu.hidePopup(); f.flush();
  assert.equal(f.document.activeElement, content, "Successful command must not trigger cancel-focus restoration");
  f.workspaceMoreButton.dispatch("click");
  assert.deepEqual(radios().map(item => item.getAttribute("checked")), ["true", null]);
});

test("stale workspace menu commands are rejected and reset heading state before any action", () => {
  for (const command of ["Rename Workspace…", "Focus"]) {
    for (const change of ["deleted", "renamed", "switched"]) {
      const f = fixture(); f.workspaceMoreButton.dispatch("click");
      const item = f.workspaceMenu.children.find(item => item.getAttribute("label") === command);
      if (change === "deleted") f.context.workspaces = f.context.workspaces.filter(item => item.id !== "build");
      if (change === "renamed") f.context.workspaces[0] = { ...f.context.workspaces[0], name: "New name" };
      if (change === "switched") f.context.currentWorkspace = "focus";
      assert.equal(f.activate(item).defaultPrevented, true, `${command}: ${change}`);
      assert.deepEqual(f.actions, [], change);
      assert.equal(f.workspaceMenu.hides, 1, change);
      assert.equal(f.workspaceMoreButton.getAttribute("aria-expanded"), "false", change);
      assert.equal(f.workspaceHeading.dataset.menuOpen, undefined, change);
    }
  }
});

test("workspace menu retains working create, rename, appearance, reorder and delete actions with live limits", () => {
  for (const [label, expected] of [["New Workspace…", ["new"]], ["Rename Workspace…", ["rename", "build"]],
    ["Move Workspace Later", ["move", "build", 1]], ["Delete Workspace…", ["delete", "build"]]]) {
    const f = fixture(); f.workspaceMoreButton.dispatch("click");
    const item = f.workspaceMenu.children.find(item => item.getAttribute("label") === label);
    assert.ok(item); assert.notEqual(item.getAttribute("disabled"), "true");
    f.activate(item); assert.deepEqual(f.actions, [expected]);
  }
  for (const [menuLabel, entryLabel, field, value] of [["Change Icon", "Leaf", "icon", "arc"]]) {
    const f = fixture(); f.workspaceMoreButton.dispatch("click");
    const menu = f.workspaceMenu.children.find(item => item.getAttribute("label") === menuLabel);
    const item = menu.children[0].children.find(item => item.getAttribute("label") === entryLabel);
    assert.ok(item); f.activate(item);
    assert.equal(f.actions[0][0], "appearance"); assert.equal(f.actions[0][1], "build"); assert.equal(f.actions[0][2][field], value);
  }
  const f = fixture();
  f.context.workspaces = [f.context.workspaces[0]];
  f.workspaceMoreButton.dispatch("click");
  for (const label of ["Delete Workspace…", "Move Workspace Earlier", "Move Workspace Later"]) {
    assert.equal(f.workspaceMenu.children.find(item => item.getAttribute("label") === label).getAttribute("disabled"), "true");
  }
  f.workspaceMenu.hidePopup(); f.flush();
  f.context.workspaces = Array.from({ length: 12 }, (_, index) => ({ id: index ? `workspace-${index}` : "build", name: `Space ${index}` }));
  f.workspaceMoreButton.dispatch("click");
  assert.equal(f.workspaceMenu.children.find(item => item.getAttribute("label") === "New Workspace…").getAttribute("disabled"), "true");
});
