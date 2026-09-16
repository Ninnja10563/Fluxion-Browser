"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../chrome/fluxion-chrome.js"), "utf8");
function block(start, end) {
  const first = source.indexOf(start), last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first, `Missing shipped boundary: ${start}`);
  return source.slice(first, last);
}

function fixture() {
  const frames = [], timers = [], projections = [], timerDelays = [];
  const tabs = Array.from({ length: 4 }, (_, id) => ({ id, label: `Page ${id}`, parentNode: {}, closing: false, workspace: "focus" }));
  const tabElements = new Map();
  function row(tab) {
    const classes = new Set();
    return { _fluxionTab: tab, isConnected: true, tabIndex: -1, dataset: {},
      classList: { add: (...names) => names.forEach(name => classes.add(name)),
        remove: (...names) => names.forEach(name => classes.delete(name)), contains: name => classes.has(name) },
      getAttribute: () => null, setAttribute() {}, contains: () => false, matches: () => false,
      closest: () => null };
  }
  for (const tab of tabs) tabElements.set(tab, row(tab));
  const gBrowser = { tabs, selectedTab: tabs[0], selectedTabs: [tabs[0]],
    // Closing retains the native tab in the collection until animation teardown.
    // A rejected beforeunload emits no TabClose and never sets tab.closing.
    removeTab(tab) { if (tab.cancelClose) return; commitClose(tab); },
    removeTabs(items) { for (const tab of items) this.removeTab(tab); },
  };
  const context = vm.createContext({ gBrowser, tabElements, groupElements: new Map(), workspaceElements: new Map(),
    Services: { focus: { activeWindow: null } },
    window: { requestAnimationFrame: fn => frames.push(fn), setTimeout: (fn, delay) => { timerDelays.push(delay); return timers.push(fn); },
      matchMedia: () => ({ matches: false }) },
    document: { activeElement: null, documentElement: { hasAttribute: () => false } },
    closingTabs: new Set(), dirtyTabs: new Set(),
    structureDirty: false, renderQueued: false, selectionDirty: false, flowMenuSession: null,
    currentWorkspace: "focus", renderedWorkspace: "focus", renderedSelectedTab: tabs[0], renderedMultiSelected: new Set(),
    rovingElements: new Map(), focusTabAfterRender: null, focusGroupAfterRender: null, focusWorkspaceAfterRender: null,
    pinnedTabs: { childElementCount: 0 }, pinnedLabel: {}, count: {},
    tabWorkspace: tab => tab.workspace, contextTabs: tab => [tab], renderWorkspaces() {},
    updateWindowTitle() {}, refreshFlowSelection: () => true, refreshTabElement() {},
    renderedPinnedTabElements: () => [], renderedTreeItems: () => [...tabElements.values()],
    renderedTabElements: () => [...tabElements.values()],
    reconcileFlowTabs(visible) {
      projections.push(Array.from(visible));
      for (const [tab, element] of tabElements) if (!visible.includes(tab)) {
        element.isConnected = false; tabElements.delete(tab);
      }
    },
  });
  context.Services.focus.activeWindow = context.window;
  // Run shipped state/scheduling functions, not a reimplementation. The native
  // lifecycle is modeled from Firefox155.0.1: committed TabClose precedes DOM
  // teardown; canceled permitUnload emits no event. Physical macOS keyboard
  // dispatch and Gecko's actual dialog are separate packaged-browser checks.
  vm.runInContext(block("  function closeMotionDuration(", "  function vectorGlyph(") +
    block("  function render()", "  function updateWindowTitle()") +
    block("  function scheduleRender(", "  const popupSet ="), context);
  function commitClose(tab) {
    tab.closing = true;
    if (gBrowser.selectedTab === tab) {
      gBrowser.selectedTab = tabs.find(candidate => !candidate.closing && candidate !== tab);
      gBrowser.selectedTabs = [gBrowser.selectedTab];
    }
    context.scheduleRender({ type: "TabClose", target: tab });
  }
  return { context, tabs, tabElements, projections, frames, timers, timerDelays, commitClose,
    flush() { while (frames.length) frames.shift()(); },
    async finishTimers() { while (timers.length) await timers.shift()(); },
  };
}

test("native Command-W removes an attached closing tab on the next Flow frame", () => {
  const f = fixture(), closing = f.tabs[0], survivors = f.tabs.slice(1).map(tab => f.tabElements.get(tab));
  f.commitClose(closing); f.flush();
  assert.ok(closing.parentNode, "native animation has not removed the tab yet");
  assert.equal(f.tabElements.has(closing), false);
  assert.deepEqual(f.projections.at(-1), f.tabs.slice(1));
  assert.equal(f.context.count.textContent, "3");
  assert.deepEqual(f.tabs.slice(1).map(tab => f.tabElements.get(tab)), survivors);
  // No second TabClose is emitted when native animation finally detaches it.
  closing.parentNode = null;
  assert.equal(f.tabElements.has(closing), false);
});

test("coalesced native closes and detached tabs never survive the workspace projection", () => {
  const f = fixture();
  f.commitClose(f.tabs[0]); f.commitClose(f.tabs[1]); f.tabs[2].parentNode = null;
  assert.equal(f.frames.length, 1); f.flush();
  assert.deepEqual(f.projections.at(-1), [f.tabs[3]]);
  assert.equal(f.context.count.textContent, "1");
});

