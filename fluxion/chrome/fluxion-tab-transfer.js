/* global ChromeUtils, Services, SessionStore, Cu */
(function initialiseTabTransfer(window) {
  "use strict";
  if (!window.FluxionUI || window.FluxionTabTransfer) return;
  const { PrivateBrowsingUtils } = ChromeUtils.importESModule("resource://gre/modules/PrivateBrowsingUtils.sys.mjs");
  const windows = () => [...Services.wm.getEnumerator("navigator:browser")];
  const owner = tab => tab?.ownerGlobal || tab?.documentGlobal || tab?.ownerDocument?.defaultView;
  const liveWindow = target => target && !target.closed && windows().includes(target) && target.gBrowser && target.FluxionUI;
  const liveTab = (tab, target) => tab && target?.gBrowser && !target.closed && owner(tab) === target && tab.parentNode && !tab.closing && [...target.gBrowser.tabs].includes(tab);
  const workspace = tab => {
    try { return SessionStore.getCustomTabValue(tab, "fluxion-workspace") || tab.getAttribute("fluxion-workspace"); }
    catch (_) { return tab.getAttribute("fluxion-workspace"); }
  };
  function expand(tabs) {
    if (!Array.isArray(tabs) || !tabs.length) return [];
    return [...new Set(tabs.flatMap(tab => tab?.splitview?.tabs || [tab]))];
  }
  function eligibility(tabs, target, options = {}) {
    const moving = expand(tabs), source = owner(moving[0]);
    const deny = reason => ({ allowed: false, reason });
    if (!moving.length || !liveWindow(source) || tabs.some(tab => !liveTab(tab, source)) ||
        moving.some(tab => !liveTab(tab, source))) return deny("The source tabs are no longer available.");
    if (!liveWindow(target) || source === target) return deny("Choose another open Fluxion window.");
    if (PrivateBrowsingUtils.isWindowPrivate(source) !== PrivateBrowsingUtils.isWindowPrivate(target)) return deny("Tabs cannot move between private and regular windows.");
    if (moving.some(tab => tab.hasAttribute("fluxion-peek"))) return deny("Keep the Peek as a tab before moving it to another window.");
    if (options.targetTab && !liveTab(options.targetTab, target)) return deny("The destination tab is no longer available.");
    if (options.position && !["before", "after"].includes(options.position)) return deny("Invalid tab insertion position.");
    const ids = new Set(target.FluxionUI.workspaces().map(item => item.id));
    const requested = options.workspaceId ?? (options.targetTab ? workspace(options.targetTab) : null);
    if ((requested != null && !ids.has(requested)) || (requested == null && moving.some(tab => !ids.has(workspace(tab))))) {
      return deny("The destination workspace is no longer available.");
    }
    const browser = target.gBrowser;
    if (typeof browser.adoptTab !== "function" || typeof browser.pinTab !== "function" || typeof browser.unpinTab !== "function" ||
        typeof browser.ungroupTab !== "function" || [source, target].some(candidate =>
          typeof candidate.FluxionUI.withWorkspaceReconciliationPaused !== "function" ||
          typeof candidate.FluxionUI.reconcileTransferredTabs !== "function")) return deny("Native tab transfer is unavailable in this browser build.");
    if (moving.some(tab => tab.splitview) && typeof browser.adoptSplitView !== "function") return deny("Native split-view transfer is unavailable.");
    if (moving.some(tab => tab.splitview) && options.targetTab?.group && typeof browser.ungroupSplitView !== "function") {
      return deny("Native split-view transfer outside a tab group is unavailable.");
    }
    const set = new Set(moving);
    if (moving.some(tab => tab.group && [...tab.group.tabs].every(member => set.has(member))) &&
        typeof browser.adoptTabGroup !== "function") return deny("Native tab-group transfer is unavailable.");
    return { allowed: true, reason: "" };
  }
  function eligibleWindows(tabs) { return windows().filter(target => eligibility(tabs, target).allowed); }

  async function move(tabs, target, options = {}) {
    const checked = eligibility(tabs, target, options);
    if (!checked.allowed) return { tabs: [], selectedTab: null, complete: false, error: checked.reason };
    const moving = expand(tabs).sort((a, b) => a._tPos - b._tPos);
    const source = owner(moving[0]), selected = moving.includes(options.selectTab) ? options.selectTab :
      moving.includes(source.gBrowser.selectedTab) ? source.gBrowser.selectedTab : moving[0];
    const snapshots = new Map(moving.map(tab => [tab, {
      workspace: options.workspaceId ?? (options.targetTab ? workspace(options.targetTab) : workspace(tab)),
      pinned: Boolean(tab.pinned), orientation: tab.splitview ? source.FluxionUI.splitOrientation(tab) : null,
    }]));
    const members = new Set(moving), seen = new Set(), units = [];
    for (const tab of moving) {
      const wholeGroup = tab.group && [...tab.group.tabs].every(member => members.has(member));
      const element = wholeGroup ? tab.group : tab.splitview || tab;
      if (seen.has(element)) continue;
      seen.add(element);
      units.push({ element, kind: wholeGroup ? "group" : tab.splitview ? "split" : "tab",
        tabs: wholeGroup || tab.splitview ? [...element.tabs] : [tab], collapsed: Boolean(element.collapsed) });
    }
    const adopted = new Map();
    let error = null;
    const configure = (oldTab, newTab) => {
      if (!snapshots.has(oldTab) || !liveTab(newTab, target)) return;
      adopted.set(oldTab, newTab);
      if (!target.FluxionUI.workspaces().some(item => item.id === snapshots.get(oldTab).workspace)) {
        throw new Error("The destination workspace changed during transfer.");
      }
      target.FluxionUI.setTabWorkspace(newTab, snapshots.get(oldTab).workspace);
      newTab.removeAttribute("fluxion-workspace-active");
      SessionStore.deleteCustomTabValue(newTab, "fluxion-workspace-active");
    };
    // Native group/split adoption can throw after a subset has moved. Observe
    // Gecko's real old/new mapping so those live pages remain accounted for.
    const onOpen = event => {
      if (snapshots.has(event.detail?.adoptedTab)) adopted.set(event.detail.adoptedTab, event.target);
    };
    const tabContainer = target.gBrowser.tabContainer;
    tabContainer.addEventListener("TabOpen", onOpen);
    try {
      source.FluxionUI.withWorkspaceReconciliationPaused(() => target.FluxionUI.withWorkspaceReconciliationPaused(() => {
        const rechecked = eligibility(moving, target, options);
        if (!rechecked.allowed) throw new Error(rechecked.reason);
        if ([...source.gBrowser.tabs].every(tab => members.has(tab))) {
          const anchor = source.gBrowser.addTrustedTab(Services.prefs.getStringPref("fluxion.newtab.url", "about:newtab"));
          source.FluxionUI.setTabWorkspace(anchor, source.FluxionUI.currentWorkspace());
        }
        let index = options.targetTab ? options.targetTab._tPos + (options.position === "before" ? 0 : 1) : target.gBrowser.tabs.length;
        for (const unit of units) {
          if (!liveWindow(target) || !liveWindow(source) || unit.tabs.some(tab => !liveTab(tab, source)) ||
              (options.targetTab && !liveTab(options.targetTab, target))) throw new Error("A tab or window changed during transfer.");
          const pinned = unit.kind === "tab" && snapshots.get(unit.tabs[0]).pinned;
          const tabIndex = pinned ? Math.min(index, target.gBrowser.pinnedTabCount) : Math.max(index, target.gBrowser.pinnedTabCount);
          const value = unit.kind === "group" ? target.gBrowser.adoptTabGroup(unit.element, { tabIndex, selectTab: false }) :
            unit.kind === "split" ? target.gBrowser.adoptSplitView(unit.element, { tabIndex, selectTab: false }) :
              target.gBrowser.adoptTab(unit.element, { tabIndex, selectTab: false });
          const results = unit.kind === "tab" ? (value ? [value] : []) : [...(value?.tabs || [])];
          if (results.length !== unit.tabs.length) throw new Error("Gecko could not adopt every requested tab.");
          unit.tabs.forEach((oldTab, offset) => configure(oldTab, results[offset]));
          if (unit.kind === "group") value.collapsed = unit.collapsed;
          else if (unit.kind === "split") {
            // Moving panes individually out of an incidental destination group
            // dismantles their native split wrapper. Move that wrapper intact.
            if (results.some(tab => tab.group)) {
              if (typeof target.gBrowser.ungroupSplitView !== "function") throw new Error("Native split-view ungrouping is unavailable.");
              target.gBrowser.ungroupSplitView(value);
            }
          } else for (const tab of results) if (tab.group) target.gBrowser.ungroupTab(tab);
          for (const oldTab of unit.tabs) {
            const tab = adopted.get(oldTab), snapshot = snapshots.get(oldTab);
            if (!tab) throw new Error("An adopted tab is no longer available.");
            if (snapshot.pinned && !tab.pinned) target.gBrowser.pinTab(tab);
            if (!snapshot.pinned && tab.pinned) target.gBrowser.unpinTab(tab);
            if (snapshot.orientation && tab.splitview) target.FluxionUI.setSplitOrientation(tab, snapshot.orientation);
          }
          index = Math.max(...results.map(tab => tab._tPos)) + 1;
        }
      }));
    } catch (cause) { error = cause?.message || String(cause); Cu.reportError(cause); }
    finally {
      tabContainer.removeEventListener("TabOpen", onOpen);
      if (liveWindow(target)) {
        try {
          target.FluxionUI.withWorkspaceReconciliationPaused(() => {
            for (const [oldTab, newTab] of adopted) if (liveTab(newTab, target)) configure(oldTab, newTab);
          });
        } catch (cause) { error ||= cause?.message || String(cause); Cu.reportError(cause); }
      }
    }
    const resultTabs = moving.map(tab => adopted.get(tab)).filter(tab => liveTab(tab, target));
    const candidate = adopted.get(selected);
    const selectedTab = resultTabs.includes(candidate) ? candidate : resultTabs[0] || null;
    try {
      if (selectedTab && options.selectTab !== false) target.FluxionUI.selectTab(selectedTab);
      if (liveWindow(source)) source.FluxionUI.reconcileTransferredTabs();
      if (liveWindow(target)) target.FluxionUI.reconcileTransferredTabs();
      if (!error && resultTabs.length === moving.length && options.selectTab !== false &&
          liveWindow(target) && liveTab(selectedTab, target)) target.focus();
    } catch (cause) { error ||= cause?.message || String(cause); Cu.reportError(cause); }
    return { tabs: resultTabs, selectedTab, complete: !error && resultTabs.length === moving.length, ...(error ? { error } : {}) };
  }

  async function detach(tabs, { selectedTab, selectTab = selectedTab, workspaceId } = {}) {
    const moving = expand(tabs), source = owner(moving[0]);
    if (!liveWindow(source) || !moving.length || tabs.some(tab => !liveTab(tab, source)) ||
        moving.some(tab => !liveTab(tab, source) || tab.hasAttribute("fluxion-peek"))) {
      return { tabs: [], selectedTab: null, complete: false, error: "Only live, permanent tabs can move to a new window." };
    }
    let target;
    try { target = source.OpenBrowserWindow({ private: PrivateBrowsingUtils.isWindowPrivate(source) }); }
    catch (cause) { return { tabs: [], selectedTab: null, complete: false, error: cause?.message || String(cause) }; }
    if (!target) return { tabs: [], selectedTab: null, complete: false, error: "The new browser window could not be opened." };
    const deadline = Date.now() + 20000;
    while (!target.closed && (!target.gBrowserInit?.delayedStartupFinished || !target.FluxionUI)) {
      if (Date.now() >= deadline || source.closed) return { tabs: [], selectedTab: null, complete: false, window: target, error: "The new window did not finish starting." };
      await new Promise(resolve => window.setTimeout(resolve, 50));
    }
    const initial = target.gBrowser?.tabs.length === 1 ? target.gBrowser.tabs[0] : null;
    const initialBrowser = initial?.linkedBrowser;
    const initialGlobal = initialBrowser?.browsingContext?.currentWindowGlobal;
    const initialURI = initialBrowser?.currentURI?.spec;
    const emptyURIs = new Set(["about:blank", "about:newtab", Services.prefs.getStringPref("fluxion.newtab.url", "about:newtab")]);
    const result = await move(moving, target, { selectTab, workspaceId });
    if (result.complete && liveTab(initial, target) && !result.tabs.includes(initial) &&
        emptyURIs.has(initialURI) && initialBrowser.currentURI.spec === initialURI &&
        initialBrowser.browsingContext?.currentWindowGlobal === initialGlobal &&
        initialBrowser.browsingContext?.sessionHistory?.count === 1 &&
        !initial.pinned && !initial.group && !initial.splitview && !initial.hasAttribute("busy")) {
      target.gBrowser.removeTab(initial, { skipSessionStore: true, animate: false });
    }
    return { ...result, window: target };
  }
  window.FluxionTabTransfer = Object.freeze({ eligibleWindows, eligibility, move, detach });
})(window);
