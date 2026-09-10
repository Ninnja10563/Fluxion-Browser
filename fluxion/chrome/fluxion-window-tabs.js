/* global Services, FluxionTransferDrag, FluxionTabDrop, FluxionTabSelection */
(function initialiseWindowTabs(window) {
  "use strict";
  const { document, gBrowser, FluxionUI: ui, FluxionTabTransfer: transfer } = window;
  const flow = document.getElementById("fluxion-flow");
  const context = document.getElementById("fluxion-tab-context");
  if (!flow || !context || !transfer || window.FluxionWindowTabs) return;
  const cleanups = [];
  const on = (node, event, callback, options) => {
    node.addEventListener(event, callback, options);
    cleanups.push(() => node.removeEventListener(event, callback, options));
  };
  const status = flow.querySelector('[role="status"]');
  let dragging = [];
  let marker = null;
  const menus = [];
  const browserWindows = () => [...Services.wm.getEnumerator("navigator:browser")]
    .filter(candidate => !candidate.closed && candidate.gBrowser && candidate.FluxionUI);
  const ownerOf = FluxionTransferDrag.ownerOf;
  function isBrowserTab(tab, memberships = null) {
    try {
      return tab?.localName === "tab" && !tab.closing &&
        Services.scriptSecurityManager.isSystemPrincipal(tab.nodePrincipal) &&
        (memberships ? memberships.get(ownerOf(tab))?.has(tab) :
          browserWindows().includes(ownerOf(tab)) && [...ownerOf(tab).gBrowser.tabs].includes(tab));
    } catch (_) { return false; }
  }
  const readDrag = event => {
    const memberships = new Map(browserWindows().map(candidate => [candidate, new Set(candidate.gBrowser.tabs)]));
    return FluxionTransferDrag.read(event.dataTransfer, tab => isBrowserTab(tab, memberships));
  };
  const rowFor = event => event.target?.closest?.(".fluxion-tab");
  function clearMarker() {
    if (marker) {
      for (const name of ["data-drop-intent", "data-drop-action", "data-drop-label", "data-dragover"]) {
        marker.removeAttribute(name);
      }
    }
    marker = null;
  }
  function finish(result) {
    if (!result?.complete) {
      Services.prompt.alert(window, "Tabs Not Fully Moved",
        result?.error?.message || result?.error || "Some tabs could not be moved. Their pages remain in their current windows.");
    } else if (status) {
      status.textContent = `${result.tabs.length} ${result.tabs.length === 1 ? "tab moved" : "tabs moved"} to another window.`;
    }
    return result;
  }
  function run(action) {
    return Promise.resolve().then(action).then(finish).catch(error => {
      Cu.reportError(error);
      return finish({ complete: false, error });
    });
  }

  function dropDestination(event, tabs) {
    const row = rowFor(event);
    const workspace = event.target?.closest?.(".fluxion-workspace");
    // Group headings have their own explicit grouping interaction. A foreign
    // group must not silently flatten into that group during a window move.
    if (event.target?.closest?.(".fluxion-group-heading")) return null;
    if (row?._fluxionTab && isBrowserTab(row._fluxionTab)) {
      const intent = FluxionTabDrop.classify({
        clientX: event.clientX, clientY: event.clientY, rect: row.getBoundingClientRect(), canSplit: false,
      });
      if (intent.action === "none") return null;
      return { element: row, options: {
        targetTab: row._fluxionTab, position: intent.position, workspaceId: ui.tabWorkspace(row._fluxionTab),
      }, intent };
    }
    if (workspace?.dataset.workspaceId) {
      return { element: workspace, options: { workspaceId: workspace.dataset.workspaceId } };
    }
    const list = event.target?.closest?.(".fluxion-tabs");
    if (list && tabs.length) return { element: list, options: { workspaceId: ui.currentWorkspace() } };
    return null;
  }

  on(flow, "dragstart", event => {
    dragging = [];
    const tab = rowFor(event)?._fluxionTab;
    if (!isBrowserTab(tab) || ownerOf(tab) !== window) return;
    const tabs = FluxionTabSelection.contextTabs(tab, gBrowser.selectedTabs);
    if (FluxionTransferDrag.write(event.dataTransfer, tabs)) dragging = [...tabs];
  });
  on(flow, "dragover", event => {
    const tabs = readDrag(event);
    if (!tabs.length || ownerOf(tabs[0]) === window) return;
    event.stopPropagation();
    const destination = dropDestination(event, tabs);
    const eligible = destination && transfer.eligibility(tabs, window, destination.options);
    clearMarker();
    if (!eligible?.allowed) {
      event.dataTransfer.dropEffect = "none";
      if (status) status.textContent = eligible?.reason || "Choose a tab, workspace, or open tab-list area.";
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    marker = destination.element;
    if (destination.intent) {
      marker.dataset.dropIntent = `reorder-${destination.intent.position}`;
      marker.dataset.dropAction = "reorder";
      marker.dataset.dropLabel = "Move here";
    } else marker.setAttribute("data-dragover", "true");
    if (status) status.textContent = "Drop to move these tabs into this window.";
  }, true);
  on(flow, "dragleave", event => {
    if (!event.relatedTarget?.nodeType || !flow.contains(event.relatedTarget)) clearMarker();
  });
  on(flow, "drop", event => {
    const tabs = readDrag(event);
    if (!tabs.length || ownerOf(tabs[0]) === window) return;
    event.preventDefault();
    event.stopPropagation();
    const destination = dropDestination(event, tabs);
    const eligible = destination && transfer.eligibility(tabs, window, destination.options);
    clearMarker();
    if (!eligible?.allowed) {
      event.dataTransfer.dropEffect = "none";
      if (status) status.textContent = eligible?.reason || "These tabs cannot be dropped here.";
      return;
    }
    event.dataTransfer.dropEffect = "move";
    run(() => transfer.move(tabs, window, destination.options));
  }, true);
  on(flow, "dragend", event => {
    const tabs = dragging;
    dragging = [];
    clearMarker();
    if (!tabs.length || tabs.some(tab => !isBrowserTab(tab) || ownerOf(tab) !== window)) return;
    const windows = browserWindows().map(candidate => ({
      left: candidate.screenX, top: candidate.screenY, width: candidate.outerWidth, height: candidate.outerHeight,
    }));
    if (FluxionTransferDrag.shouldDetach({
      trusted: event.isTrusted, canceled: event.dataTransfer?.mozUserCancelled,
      effect: event.dataTransfer?.dropEffect, screenX: event.screenX, screenY: event.screenY, windows,
    })) run(() => transfer.detach(tabs));
  });

  const xul = (name, attributes = {}) => {
    const node = document.createXULElement(name);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
    return node;
  };
  function installMoveMenu(context, readContextTabs, group = false) {
    let contextSnapshot = [];
    const menu = xul("menu", { id: group ? "fluxion-move-group-window-menu" : "fluxion-move-window-menu", label: "Move to Window" });
    const popup = xul("menupopup", { id: group ? "fluxion-move-group-window-popup" : "fluxion-move-window-popup" });
    menu.appendChild(popup);
    menus.push(menu);
    context.insertBefore(menu, context.lastElementChild?.previousElementSibling || null);
    function addItem(label, action, attributes = {}) {
      const item = xul("menuitem", { label, ...attributes });
      if (action) item.addEventListener("command", action);
      popup.appendChild(item);
      return item;
    }
    on(context, "popupshowing", event => {
      if (event.target === context) contextSnapshot = [...readContextTabs()];
    });
    on(popup, "popupshowing", event => {
      if (event.target !== popup) return;
      popup.replaceChildren();
      const tabs = [...contextSnapshot];
      if (!tabs.length || tabs.some(tab => !isBrowserTab(tab) || ownerOf(tab) !== window)) {
        addItem("These tabs are no longer available", null, { disabled: "true" });
        return;
      }
      if (tabs.some(tab => window.FluxionPeek?.isPeek(tab))) {
        addItem("Keep Peek as Tab before moving", null, { disabled: "true" });
        return;
      }
      addItem("New Window", () => run(() => transfer.detach(tabs)), {
        id: group ? "fluxion-move-group-new-window" : "fluxion-move-new-window",
      });
      const targets = transfer.eligibleWindows(tabs);
      if (targets.length) popup.appendChild(xul("menuseparator"));
      targets.forEach((target, index) => {
        const page = target.gBrowser.selectedTab?.label || "Untitled";
        const workspaceId = target.FluxionUI.currentWorkspace();
        const workspace = target.FluxionUI.workspaces().find(item => item.id === workspaceId)?.name;
        addItem(`${index + 1}. ${workspace ? `${workspace} — ` : ""}${page.slice(0, 90)}`,
          () => run(() => transfer.move(tabs, target, { workspaceId })), { "data-fluxion-window-target": String(index) });
      });
    });
    on(context, "popuphidden", event => { if (event.target === context) contextSnapshot = []; });
  }
  installMoveMenu(context, () => ui.contextTabs());
  const groupContext = document.getElementById("fluxion-group-context");
  if (groupContext && ui.groupContextTabs) installMoveMenu(groupContext, () => ui.groupContextTabs(), true);
  on(window, "unload", () => {
    while (cleanups.length) cleanups.pop()();
    for (const menu of menus) menu.remove();
    delete window.FluxionWindowTabs;
  }, { once: true });
  window.FluxionWindowTabs = Object.freeze({ ready: true });
})(window);
