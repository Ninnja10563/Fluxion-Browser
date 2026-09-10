/* global Services, SessionStore, PathUtils, Cu */
(function verifyStructure(window) {
  "use strict";
  if (Services.env.get("FLUXION_STRUCTURE_TEST") !== "1") return;
  const prefix = "fluxion.structure.verification";
  const { document, gBrowser, FluxionUI: ui } = window;
  const fixtures = [], original = gBrowser.selectedTab;
  const report = { fixtureTabs: 1000, checks: [], unaffectedWrites: 0,
    input: "Native Gecko tab operations and chrome focus; not physical OS input" };
  let observer;
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const write = (key, value) => {
    Services.prefs.setStringPref(`${prefix}.${key}`, value);
    Services.prefs.savePrefFile(null);
  };
  const frame = () => new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("Structure frame timed out")), 2000);
    window.requestAnimationFrame(() => { window.clearTimeout(timer); resolve(); });
  });
  const settle = async () => { await frame(); await frame(); };
  const wait = async (predicate, message) => {
    const deadline = Date.now() + 20000;
    do { if (predicate()) return; await settle(); } while (Date.now() < deadline);
    throw new Error(message);
  };
  async function run() {
    assert(/\/fluxion-structure-check\.[^/]+\/profile\/?$/.test(PathUtils.profileDir), "Requires isolated structure profile");
    await SessionStore.promiseAllWindowsRestored;
    ui.setSidebarState("expanded");
    const workspace = ui.currentWorkspace();
    const flow = document.getElementById("fluxion-flow");
    const tree = flow.querySelector('[aria-label="Open tabs in current workspace"]');
    const pinned = flow.querySelector(".fluxion-pinned-tabs");
    const rows = () => new Map([...flow.querySelectorAll(".fluxion-tab")].map(row => [row._fluxionTab, row]));
    for (let index = 0; index < 1000; index++) {
      const tab = gBrowser.addTrustedTab("about:blank", { skipAnimation: true, createLazyBrowser: index >= 40 });
      ui.setTabWorkspace(tab, workspace); fixtures.push(tab);
    }
    ui.selectTab(fixtures[0]);
    await wait(() => rows().size >= 1000 && fixtures.slice(0, 40).every(tab => !tab.hasAttribute("busy")), "Flat fixture did not settle");
    assert(!fixtures.some(tab => tab.group || tab.splitview), "Fixture unexpectedly has grouped topology");
    fixtures[2].toggleMuteAudio();
    await settle();
    await wait(() => !rows().get(fixtures[2]).querySelector(".fluxion-audio").hidden, "Native muted tab did not expose audio action");
    let records = [];
    observer = new window.MutationObserver(batch => records.push(...batch));
    observer.observe(flow, { attributes: true, attributeOldValue: true, childList: true, characterData: true, subtree: true });
    function drain() { records.push(...observer.takeRecords()); const result = records; records = []; return result; }
    function order() {
      const current = [...gBrowser.tabs].filter(tab => ui.tabWorkspace(tab) === workspace && !tab.closing);
      for (const [container, isPinned] of [[tree, false], [pinned, true]]) {
        const actual = [...container.querySelectorAll(".fluxion-tab")].map(row => row._fluxionTab);
        const expected = current.filter(tab => tab.pinned === isPinned);
        assert(actual.length === expected.length && actual.every((tab, index) => tab === expected[index]), "Flow order diverged from native tab order");
        if (actual.length) assert([...container.querySelectorAll(".fluxion-tab")].filter(row => row.tabIndex === 0).length === 1,
          "Pin/tree container must retain exactly one independent keyboard entry");
      }
    }
    async function operation(name, affected, action, focusControl, movable = affected) {
      write("stage", name);
      // Establish the control owner's keyboard entry through real selection,
      // before measuring structure; do not manufacture tabindex/focus state.
      ui.selectTab(focusControl.closest(".fluxion-tab")._fluxionTab);
      await settle();
      const before = rows(), close = new Map([...before].map(([tab, row]) => [tab, row.querySelector(".fluxion-close")]));
      focusControl.focus({ preventScroll: true });
      assert(document.activeElement === focusControl, "Could not focus exact native close/audio control");
      drain();
      await action(); await settle();
      const after = rows();
      for (const [tab, row] of before) {
        if (affected.has(tab)) continue;
        assert(after.get(tab) === row && row.querySelector(".fluxion-close") === close.get(tab), `${name} replaced unaffected row/control`);
      }
      const changes = drain();
      for (const change of changes) {
        const element = change.target.nodeType === 1 ? change.target : change.target.parentElement;
        const row = element?.closest(".fluxion-tab");
        if (row && !affected.has(row._fluxionTab)) {
          report.unaffectedWrites++;
          throw new Error(`${name} rewrote unaffected row: ${change.type}/${change.attributeName || "children"}`);
        }
        if (change.type === "childList" && (change.target === tree || change.target === pinned)) {
          for (const removed of change.removedNodes) {
            if (removed._fluxionTab && !movable.has(removed._fluxionTab)) throw new Error(`${name} relocated an unrelated row`);
          }
        }
      }
      assert(focusControl.isConnected && document.activeElement === focusControl, `${name} lost exact close/audio focus`);
      order(); report.checks.push(name);
      return changes;
    }
    const closeFocus = () => rows().get(fixtures[1]).querySelector(".fluxion-close");
    const audioFocus = () => rows().get(fixtures[2]).querySelector(".fluxion-audio");
    let added;
    const addedSet = new Set();
    await operation("background-add-preserves-rows-and-close-focus", addedSet, async () => {
      added = gBrowser.addTrustedTab("about:blank", { skipAnimation: true });
      fixtures.push(added); addedSet.add(added); ui.setTabWorkspace(added, workspace);
      await wait(() => !added.hasAttribute("busy"), "Added page remained busy");
    }, closeFocus());
    await operation("background-remove-preserves-rows-and-audio-focus", new Set([added]),
      () => gBrowser.removeTab(added, { animate: false }), audioFocus());
    await operation("unselected-move-preserves-neighbor-controls", new Set([fixtures[30]]),
      () => gBrowser.moveTabTo(fixtures[30], { tabIndex: fixtures[10]._tPos }), closeFocus());
    // Either side of an adjacent swap is an equivalent minimal DOM move.
    // Retain EVERY row/control and the neighbor's exact focused close button.
    const adjacent = fixtures[12], neighbor = gBrowser.tabs[adjacent._tPos + 1];
    const swap = await operation("adjacent-forward-swap-retains-all-rows-and-neighbor-focus", new Set(),
      () => gBrowser.moveTabTo(adjacent, { tabIndex: neighbor._tPos }),
      rows().get(neighbor).querySelector(".fluxion-close"), new Set([adjacent, neighbor]));
    const relocations = swap.filter(change => change.type === "childList" && change.target === tree)
      .flatMap(change => [...change.removedNodes]).filter(node => node._fluxionTab).length;
    assert(relocations === 1, "Adjacent native swap did not use exactly one DOM relocation");
    report.adjacentSwapRelocations = relocations;
    await operation("pin-role-change-preserves-unaffected-rows", new Set([fixtures[20]]),
      () => gBrowser.pinTab(fixtures[20]), audioFocus());
    assert(rows().get(fixtures[20]).getAttribute("role") === "tab", "Pinned row role is not tab");
    await operation("unpin-role-change-preserves-unaffected-rows", new Set([fixtures[20]]),
      () => gBrowser.unpinTab(fixtures[20]), closeFocus());
    assert(rows().get(fixtures[20]).getAttribute("role") === "treeitem", "Unpinned row role is not treeitem");
    observer.disconnect(); observer = null;
    const group = gBrowser.addTabGroup([fixtures[5], fixtures[6]], { label: "Structure research", color: "blue" });
    ui.selectTab(fixtures[5]); group.collapsed = true; await settle();
    assert(rows().get(fixtures[5]) && !rows().get(fixtures[5]).closest("[hidden]"), "Grouped fallback omitted active collapsed page");
    ui.selectTab(fixtures[7]); await settle();
    assert(!rows().get(fixtures[5]) || rows().get(fixtures[5]).closest("[hidden]"), "Grouped fallback exposed inactive collapsed page");
    ui.createSplitView(fixtures[8], fixtures[9], { orientation: window.FluxionSplitViews.STACKED });
    await wait(() => fixtures[8].splitview && fixtures[8].splitview === fixtures[9].splitview, "Split fallback did not create native pair");
    ui.selectTab(fixtures[9]); await settle();
    assert(rows().get(fixtures[9]).closest(".fluxion-split")?.getAttribute("data-active") === "true", "Split fallback omitted active wrapper");
    report.checks.push("native-group-collapse-and-stacked-split-fallback-correct");
    report.complete = true;
  }
  run().catch(error => { write("error", `${error.message}\n${error.stack || ""}`); Cu.reportError(error); })
    .finally(() => {
      observer?.disconnect();
      write("report", JSON.stringify(report));
      if (report.complete) write("health", "keyed-1000-tab-structure-and-native-fallbacks-verified");
      if (original?.parentNode) gBrowser.selectedTab = original;
      const remaining = fixtures.filter(tab => tab.parentNode);
      if (remaining.length) gBrowser.removeTabs(remaining, { animate: false });
    });
})(window);
