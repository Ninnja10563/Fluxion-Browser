/* global Services, SessionStore, PathUtils, Ci, Cu */
(function verifySelection(window) {
  "use strict";
  if (Services.env.get("FLUXION_SELECTION_TEST") !== "1") return;
  if (!/\/fluxion-selection-check\.[^/]+\/profile\/?$/.test(PathUtils.profileDir)) {
    Cu.reportError(new Error("Selection fixture requires its isolated profile"));
    return;
  }
  const prefix = "fluxion.selection.verification";
  const { document, gBrowser, FluxionUI: ui } = window;
  const fixtures = [], latencies = [];
  const original = gBrowser.selectedTab;
  const report = { selections: 0, untouchedRowWrites: 0, unchangedAttributeWrites: 0, rowStructuralChanges: 0, checks: [] };
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const frame = () => new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("Selection frame exceeded 2 seconds")), 2000);
    window.requestAnimationFrame(() => { window.clearTimeout(timer); resolve(); });
  });
  const settle = async () => { await frame(); await frame(); };
  const wait = async (predicate, message, timeout = 15000) => {
    const deadline = Date.now() + timeout;
    do { if (predicate()) return; await settle(); } while (Date.now() < deadline);
    throw new Error(message);
  };
  let observer = null, mutations = [];
  async function run() {
    await SessionStore.promiseAllWindowsRestored;
    ui.setSidebarState("expanded");
    const workspace = ui.currentWorkspace(), flow = document.getElementById("fluxion-flow");
    const tree = flow.querySelector('[aria-label="Open tabs in current workspace"]');
    for (let i = 0; i < 1000; i++) {
      const tab = gBrowser.addTrustedTab("about:blank", { skipAnimation: true, createLazyBrowser: i >= 40 });
      ui.setTabWorkspace(tab, workspace); fixtures.push(tab);
    }
    await wait(() => fixtures.slice(0, 40).every(tab => !tab.hasAttribute("busy")), "Fixture pages did not finish loading");
    fixtures.forEach((tab, i) => { tab.setAttribute("label", `Selection reference ${i}`); gBrowser._tabAttrModified(tab, ["label"]); });
    ui.selectTab(fixtures[0]);
    const rows = () => new Map([...flow.querySelectorAll(".fluxion-tab")].map(row => [row._fluxionTab, row]));
    await wait(() => rows().size >= fixtures.length, "Flow did not render 1,000 native tabs");
    await settle();
    let baseline = rows(), closeButtons = new Map([...baseline].map(([tab, row]) => [tab, row.querySelector(".fluxion-close")]));
    const input = document.getElementById("urlbar-input");
    input.focus(); tree.scrollTop = 400; await settle();
    const snapshot = destination => ({ activeId: document.activeElement?.id || "",
      activeTag: document.activeElement?.localName || "", inputFocused: document.activeElement === input,
      destinationBrowserFocused: document.activeElement === destination.linkedBrowser,
      activeWindow: Services.focus.activeWindow === window, scrollTop: tree.scrollTop,
      savedUrlbarFocus: Boolean(window.gURLBar.getBrowserState(destination.linkedBrowser).urlbarFocused),
      selected: gBrowser.selectedTab === destination });
    assert(document.activeElement === input, `Could not establish initial URLbar focus: ${JSON.stringify(snapshot(fixtures[0]))}`);
    const cold = fixtures[1];
    report.coldSelection = { before: snapshot(cold) };
    ui.selectTab(cold);
    report.coldSelection.immediate = snapshot(cold);
    await settle();
    const nativeOwner = () => window.gURLBar.getBrowserState(cold.linkedBrowser).urlbarFocused ? input : cold.linkedBrowser;
    try {
      await wait(() => document.activeElement === nativeOwner(), "Cold selection did not restore Gecko's saved destination focus policy");
    } finally { report.coldSelection.final = snapshot(cold); }
    assert(!document.activeElement?.closest?.("#fluxion-flow"), "Flow stole focus after cold native selection");
    assert(Math.abs(tree.scrollTop - report.coldSelection.before.scrollTop) <= 1,
      `Cold native selection scrolled Flow: ${JSON.stringify(report.coldSelection)}`);
    // Native Gecko remembers URLbar focus per tab. Establish that state by
    // actually visiting and focusing each destination, never changing its store.
    for (const tab of fixtures.slice(0, 33)) {
      ui.selectTab(tab); await settle(); input.focus(); await settle();
      assert(document.activeElement === input, `Could not prime native URLbar focus: ${JSON.stringify(snapshot(tab))}`);
    }
    ui.selectTab(fixtures[0]); await settle();
    await wait(() => document.activeElement === input, "Primed native tab did not restore URLbar focus");
    tree.scrollTop = 400; await settle();
    baseline = rows();
    closeButtons = new Map([...baseline].map(([tab, row]) => [tab, row.querySelector(".fluxion-close")]));
    report.focusContract = "One cold Gecko-policy selection, then 33 tabs primed by real selection+input.focus before 30 measured selections";
    const scroll = tree.scrollTop;
    observer = new window.MutationObserver(records => mutations.push(...records));
    observer.observe(flow, { attributes: true, attributeOldValue: true, childList: true, characterData: true, subtree: true });
    const drain = () => { mutations.push(...observer.takeRecords()); const records = mutations; mutations = []; return records; };
    const rebase = async () => {
      await settle(); drain(); baseline = rows();
      closeButtons = new Map([...baseline].map(([tab, row]) => [tab, row.querySelector(".fluxion-close")]));
    };
    const verify = changed => {
      const current = rows();
      assert([...baseline].every(([tab, row]) => current.get(tab) === row && row.querySelector(".fluxion-close") === closeButtons.get(tab)),
        "Selection replaced native Flow row or close-control identity");
      const records = drain(), values = new Map(), afterValues = new Map();
      // Reconstruct each write, not merely its final batch value: a legitimate
      // false→true→false sequence must not be mistaken for a no-op write.
      for (let i = records.length - 1; i >= 0; i--) {
        const mutation = records[i];
        if (mutation.type !== "attributes") continue;
        if (!values.has(mutation.target)) values.set(mutation.target, new Map());
        const attributes = values.get(mutation.target);
        afterValues.set(mutation, attributes.has(mutation.attributeName) ? attributes.get(mutation.attributeName) : mutation.target.getAttribute(mutation.attributeName));
        attributes.set(mutation.attributeName, mutation.oldValue);
      }
      for (const mutation of records) {
        const element = mutation.target.nodeType === 1 ? mutation.target : mutation.target.parentElement;
        const row = element?.closest?.(".fluxion-tab");
        if (row && !changed.has(row._fluxionTab)) {
          report.untouchedRowWrites++;
          report.firstUntouchedMutation ||= { type: mutation.type, attribute: mutation.attributeName, label: row._fluxionTab?.label,
            target: element?.localName, className: String(element?.className || "") };
        }
        if (mutation.type === "attributes" && mutation.oldValue === afterValues.get(mutation)) {
          report.unchangedAttributeWrites++;
          report.firstUnchangedAttribute ||= { attribute: mutation.attributeName, target: mutation.target.id || mutation.target.localName };
        }
        if (mutation.type === "childList" && [...mutation.removedNodes, ...mutation.addedNodes]
          .some(node => node.nodeType === 1 && (node.matches(".fluxion-tab") || node.querySelector(".fluxion-tab")))) report.rowStructuralChanges++;
      }
      assert(report.untouchedRowWrites === 0, "Selection mutated an unchanged Flow tab");
      assert(report.unchangedAttributeWrites === 0, "Selection rewrote an unchanged Flow attribute");
      assert(report.rowStructuralChanges === 0, "Selection rebuilt the tab list");
      assert([...baseline].every(([tab, row]) => row.getAttribute("data-active") === String(tab === gBrowser.selectedTab) &&
        row.getAttribute("aria-selected") === String(tab === gBrowser.selectedTab || Boolean(tab.multiselected)) &&
        row.classList.contains("is-multiselected") === Boolean(tab.multiselected)), "Flow active or multiselect state diverged from Gecko");
      const stops = [...tree.querySelectorAll('[role="treeitem"]')].filter(node => node.tabIndex === 0 && !node.closest("[hidden]"));
      assert(stops.length === 1, "Selection broke the tree's single roving tab stop");
      const pinned = [...flow.querySelectorAll(".fluxion-pinned-tabs .fluxion-tab")];
      if (pinned.length) assert(pinned.filter(node => node.tabIndex === 0).length === 1, "Pinned strip lost its independent roving stop");
    };
    for (let i = 1; i <= 30; i++) {
      const previous = gBrowser.selectedTab, next = fixtures[i];
      const evidence = { index: i, before: snapshot(next) };
      report.lastSelection = evidence;
      const start = window.performance.now(); ui.selectTab(next);
      evidence.immediate = snapshot(next); await frame();
      latencies.push(window.performance.now() - start);
      await settle(); evidence.final = snapshot(next); verify(new Set([previous, next]));
      assert(document.activeElement === input && Math.abs(tree.scrollTop - scroll) <= 1,
        `Background native selection stole input focus or scrolled Flow: ${JSON.stringify(evidence)}`);
      report.selections++;
    }
    const selected = gBrowser.selectedTab;
    for (const tab of [fixtures[31], fixtures[32]]) {
      gBrowser.addToMultiSelectedTabs(tab); await settle(); verify(new Set([selected, tab]));
      gBrowser.removeFromMultiSelectedTabs(tab); await settle(); verify(new Set([selected, tab]));
    }
    report.checks.push("1000row-and-close-identities-30selections-no-untouched-writes-or-list-rebuild");
    const clickRow = baseline.get(fixtures[2]); clickRow.scrollIntoView({ block: "center" }); await settle();
    const clickRect = clickRow.getBoundingClientRect();
    for (const type of ["mousedown", "mouseup"]) window.synthesizeMouseEvent(type, clickRect.left + 30, clickRect.top + clickRect.height / 2,
      { button: 0, buttons: type === "mousedown" ? 1 : 0, clickCount: 1 }, { toWindow: true });
    await wait(() => gBrowser.selectedTab === fixtures[2], "Real Gecko row click did not select the tab");
    await settle(); verify(new Set([fixtures[30], fixtures[2]]));
    baseline.get(fixtures[3]).focus();
    baseline.get(fixtures[3]).dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await wait(() => gBrowser.selectedTab === fixtures[3] && document.activeElement?._fluxionTab === fixtures[3], "Shipped Enter handler did not select and focus tab");
    await settle(); verify(new Set([fixtures[2], fixtures[3]]));
    report.checks.push("gecko-routed-row-click-and-dom-enter-selection");
    gBrowser.pinTab(fixtures[4]); ui.selectTab(fixtures[4]); await settle();
    assert(rows().get(fixtures[4])?.getAttribute("data-active") === "true", "Pinned selection marker missing");
    await rebase();
    ui.selectTab(fixtures[3]); await settle(); verify(new Set([fixtures[4], fixtures[3]]));
    ui.selectTab(fixtures[4]); await settle(); verify(new Set([fixtures[3], fixtures[4]]));
    const group = gBrowser.addTabGroup([fixtures[5], fixtures[6]], { label: "Selection research", color: "blue" });
    ui.selectTab(fixtures[5]); await settle();
    const heading = () => [...flow.querySelectorAll(".fluxion-group-heading")].find(node => node._fluxionGroup === group);
    assert(heading()?.classList.contains("has-active"), "Expanded native group did not show active member");
    await rebase();
    const groupHeading = heading(), groupRows = [rows().get(fixtures[5]), rows().get(fixtures[6])];
    ui.selectTab(fixtures[6]); await settle();
    verify(new Set([fixtures[5], fixtures[6]]));
    assert(heading() === groupHeading && heading().classList.contains("has-active") &&
      rows().get(fixtures[5]) === groupRows[0] && rows().get(fixtures[6]) === groupRows[1],
      "Expanded group selection replaced its heading or tab rows");
    ui.selectTab(fixtures[5]); await settle();
    verify(new Set([fixtures[6], fixtures[5]]));
    ui.selectTab(fixtures[7]); await settle(); verify(new Set([fixtures[5], fixtures[7]]));
    assert(!heading().classList.contains("has-active"), "Expanded group active marker persisted after leaving");
    ui.selectTab(fixtures[5]); await settle(); verify(new Set([fixtures[7], fixtures[5]]));
    group.collapsed = true; await settle();
    assert(rows().get(fixtures[5]) && !rows().get(fixtures[5]).closest('[hidden]'), "Collapsed group hid active page");
    ui.selectTab(fixtures[7]); await settle();
    assert(!heading().classList.contains("has-active") &&
      (!rows().get(fixtures[5]) || rows().get(fixtures[5]).closest('[hidden]')), "Collapsed projection failed when selection left group");
    ui.createSplitView(fixtures[8], fixtures[9], { orientation: window.FluxionSplitViews.STACKED });
    await wait(() => fixtures[8].splitview && fixtures[8].splitview === fixtures[9].splitview, "Native split fixture did not form");
    await rebase();
    const previousSplitSelection = gBrowser.selectedTab;
    ui.selectTab(fixtures[9]); await settle();
    verify(new Set([previousSplitSelection, fixtures[9]]));
    assert(rows().get(fixtures[9])?.getAttribute("data-active") === "true" &&
      rows().get(fixtures[8])?.getAttribute("data-active") === "false", "Split active-pane markers are stale");
    const splitWrapper = rows().get(fixtures[9]).closest(".fluxion-split");
    assert(splitWrapper?.getAttribute("data-active") === "true", "Split wrapper omitted active state");
    ui.selectTab(fixtures[7]); await settle(); verify(new Set([fixtures[9], fixtures[7]]));
    assert(rows().get(fixtures[9]).closest(".fluxion-split") === splitWrapper && splitWrapper.getAttribute("data-active") === "false",
      "Leaving split replaced wrapper or retained active marker");
    report.checks.push("pinned-expanded-and-collapsed-group-and-native-split-projections");
    const sorted = [...latencies].sort((a, b) => a - b), percentile = p => sorted[Math.ceil(sorted.length * p) - 1];
    report.fixtureTabs = fixtures.length;
    report.eventToFrameMs = { p50: percentile(.5), p95: percentile(.95), max: sorted.at(-1) };
    report.latenciesMs = latencies;
    report.input = "Gecko native selection and routed mouse events; DOM Enter; not OS input or high-refresh-rate proof";
    assert(report.eventToFrameMs.p95 < 500 && report.eventToFrameMs.max < 1500, "Selection exceeded hosted-runner responsiveness bounds");
  }
  const cleanup = () => {
    observer?.disconnect();
    if (original?.parentNode) ui.selectTab(original);
    const live = fixtures.filter(tab => tab.parentNode); if (live.length) gBrowser.removeTabs(live, { animate: false });
  };
  run().then(() => { cleanup(); Services.prefs.setStringPref(`${prefix}.health`, "stable-1000-tab-selection-and-native-projections-verified"); })
    .catch(error => {
      Services.prefs.setStringPref(`${prefix}.error`, `${error.message}\n${error.stack}`); Cu.reportError(error);
      try { cleanup(); } catch (cause) { report.cleanupError = String(cause); }
    })
    .finally(() => {
      observer?.disconnect(); report.latenciesMs = latencies;
      Services.prefs.setStringPref(`${prefix}.report`, JSON.stringify(report)); Services.prefs.savePrefFile(null);
    });
})(window);
