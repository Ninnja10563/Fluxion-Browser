/* global Ci, Cu, Services, SessionStore */
(function initialiseFluxionFlowPerformance(window) {
  "use strict";

  if (Services.env.get("FLUXION_VISUAL_INCREMENTAL_TEST") !== "1") return;
  const { document, gBrowser } = window;
  const ui = window.FluxionUI;
  if (!gBrowser || !ui) throw new Error("Fluxion Flow performance fixture requires live browser chrome");

  const prefix = "fluxion.flow.performance";
  const latencies = [];
  let structuralRemovals = 0;
  let mutationRecords = 0;
  let observer = null;
  const fixtures = [];
  let backgroundMetrics = null;
  const searchLatencies = [];
  const originalSelected = gBrowser.selectedTab;
  const originalWorkspace = ui.currentWorkspace();
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const frame = () => new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("Flow animation frame did not arrive within 2 seconds")), 2000);
    window.requestAnimationFrame(() => {
      window.clearTimeout(timeout);
      resolve();
    });
  });
  const settle = async () => { await frame(); await frame(); };
  const waitFor = async (check, message, timeout = 1500) => {
    const deadline = window.performance.now() + timeout;
    do {
      await frame();
      if (check()) return;
    } while (window.performance.now() < deadline);
    throw new Error(message);
  };
  const changed = (tab, attributes) => gBrowser._tabAttrModified(tab, attributes);
  const recordMutations = records => {
    mutationRecords += records.length;
    for (const record of records) {
      for (const node of record.removedNodes || []) {
        if (node.nodeType !== 1) continue;
        const selector = ".fluxion-tab, .fluxion-group-heading, .fluxion-workspace";
        structuralRemovals += Number(node.matches(selector)) + node.querySelectorAll(selector).length;
      }
    }
  };
  const drainMutations = () => { if (observer) recordMutations(observer.takeRecords()); };
  const metrics = () => {
    const sorted = [...latencies].sort((left, right) => left - right);
    const percentile = fraction => sorted.length
      ? Number(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)].toFixed(2)) : 0;
    return {
      tabs: 200,
      batches: latencies.length,
      changesPerBatch: 20,
      eventToFrameMs: { p50: percentile(0.5), p95: percentile(0.95), max: percentile(1) },
      latenciesMs: latencies.map(value => Number(value.toFixed(2))),
      structuralRemovals,
      mutationRecords,
    };
  };

  async function run() {
    await SessionStore.promiseAllWindowsRestored;
    assert(typeof gBrowser._tabAttrModified === "function", "Gecko native tab-attribute event dispatcher is unavailable");
    const flow = document.getElementById("fluxion-flow");
    const tree = flow?.querySelector('[aria-label="Open tabs in current workspace"]');
    assert(tree, "Flow tab tree did not mount");
    for (let index = 0; index < 200; index += 1) {
      const tab = gBrowser.addTrustedTab(`about:blank?fluxion-performance=${index}`, { skipAnimation: true });
      ui.setTabWorkspace(tab, originalWorkspace);
      fixtures.push(tab);
    }
    const otherWorkspace = ui.workspaces().find(workspace => workspace.id !== originalWorkspace)?.id;
    assert(otherWorkspace, "Off-workspace performance assertion requires another workspace");
    const otherTab = gBrowser.addTrustedTab("about:blank?fluxion-performance=other-workspace", { skipAnimation: true });
    ui.setTabWorkspace(otherTab, otherWorkspace);
    fixtures.push(otherTab);
    ui.switchWorkspace(originalWorkspace);
    const selected = fixtures[100];
    ui.selectTab(selected);
    await waitFor(() => fixtures.every(tab => !tab.hasAttribute("busy")), "Performance fixture pages did not finish initial loads", 20000);
    await settle();

    const currentRows = () => new Map([...tree.querySelectorAll(".fluxion-tab")].map(row => [row._fluxionTab, row]));
    const baselineRows = currentRows();
    const visibleTabs = fixtures.slice(0, 200);
    assert(visibleTabs.every(tab => baselineRows.has(tab)), "Flow did not render all 200 fixture tabs");
    assert(!baselineRows.has(otherTab), "Off-workspace tab leaked into visible Flow");
    const closeButtons = new Map(visibleTabs.map(tab => [tab, baselineRows.get(tab).querySelector(".fluxion-close")]));
    const workspaceButtons = [...flow.querySelectorAll(".fluxion-workspace")];
    const focused = baselineRows.get(selected);
    focused.focus();
    focused.scrollIntoView({ block: "center" });
    await settle();
    const scrollTop = tree.scrollTop;
    assert(document.activeElement === focused, "Fixture could not focus selected Flow row");
    observer = new window.MutationObserver(recordMutations);
    observer.observe(flow, { childList: true, attributes: true, characterData: true, subtree: true });

    const assertStable = () => {
      drainMutations();
      const rows = currentRows();
      assert(visibleTabs.every(tab => rows.get(tab) === baselineRows.get(tab)), "A background content event replaced a Flow row");
      assert(visibleTabs.every(tab => rows.get(tab).querySelector(".fluxion-close") === closeButtons.get(tab)), "A background content event replaced a close control");
      const currentWorkspaceButtons = [...flow.querySelectorAll(".fluxion-workspace")];
      assert(currentWorkspaceButtons.length === workspaceButtons.length && workspaceButtons.every((button, index) => currentWorkspaceButtons[index] === button), "A background content event rebuilt workspace buttons");
      assert(document.activeElement === focused && gBrowser.selectedTab === selected, "Background updates moved keyboard focus or tab selection");
      assert(Math.abs(tree.scrollTop - scrollTop) <= 1, "Background updates shifted Flow scroll position");
      assert([...tree.querySelectorAll('[role="treeitem"]')].filter(row => row.tabIndex === 0).length === 1 && focused.tabIndex === 0, "Background updates changed the Flow roving tab stop");
      assert(structuralRemovals === 0, `Background updates removed ${structuralRemovals} structural Flow nodes`);
    };
    const background = visibleTabs.filter(tab => tab !== selected);
    for (let batch = 0; batch < 24; batch += 1) {
      const expected = [];
      const started = window.performance.now();
      for (let offset = 0; offset < 20; offset += 1) {
        const tab = background[(batch * 20 + offset) % background.length];
        const title = `Reference ${batch + 1}.${offset + 1}`;
        const playing = !tab.hasAttribute("soundplaying");
        tab.setAttribute("label", title);
        tab.toggleAttribute("soundplaying", playing);
        changed(tab, ["label", "soundplaying"]);
        expected.push({ tab, title, playing });
      }
      await waitFor(() => expected.every(({ tab, title, playing }) => {
        const row = baselineRows.get(tab);
        const audio = row.querySelector(".fluxion-audio");
        return row.querySelector(".fluxion-title")?.textContent === title &&
          row.getAttribute("aria-label").includes(title) &&
          row.querySelector(".fluxion-close").getAttribute("aria-label") === `Close ${title}` &&
          (playing
            ? audio && !audio.hidden && window.getComputedStyle(audio).display !== "none" &&
              audio.getAttribute("aria-label") === "Mute tab"
            : audio?.hidden && window.getComputedStyle(audio).display === "none");
      }), `Flow did not project title and audio state for batch ${batch + 1}`);
      latencies.push(window.performance.now() - started);
      assertStable();
    }

    const audioTab = background[0];
    const visibleAudioAction = label => {
      const audio = baselineRows.get(audioTab).querySelector(".fluxion-audio");
      return audio && !audio.hidden && window.getComputedStyle(audio).display !== "none" &&
        audio.getAttribute("aria-label") === label;
    };
    audioTab.setAttribute("soundplaying", "true");
    changed(audioTab, ["soundplaying"]);
    await waitFor(() => visibleAudioAction("Mute tab"), "Native audio action did not appear");
    baselineRows.get(audioTab).querySelector(".fluxion-audio").click();
    await waitFor(() => audioTab.hasAttribute("muted") && visibleAudioAction("Unmute tab"), "Flow audio action did not mute the native tab");
    baselineRows.get(audioTab).querySelector(".fluxion-audio").click();
    await waitFor(() => !audioTab.hasAttribute("muted") && visibleAudioAction("Mute tab"), "Flow audio action did not unmute the native tab");
    assertStable();

    const selectedTitle = "Selected reference updated";
    selected.setAttribute("label", selectedTitle);
    changed(selected, ["label"]);
    await waitFor(() => document.title === `${selectedTitle} — Fluxion` &&
      focused.querySelector(".fluxion-title")?.textContent === selectedTitle, "Selected title did not reach the window title and Flow");
    assertStable();

    await settle();
    drainMutations();
    const beforeIgnored = mutationRecords;
    background[1].setAttribute("fluxion-performance-unrelated", "true");
    changed(background[1], ["fluxion-performance-unrelated"]);
    otherTab.setAttribute("label", "Hidden workspace reference updated");
    changed(otherTab, ["label"]);
    await settle();
    assertStable();
    assert(mutationRecords === beforeIgnored, "Unrelated or off-workspace attributes caused visible Flow mutations");
  }

  async function verifyTabSearch() {
    await waitFor(() => window.FluxionPalette, "Shipped palette did not initialise", 10000);
    // Keep the original 200-row gate independent of this larger corpus.
    drainMutations();
    backgroundMetrics = metrics();
    observer?.disconnect();
    observer = null;
    while (fixtures.length < 1000) {
      const tab = gBrowser.addTrustedTab("about:blank", { skipAnimation: true, createLazyBrowser: true });
      ui.setTabWorkspace(tab, originalWorkspace);
      fixtures.push(tab);
    }
    for (let index = 0; index < fixtures.length; index++) {
      fixtures[index].setAttribute("label", `Fluxion search corpus ${index} websocket authentication documentation`);
      changed(fixtures[index], ["label"]);
    }
    await settle();
    window.FluxionPalette.open("tabs");
    const input = document.getElementById("fluxion-palette-input");
    const results = document.getElementById("fluxion-palette-results");
    await waitFor(() => document.activeElement === input, "Tab search did not focus its input");
    const labels = () => [...results.querySelectorAll(".fluxion-palette-result-label")].map(node => node.textContent);
    const query = async (value, expected = null, partial = false) => {
      input.value = value;
      const start = window.performance.now();
      input.dispatchEvent(new window.Event("input", { bubbles: true }));
      await frame();
      searchLatencies.push(window.performance.now() - start);
      const rows = labels();
      assert(rows.length <= 12, "Tab search exceeded its twelve-result DOM bound");
      assert(document.activeElement === input, "Tab search moved focus away from the typing field");
      if (expected) assert(rows[0] === expected, `Latest tab query did not rank expected live metadata first: ${value}`);
      else if (!partial) assert(rows.length === 12, "Common corpus query did not fill the bounded results");
    };
    for (let repeat = 0; repeat < 3; repeat++) {
      for (const value of ["w", "web", "websocket", "websocket auth"]) await query(value);
    }
    const target = fixtures[850], second = fixtures[851];
    target.setAttribute("label", "École current unique target");
    changed(target, ["label"]);
    const otherWorkspace = ui.workspaces().find(workspace => workspace.id !== originalWorkspace).id;
    const group = gBrowser.addTabGroup([target, second], { label: "Quasar unique research", color: "blue" });
    // Prime both caches before changing metadata, then query the changed fields.
    await query("ecole current unique target", target.label);
    ui.setTabWorkspace(target, otherWorkspace);
    ui.setTabWorkspace(second, otherWorkspace);
    target.setAttribute("label", "Café revised unique target");
    changed(target, ["label"]);
    group.label = "Nebula revised group";
    await query("cafe revised unique target", target.label);
    await query("Nebula revised group", null, true);
    assert(labels().includes(target.label), "Renamed native group metadata stayed stale in tab search");
    await query(otherWorkspace, null, true);
    assert(labels().includes(target.label), "Moved workspace metadata stayed stale in tab search");
    input.value = "earlier query must disappear";
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    await query("cafe revised unique target", target.label);
    await settle();
    assert(labels()[0] === target.label, "A late query replaced the newest tab-search result");
    const sorted = [...searchLatencies].sort((a, b) => a - b);
    const percentile = fraction => sorted[Math.ceil(sorted.length * fraction) - 1];
    const report = { fixtureTabs: fixtures.length, nativeTabs: gBrowser.tabs.length, samples: sorted.length,
      inputToFrameMs: { p50: percentile(.5), p95: percentile(.95), max: sorted.at(-1) },
      latenciesMs: searchLatencies, input: "Gecko DOM input events; not OS typing or a high-refresh-rate guarantee" };
    Services.prefs.setStringPref(`${prefix}.tabSearch.metrics`, JSON.stringify(report));
    // Hosted-runner regression guard, not a frame-rate performance target.
    assert(report.inputToFrameMs.p95 < 500 && report.inputToFrameMs.max < 1500,
      "Thousand-tab search exceeded the hosted-runner responsiveness ceiling");
    Services.prefs.setStringPref(`${prefix}.tabSearch.health`, "bounded-1000-tab-search-live-metadata-and-focus-verified");
    window.FluxionPalette.close();
  }

  run().then(verifyTabSearch).then(() => {
    drainMutations();
    Services.prefs.setStringPref(`${prefix}.metrics`, JSON.stringify(backgroundMetrics || metrics()));
    Services.prefs.setStringPref(`${prefix}.health`, "stable-200-tab-background-updates");
  }).catch(error => {
    drainMutations();
    Services.prefs.setStringPref(`${prefix}.metrics`, JSON.stringify(backgroundMetrics || metrics()));
    if (!Services.prefs.prefHasUserValue(`${prefix}.tabSearch.metrics`)) {
      Services.prefs.setStringPref(`${prefix}.tabSearch.metrics`, JSON.stringify({
        fixtureTabs: fixtures.length, samples: searchLatencies.length, latenciesMs: searchLatencies,
        completed: false,
      }));
    }
    Services.prefs.setStringPref(`${prefix}.error`, `${error?.message || error}\n${error?.stack || ""}`);
    Cu.reportError(error);
  }).finally(() => {
    observer?.disconnect();
    window.FluxionPalette?.close();
    if (originalSelected?.parentNode) ui.selectTab(originalSelected);
    const remaining = fixtures.filter(tab => tab.parentNode);
    if (remaining.length) gBrowser.removeTabs(remaining, { animate: false });
    Services.prefs.savePrefFile(null);
  });
})(window);
