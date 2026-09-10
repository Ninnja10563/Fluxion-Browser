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
    constructor(name) { this.name = name; this.listeners = new Map(); this.isConnected = true; }
    addEventListener(type, callback, capture = false) {
      const list = this.listeners.get(type) || []; list.push({ callback, capture }); this.listeners.set(type, list);
    }
    removeEventListener(type, callback) {
      this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item.callback !== callback));
    }
    dispatch(type, target = this) {
      const event = { type, target, defaultPrevented: false, stopped: false,
        preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
      for (const { callback } of [...(this.listeners.get(type) || [])].sort((a, b) => Number(b.capture) - Number(a.capture))) {
        callback(event); if (event.stopped) break;
      }
      return event;
    }
    hidePopup() { this.hides = (this.hides || 0) + 1; this.dispatch("popuphidden"); }
    focus() { document.activeElement = this; }
    contains(node) { return node === this || node?.parent === this; }
  }
  const flow = new Node("flow"), contextMenu = new Node("tabs"), groupMenu = new Node("groups"), workspaceMenu = new Node("workspaces");
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
    currentWorkspace: "build", workspaces: [{ id: "build" }, { id: "focus" }],
    contextTab: a, contextGroup: null, contextWorkspace: "build", flowMenuSession: null,
    tabElements, groupElements, workspaceElements, cleanup, newTabButton: row("new-tab"),
    renderedPinnedTabElements: () => [], renderedTreeItems: () => [...tabElements.values(), ...groupElements.values()],
    tabWorkspace: tab => tab.workspace, focusFlowItem: element => element?.focus(),
    on(node, type, callback, capture) { node.addEventListener(type, callback, capture); cleanup.push(() => node.removeEventListener(type, callback)); },
  });
  // Execute shipped handlers, not copies; only the surrounding browser/DOM IO
  // is modeled. Core menu lifecycle and selection are their shipped modules.
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../chrome/core/tab-selection.js"), "utf8"), context);
  vm.runInContext(block("  function contextTabs(", "  function splitOrientation("), context);
  vm.runInContext(block("  function initialiseFlowMenus()", "  on(modeButton,"), context);
  tabElements.get(a).focus();
  return { context, window, document, Services, gBrowser, flow, contextMenu, groupMenu, workspaceMenu,
    a, b, tabElements, groupElements, workspaceElements, row,
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