for (const index of [0, 1, 3]) {
  test(`pointer close at row ${index} compresses after 120ms without pointer, blur or scroll events`, async () => {
    const f = fixture(), tab = f.tabs[index], row = f.tabElements.get(tab);
    const survivors = f.tabs.filter(candidate => candidate !== tab).map(candidate => f.tabElements.get(candidate));
    f.context.closeWithStability(tab, row);
    assert.equal(row.classList.contains("is-close-releasing"), true);
    assert.deepEqual(f.timerDelays, [120]);
    f.context.closeWithStability(tab, row);
    assert.equal(f.timers.length, 1, "an in-flight close is not duplicated");
    await f.finishTimers(); f.flush();
    assert.equal(f.tabElements.has(tab), false);
    assert.equal(f.context.count.textContent, "3");
    assert.deepEqual(f.tabs.filter(candidate => candidate !== tab).map(candidate => f.tabElements.get(candidate)), survivors);
  });
}

test("reduced motion and disabled animation close without a timed visual wait", async () => {
  for (const preference of ["system", "browser"]) {
    const f = fixture(), tab = f.tabs[0];
    f.context.window.matchMedia = () => ({ matches: preference === "system" });
    f.context.document.documentElement.hasAttribute = () => preference === "browser";
    f.context.closeWithStability(tab, f.tabElements.get(tab));
    assert.deepEqual(f.timerDelays, [0]);
    await f.finishTimers(); f.flush();
    assert.equal(f.tabElements.has(tab), false);
  }
});

test("last workspace row closes without the compression delay while other workspaces survive", async () => {
  for (const canceled of [false, true]) {
    const f = fixture(), tab = f.tabs[0], row = f.tabElements.get(tab);
    for (const other of f.tabs.slice(1)) other.workspace = "other";
    tab.cancelClose = canceled;
    f.context.closeWithStability(tab, row);
    assert.deepEqual(f.timerDelays, [0]);
    assert.equal(tab.closing, false, "request remains asynchronous and native permitUnload still owns commitment");
    await f.finishTimers(); f.flush();
    assert.equal(tab.closing, !canceled);
    assert.ok(f.tabs.slice(1).every(other => other.parentNode && !other.closing));
    if (canceled) {
      assert.equal(f.tabElements.get(tab), row);
      assert.equal(row.classList.contains("is-closing"), false);
      assert.equal(f.context.closingTabs.has(tab), false);
    }
  }
});

test("closing all remaining workspace rows together ignores detached and already-closing rows", async () => {
  const f = fixture(); f.tabs[2].closing = true; f.tabs[3].parentNode = null;
  f.context.contextTabs = () => f.tabs.slice(0, 2);
  f.context.closeWithStability(f.tabs[0], f.tabElements.get(f.tabs[0]));
  assert.deepEqual(f.timerDelays, [0]);
  await f.finishTimers();
  assert.ok(f.tabs.slice(0, 2).every(tab => tab.closing));
});

test("keyboard close during another row's compression removes both without pointer input", async () => {
  const f = fixture();
  f.context.closeWithStability(f.tabs[0], f.tabElements.get(f.tabs[0]));
  f.commitClose(f.tabs[1]); f.flush();
  await f.finishTimers(); f.flush();
  assert.equal(f.context.count.textContent, "2");
  assert.equal(f.tabElements.has(f.tabs[0]), false);
  assert.equal(f.tabElements.has(f.tabs[1]), false);
});

test("a rejected native keyboard close leaves the row and count intact", () => {
  const f = fixture(), tab = f.tabs[0], original = f.tabElements.get(tab);
  tab.cancelClose = true; f.context.gBrowser.removeTab(tab);
  f.context.render(); f.flush();
  assert.equal(tab.closing, false);
  assert.equal(f.tabElements.get(tab), original);
  assert.equal(f.context.count.textContent, "4");
});

test("canceled pointer beforeunload restores the row's visibility and interaction", async () => {
  const f = fixture(), tab = f.tabs[0], original = f.tabElements.get(tab);
  tab.cancelClose = true;
  f.context.closeWithStability(tab, original, {
    closeButton: { getBoundingClientRect: () => ({ left: 10, top: 10, right: 30, bottom: 30 }) },
    event: { detail: 1, clientX: 20, clientY: 20 },
  });
  assert.ok(original.classList.contains("is-closing"));
  await f.finishTimers(); f.flush();
  assert.equal(f.context.closingTabs.has(tab), false);
  assert.equal(original.classList.contains("is-closing"), false);
  assert.equal(original.classList.contains("is-close-releasing"), false);
  assert.equal(f.tabElements.get(tab), original);
});

test("partial multi-tab beforeunload cancellation keeps survivors interactive and removes committed closes", async () => {
  const f = fixture(), [closed, survivor] = f.tabs, original = f.tabElements.get(survivor);
  survivor.cancelClose = true;
  f.context.contextTabs = () => [closed, survivor];
  f.context.closeWithStability(closed, f.tabElements.get(closed), {
    closeButton: { getBoundingClientRect: () => ({ left: 10, top: 10, right: 30, bottom: 30 }) },
    event: { detail: 1, clientX: 20, clientY: 20 },
  });
  await f.finishTimers(); f.flush();
  assert.equal(f.tabElements.has(closed), false);
  assert.equal(f.tabElements.get(survivor), original);
  assert.equal(original.classList.contains("is-closing"), false);
  assert.equal(f.context.closingTabs.has(survivor), false);
  assert.equal(f.context.count.textContent, "3");
});
