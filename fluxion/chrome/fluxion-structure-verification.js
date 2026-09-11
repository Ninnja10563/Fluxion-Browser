/* global Services, SessionStore, PathUtils, Cu */
(function verifyStructure(window) {
  "use strict";
  if (Services.env.get("FLUXION_STRUCTURE_TEST") !== "1") return;
  const prefix = "fluxion.structure.verification";
  const { document, gBrowser, FluxionUI: ui } = window;
  const fixtures = [], original = gBrowser.selectedTab;
  const report = { fixtureTabs: 1000, checks: [], baselines: [], unaffectedWrites: 0,
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
      // Use Flow's real Enter activation to establish the keyboard owner after
      // Gecko's native tab switch. Exact child-control focus belongs to setup,
      // not the subsequent structural operation being measured.
      const focusRow = focusControl.closest(".fluxion-tab");
      focusRow.focus({ preventScroll: true });
      focusRow.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await settle();
      assert(gBrowser.selectedTab === focusRow._fluxionTab && focusRow.tabIndex === 0,
        "Flow Enter did not establish the selected keyboard owner");
      focusControl.focus({ preventScroll: true });
      await settle();
      const baseline = { operation: name, owner: fixtures.indexOf(focusRow._fluxionTab),
        selected: fixtures.indexOf(gBrowser.selectedTab), focused: document.activeElement === focusControl,
        tabIndex: focusRow.tabIndex };
      report.baselines.push(baseline);
      assert(baseline.focused && gBrowser.selectedTab === focusRow._fluxionTab && focusRow.tabIndex === 0,
        `Structure baseline did not establish exact focused keyboard owner: ${JSON.stringify(baseline)}`);
      const before = rows(), close = new Map([...before].map(([tab, row]) => [tab, row.querySelector(".fluxion-close")]));
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
          report.unexpectedMutation = { operation: name, row: fixtures.indexOf(row._fluxionTab),
            type: change.type, attribute: change.attributeName, oldValue: change.oldValue,
            currentValue: change.attributeName ? element.getAttribute(change.attributeName) : null,
            selected: fixtures.indexOf(gBrowser.selectedTab),
            focusOwner: fixtures.indexOf(document.activeElement?.closest(".fluxion-tab")?._fluxionTab) };
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
    const headings = () => new Map([...flow.querySelectorAll(".fluxion-group-heading")].map(node => [node._fluxionGroup, node]));
    const visible = row => row && !row.closest("[hidden]");
    function hierarchy() {
      const nativeTabs = [...gBrowser.tabs].filter(tab => ui.tabWorkspace(tab) === workspace);
      for (const [container, isPinned] of [[tree, false], [pinned, true]]) {
        const expected = nativeTabs.filter(tab => tab.pinned === isPinned &&
          (isPinned || !tab.group?.collapsed || tab === gBrowser.selectedTab));
        const actual = [...container.querySelectorAll(".fluxion-tab")].filter(visible).map(row => row._fluxionTab);
        assert(actual.length === expected.length && actual.every((tab, index) => tab === expected[index]),
          "Flattened hierarchical Flow order diverged from native visible tab order");
      }
      const stops = [...tree.querySelectorAll('[role="treeitem"]')].filter(node => visible(node) && node.tabIndex === 0);
      assert(stops.length === 1, "Hierarchical tree lost its single visible keyboard entry");
      for (const [nativeGroup, heading] of headings()) {
        const groupChildren = document.getElementById(heading.getAttribute("aria-controls"));
        assert(groupChildren && heading.getAttribute("aria-owns") === groupChildren.id, "Group lost its accessible child relationship");
        const expected = [...nativeGroup.tabs].filter(tab => ui.tabWorkspace(tab) === workspace &&
          (!nativeGroup.collapsed || tab === gBrowser.selectedTab));
        const actual = [...groupChildren.querySelectorAll(".fluxion-tab")].filter(visible).map(row => row._fluxionTab);
        assert(actual.length === expected.length && actual.every((tab, index) => tab === expected[index]), "Group projection order diverged from native membership");
      }
    }
    async function hierarchicalOperation(name, affected, action, { selects = false, disappearing = new Set() } = {}) {
      write("stage", name);
      if (!selects) {
        const row = rows().get(fixtures[1]);
        row.focus({ preventScroll: true });
        row.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        await settle();
        row.querySelector(".fluxion-close").focus({ preventScroll: true });
        await settle();
      }
      const focus = document.activeElement, before = rows();
      const controls = new Map([...before].map(([tab, row]) => [tab, row.querySelector(".fluxion-close")]));
      const groupBefore = new Map([...headings()].map(([group, heading]) => [group,
        { heading, id: heading.getAttribute("aria-controls"), children: document.getElementById(heading.getAttribute("aria-controls")) }]));
      drain(); await action(); await settle();
      const after = rows();
      for (const [tab, row] of before) {
        if (!after.has(tab) && disappearing.has(tab)) continue;
        assert(after.get(tab) === row && row.querySelector(".fluxion-close") === controls.get(tab), `${name} replaced an existing hierarchical row/control`);
      }
      for (const [group, previous] of groupBefore) {
        const heading = headings().get(group);
        if (!heading && !group.tabs.length) continue;
        assert(heading === previous.heading && heading.getAttribute("aria-controls") === previous.id &&
          document.getElementById(previous.id) === previous.children, `${name} replaced a stable group heading/container`);
      }
      for (const change of drain()) {
        const element = change.target.nodeType === 1 ? change.target : change.target.parentElement;
        const row = element?.closest(".fluxion-tab");
        if (row && !affected.has(row._fluxionTab)) {
          report.unaffectedWrites++;
          throw new Error(`${name} changed unrelated hierarchical row: ${change.type}/${change.attributeName || "children"}`);
        }
      }
      if (!selects) assert(focus?.isConnected && document.activeElement === focus, `${name} stole unaffected close-control focus`);
      hierarchy(); report.checks.push(name);
    }
    let group;
    await hierarchicalOperation("create-group-retains-rows-and-unrelated-focus", new Set([fixtures[5], fixtures[6]]), () => {
      group = gBrowser.addTabGroup([fixtures[5], fixtures[6]], { label: "Structure research", color: "blue" });
    });
    await hierarchicalOperation("group-rename-retains-heading-container-and-rows", new Set(), () => { group.label = "Renamed research"; group.color = "green"; });
    assert(headings().get(group).textContent.includes("Renamed research"), "Native group rename did not reach Flow");
    await hierarchicalOperation("group-add-retains-member-controls", new Set([fixtures[7]]), () => group.addTabs([fixtures[7]]));
    await hierarchicalOperation("group-reorder-retains-member-controls", new Set([fixtures[7]]), () => gBrowser.moveTabTo(fixtures[7], { tabIndex: fixtures[5]._tPos }));
    await hierarchicalOperation("group-remove-retains-promoted-row", new Set([fixtures[7]]), () => gBrowser.ungroupTab(fixtures[7]));
    ui.selectTab(fixtures[5]); await settle();
    await hierarchicalOperation("collapse-retains-active-page-and-heading", new Set([fixtures[5], fixtures[6]]), () => { group.collapsed = true; },
      { selects: true, disappearing: new Set([fixtures[6]]) });
    assert(visible(rows().get(fixtures[5])), "Collapsed group omitted active page");
    await hierarchicalOperation("collapsed-selection-updates-only-necessary-projection", new Set([fixtures[5], fixtures[7]]), () => ui.selectTab(fixtures[7]),
      { selects: true, disappearing: new Set([fixtures[5]]) });
    assert(!visible(rows().get(fixtures[5])), "Collapsed group exposed an inactive page");
    await hierarchicalOperation("group-expansion-retains-unrelated-controls", new Set([fixtures[5], fixtures[6]]), () => { group.collapsed = false; });
    await hierarchicalOperation("split-creation-retains-native-tab-rows", new Set([fixtures[1], fixtures[8], fixtures[9]]),
      () => ui.createSplitView(fixtures[8], fixtures[9], { orientation: window.FluxionSplitViews.STACKED }), { selects: true });
    const split = fixtures[8].splitview;
    assert(split && split === fixtures[9].splitview, "Native split pair did not form");
    const splitWrapper = rows().get(fixtures[8]).closest(".fluxion-split");
    await hierarchicalOperation("split-orientation-retains-wrapper-and-controls", new Set([fixtures[8], fixtures[9]]), () => ui.setSplitOrientation(fixtures[8], window.FluxionSplitViews.SIDE_BY_SIDE));
    assert(rows().get(fixtures[8]).closest(".fluxion-split") === splitWrapper, "Orientation replaced native split wrapper");
    // Firefox 155's group.addTabs accepts the native split wrapper itself;
    // passing its individual members would exercise separate tab moves instead.
    await hierarchicalOperation("moving-native-split-into-group-retains-member-controls", new Set([fixtures[8], fixtures[9]]),
      () => group.addTabs([split]));
    assert(split.group === group && fixtures[8].group === group && fixtures[9].group === group,
      "Native split did not move intact into its group");
    const nestedWrapper = rows().get(fixtures[8]).closest(".fluxion-split");
    assert(nestedWrapper?.closest(".fluxion-group") && rows().get(fixtures[8]).getAttribute("aria-level") === "2",
      "Grouped split did not acquire its proper hierarchy");
    await hierarchicalOperation("nested-split-reversal-retains-wrapper-and-controls", new Set([fixtures[8], fixtures[9]]),
      () => ui.reverseSplitView(fixtures[8]));
    assert(rows().get(fixtures[8]).closest(".fluxion-split") === nestedWrapper, "Reversal replaced nested split wrapper");
    ui.selectTab(fixtures[8]); await settle();
    await hierarchicalOperation("collapsed-nested-split-retains-only-active-pane", new Set([fixtures[5], fixtures[6], fixtures[8], fixtures[9]]),
      () => { group.collapsed = true; }, { selects: true, disappearing: new Set([fixtures[5], fixtures[6], fixtures[9]]) });
    assert(visible(rows().get(fixtures[8])) && !rows().get(fixtures[8]).closest(".fluxion-split"),
      "Collapsed group must project only its selected pane without an incomplete split wrapper");
    await hierarchicalOperation("expanded-nested-split-retains-active-pane-control", new Set([fixtures[5], fixtures[6], fixtures[8], fixtures[9]]),
      () => { group.collapsed = false; }, { selects: true });
    await hierarchicalOperation("split-separation-retains-member-controls", new Set([fixtures[8], fixtures[9]]), () => ui.separateSplitView(fixtures[8]));
    assert(!fixtures[8].splitview && !rows().get(fixtures[8]).closest(".fluxion-split"), "Separated split retained obsolete topology");
    observer.disconnect(); observer = null;
    report.complete = true;
  }
  function complete(primaryError = null) {
    const failures = primaryError ? [primaryError] : [];
    const attempt = action => { try { action(); } catch (error) { failures.push(error); } };
    attempt(() => observer?.disconnect());
    attempt(() => { if (original?.parentNode) gBrowser.selectedTab = original; });
    attempt(() => {
      const remaining = fixtures.filter(tab => tab.parentNode);
      if (remaining.length) gBrowser.removeTabs(remaining, { animate: false });
    });
    report.complete = Boolean(report.complete && !failures.length);
    if (failures.length) report.failures = failures.map(error => `${error.message}\n${error.stack || ""}`);
    attempt(() => write("report", JSON.stringify(report)));
    if (!failures.length && report.complete) {
      attempt(() => write("health", "keyed-1000-tab-hierarchical-structure-verified"));
    }
    if (failures.length) {
      report.complete = false;
      // A failed flush must not leave a success pref for a later flush to save.
      attempt(() => Services.prefs.clearUserPref(`${prefix}.health`));
      const detail = failures.map(error => `${error.message}\n${error.stack || ""}`).join("\nAdditional failure:\n");
      attempt(() => write("error", detail));
      for (const error of failures) Cu.reportError(error);
    }
  }
  run().then(() => complete(), complete);
})(window);
