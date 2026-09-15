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
  const frames = [], timers = [], projections = [];
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
    window: { requestAnimationFrame: fn => frames.push(fn), setTimeout: fn => timers.push(fn),
      matchMedia: () => ({ matches: false }) },
    document: { activeElement: null, documentElement: { hasAttribute: () => false } },
    pointerCloseHold: null, renderDeferredForClose: false, closingTabs: new Set(), dirtyTabs: new Set(),
    structureDirty: false, renderQueued: false, selectionDirty: false, flowMenuSession: null,
    currentWorkspace: "focus", renderedWorkspace: "focus", renderedSelectedTab: tabs[0], renderedMultiSelected: new Set(),
    rovingElements: new Map(), focusTabAfterRender: null, focusGroupAfterRender: null, focusWorkspaceAfterRender: null,
    pinnedTabs: { childElementCount: 0 }, pinnedLabel: {}, count: {},
    tabWorkspace: tab => tab.workspace, contextTabs: tab => [tab], renderWorkspaces() {},
    updateWindowTitle() {}, syncHeldTabSelection() {}, refreshFlowSelection: () => true, refreshTabElement() {},
    renderedPinnedTabElements: () => [], renderedTreeItems: () => [...tabElements.values()],
    renderedTabElements: () => [...tabElements.values()],
    reconcileFlowTabs(visible) {
      projections.push(Array.from(visible));
      for (const [tab, element] of tabElements) if (!visible.includes(tab)) {
        element.isConnected = false; tabElements.delete(tab);
      }
    },
  });
  // Run shipped state/scheduling functions, not a reimplementation. The native
  // lifecycle is modeled from Firefox155.0.1: committed TabClose precedes DOM
  // teardown; canceled permitUnload emits no event. Physical macOS keyboard
  // dispatch and Gecko's actual dialog are separate packaged-browser checks.
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../chrome/core/tab-close-stability.js"), "utf8"), context);
  vm.runInContext(block("  function closeMotionDuration()", "  function vectorGlyph(") +
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
  return { context, tabs, tabElements, projections, frames, timers, commitClose,
    flush() { while (frames.length) frames.shift()(); },
    async finishTimers() { while (timers.length) await timers.shift()(); },
    hold(tab = tabs[0], detail = 1) {
      context.beginPointerCloseHold([tab], [tabElements.get(tab)],
        { getBoundingClientRect: () => ({ left: 10, top: 10, right: 30, bottom: 30 }) },
        { detail, clientX: 20, clientY: 20 });
      return context.pointerCloseHold;
    },
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

for (const releasing of [false, true]) {
  test(`Command-W on another tab ends a ${releasing ? "releasing" : "stationary"} pointer hold without waiting for mouse movement`, () => {
    const f = fixture(), hold = f.hold();
    f.commitClose(f.tabs[0]); f.flush();
    assert.equal(f.context.pointerCloseHold, hold);
    assert.ok(f.tabElements.has(f.tabs[0]), "pointer close retains its gap until released");
    hold.releasing = releasing;
    f.commitClose(f.tabs[1]); f.flush();
    assert.equal(f.context.pointerCloseHold, null);
    assert.equal(f.tabElements.has(f.tabs[0]), false);
    assert.equal(f.tabElements.has(f.tabs[1]), false);
    assert.equal(f.context.count.textContent, "2");
  });
}

test("a close from the held pointer set retains anti-repeat protection until explicit release", () => {
  const f = fixture(), hold = f.hold(), neighbor = f.tabElements.get(f.tabs[1]);
  f.commitClose(f.tabs[0]); f.flush();
  assert.equal(f.context.pointerCloseHold, hold);
  assert.equal(f.projections.length, 0);
  assert.equal(f.tabElements.get(f.tabs[1]), neighbor);
  f.context.releasePointerCloseHold({ animate: false }); f.flush();
  assert.equal(f.tabElements.has(f.tabs[0]), false);
  assert.equal(f.tabElements.get(f.tabs[1]), neighbor);
});

test("keyboard activation of a close button does not start a pointer guard at synthetic coordinates", () => {
  const f = fixture();
  assert.equal(f.hold(f.tabs[0], 0), null);
  assert.ok(f.hold(f.tabs[0], 1));
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
  assert.equal(f.context.pointerCloseHold, null);
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
  assert.equal(f.context.pointerCloseHold, null);
  assert.equal(f.context.count.textContent, "3");
});

test("completion of an old pointer release never clears a newer close guard", async () => {
  const f = fixture(), old = f.hold();
  f.commitClose(f.tabs[0]);
  f.context.releasePointerCloseHold();
  assert.ok(old.releasing);
  f.commitClose(f.tabs[1]); f.flush();
  const current = f.hold(f.tabs[2]);
  assert.notEqual(current, old);
  await f.finishTimers();
  assert.equal(f.context.pointerCloseHold, current);
});

test("a canceled keyboard close does not take ownership of another tab's pointer guard", async () => {
  const f = fixture(), hold = f.hold();
  f.commitClose(f.tabs[0]);
  const survivor = f.tabs[1], original = f.tabElements.get(survivor);
  survivor.cancelClose = true;
  f.context.closeWithStability(survivor, original);
  await f.finishTimers(); f.flush();
  assert.equal(f.context.pointerCloseHold, hold);
  assert.ok(f.tabElements.has(f.tabs[0]), "existing stationary pointer gap is retained");
  assert.equal(original.classList.contains("is-closing"), false);
  f.context.releasePointerCloseHold({ animate: false }); f.flush();
  assert.equal(f.tabElements.has(f.tabs[0]), false);
  assert.equal(f.tabElements.get(survivor), original);
});
