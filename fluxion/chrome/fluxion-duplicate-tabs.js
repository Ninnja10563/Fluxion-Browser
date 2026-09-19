/* global Services, Cu, FluxionDuplicateTabsCore */
(function initialiseDuplicateTabs(window) {
  "use strict";
  const { document, gBrowser, FluxionUI: ui } = window;
  const popup = document.getElementById("fluxion-tab-context");
  if (!popup || !ui || window.FluxionDuplicateTabs) return;
  const item = document.createXULElement("menuitem");
  item.id = "fluxion-close-duplicate-tabs";
  item.setAttribute("label", "Close Duplicate Tabs…");
  item.setAttribute("tooltiptext", "Review exact duplicate web addresses in this workspace; different accounts stay separate");
  popup.insertBefore(item, popup.lastElementChild);
  let snapshot = null, disposed = false, running = false;
  const live = tab => Boolean(tab?.parentNode && !tab.closing && !window.closed && !window.FluxionEmptyWorkspace?.isPlaceholder(tab) &&
    gBrowser.getTabForBrowser(tab.linkedBrowser) === tab &&
    (tab.ownerGlobal || tab.documentGlobal || tab.ownerDocument?.defaultView) === window);
  const protectedTab = (tab, context) => Boolean(context.has(tab) || tab === gBrowser.selectedTab ||
    tab.selected || tab.multiselected || tab.pinned || tab.group || tab.splitview ||
    tab.soundPlaying || tab.muted || tab.activeMediaBlocked || tab._pendingPermitUnload ||
    // Gecko removes the visible sharing attribute for paused capture, but its
    // browser-owned sharing record still identifies that live capture session.
    tab.linkedBrowser?._sharingState?.webRTC?.sharing ||
    ["multiselected", "pinned", "fluxion-peek", "busy", "soundplaying", "muted", "activemedia-blocked",
      "pictureinpicture", "sharing", "undiscardable"].some(name => tab.hasAttribute(name)));
  function capture(context) {
    const workspace = ui.currentWorkspace();
    if (!ui.workspaces().some(space => space.id === workspace)) return null;
    const records = [...gBrowser.tabs].filter(tab => live(tab) && ui.tabWorkspace(tab) === workspace)
      .map(tab => Object.freeze({ tab, browser: tab.linkedBrowser, parent: tab.parentNode,
        url: tab.linkedBrowser.currentURI.spec, containerId: tab.userContextId,
        workspaceId: workspace, protected: protectedTab(tab, context) }));
    return { workspace, context, records, plan: FluxionDuplicateTabsCore.planDuplicateTabs(records) };
  }
  function sameRecord(record, context) {
    const tab = record.tab;
    return live(tab) && tab.linkedBrowser === record.browser && tab.parentNode === record.parent &&
      tab.linkedBrowser.currentURI.spec === record.url && tab.userContextId === record.containerId &&
      ui.tabWorkspace(tab) === record.workspaceId && protectedTab(tab, context) === record.protected;
  }
  function valid(value, whole = true) {
    if (!value || disposed || window.closed || ui.currentWorkspace() !== value.workspace ||
        !ui.workspaces().some(space => space.id === value.workspace)) return false;
    if (!whole) return true;
    const tabs = [...gBrowser.tabs].filter(tab => live(tab) && ui.tabWorkspace(tab) === value.workspace);
    return tabs.length === value.records.length && value.records.every((record, index) =>
      tabs[index] === record.tab && sameRecord(record, value.context));
  }
  const invalidate = () => { snapshot = null; item.setAttribute("disabled", "true"); };
  const show = event => {
    if (event.target !== popup) return;
    try { snapshot = running ? null : capture(new Set(ui.contextTabs())); }
    catch (error) { snapshot = null; Cu.reportError(error); }
    const count = snapshot?.plan.length || 0;
    item.setAttribute("label", count ? `Close ${count} Duplicate ${count === 1 ? "Tab" : "Tabs"}…` : "Close Duplicate Tabs…");
    item.toggleAttribute("disabled", !count);
  };
  const hidden = event => { if (event.target === popup) invalidate(); };
  const command = () => {
    const value = snapshot;
    invalidate();
    if (running || !value?.plan.length || !valid(value)) return;
    running = true;
    try {
      const count = value.plan.length;
      const flags = Services.prompt.BUTTON_POS_0 * Services.prompt.BUTTON_TITLE_IS_STRING |
        Services.prompt.BUTTON_POS_1 * Services.prompt.BUTTON_TITLE_CANCEL | Services.prompt.BUTTON_POS_1_DEFAULT;
      const accepted = Services.prompt.confirmEx(window, "Close Duplicate Tabs",
        `Close ${count} duplicate ${count === 1 ? "tab" : "tabs"} in this workspace?\n\n` +
        "Only identical web addresses in the same container are matched. Selected, pinned, grouped, split, preview and active-media tabs are kept.\n\n" +
        "You can restore closed tabs with Reopen Closed Tab.", flags,
        `Close ${count} ${count === 1 ? "Tab" : "Tabs"}`, null, null, null, {});
      // Native dialogs spin a nested event loop: navigation, account changes,
      // workspace changes and window closure can all invalidate prior consent.
      if (accepted !== 0 || !valid(value)) return;
      for (const { target, keeper } of value.plan) {
        if (!valid(value, false) || !sameRecord(target, value.context) ||
            !sameRecord(keeper, value.context)) break;
        // Gecko owns beforeunload and SessionStore. Never bypass either, and
        // stop the batch if a page refuses closure rather than prompting again.
        gBrowser.removeTab(target.tab, { animate: false });
        if (live(target.tab)) break;
      }
    } catch (error) { Cu.reportError(error); }
    finally { running = false; }
  };
  popup.addEventListener("popupshowing", show);
  popup.addEventListener("popuphidden", hidden);
  item.addEventListener("command", command);
  for (const type of ["TabClose", "TabMove", "TabBrowserInserted"])
    gBrowser.tabContainer.addEventListener(type, invalidate);
  window.addEventListener("unload", () => {
    disposed = true; invalidate();
    popup.removeEventListener("popupshowing", show);
    popup.removeEventListener("popuphidden", hidden);
    item.removeEventListener("command", command);
    for (const type of ["TabClose", "TabMove", "TabBrowserInserted"])
      gBrowser.tabContainer.removeEventListener(type, invalidate);
    item.remove(); delete window.FluxionDuplicateTabs;
  }, { once: true });
  window.FluxionDuplicateTabs = Object.freeze({ available: true });
})(window);
