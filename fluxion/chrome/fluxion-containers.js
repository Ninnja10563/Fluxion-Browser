/* global ChromeUtils, Services, SessionStore, Cu */
(function initialiseContainers(window) {
  "use strict";
  const { document, gBrowser, FluxionUI: ui } = window;
  const root = document.getElementById("fluxion-tab-context");
  if (!root || !ui || window.FluxionContainers) return;
  const { ContextualIdentityService: identities } = ChromeUtils.importESModule(
    "moz-src:///toolkit/components/contextualidentity/ContextualIdentityService.sys.mjs");
  const { PrivateBrowsingUtils } = ChromeUtils.importESModule("resource://gre/modules/PrivateBrowsingUtils.sys.mjs");
  const { E10SUtils } = ChromeUtils.importESModule("resource://gre/modules/E10SUtils.sys.mjs");
  const xul = (tag, attributes = {}) => {
    const node = document.createXULElement(tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
    return node;
  };
  const menu = xul("menu", { id: "fluxion-container-menu", label: "Open in Container" });
  const popup = xul("menupopup", { id: "fluxion-container-popup" });
  menu.appendChild(popup);
  root.insertBefore(menu, root.firstElementChild);
  const allowed = () => !window.closed && !PrivateBrowsingUtils.isWindowPrivate(window) &&
    Services.prefs.getBoolPref("privacy.userContext.enabled", false) &&
    Services.policies?.getActivePolicies()?.Containers?.Enabled !== false;
  const live = tab => tab?.parentNode && !tab.closing && [...gBrowser.tabs].includes(tab) &&
    (tab.ownerGlobal || tab.documentGlobal || tab.ownerDocument?.defaultView) === window;
  const identityKey = identity => JSON.stringify(identity);
  let current = null, disposed = false, revision = 0;
  function capture(tabs) {
    if (!allowed() || !Array.isArray(tabs) || !tabs.length || tabs.some(tab => !live(tab))) return null;
    const entries = [...new Set(tabs)].map(tab => Object.freeze({ tab, url: tab.linkedBrowser.currentURI.spec,
      workspace: ui.tabWorkspace(tab), userContextId: Number(tab.getAttribute("usercontextid") || 0) }));
    return Object.freeze({ revision, entries: Object.freeze(entries), identities: Object.freeze(identities.getPublicIdentities()
      .filter(identity => Number.isInteger(identity.userContextId) && identity.userContextId > 0)
      .map(identity => Object.freeze({ id: identity.userContextId, key: identityKey(identity),
        label: identities.getUserContextLabel(identity.userContextId) }))) });
  }
  function valid(snapshot, userContextId) {
    if (disposed || !allowed() || snapshot?.revision !== revision || !snapshot?.entries?.length) return false;
    const selected = snapshot.identities.find(identity => identity.id === userContextId);
    const identity = identities.getPublicIdentityFromId(userContextId);
    if (!selected || !identity || selected.key !== identityKey(identity)) return false;
    const workspaceIds = new Set(ui.workspaces().map(workspace => workspace.id));
    return snapshot.entries.every(entry => live(entry.tab) && workspaceIds.has(entry.workspace) &&
      ui.tabWorkspace(entry.tab) === entry.workspace && entry.tab.linkedBrowser.currentURI.spec === entry.url &&
      Number(entry.tab.getAttribute("usercontextid") || 0) === entry.userContextId);
  }
  function open(snapshot, userContextId) {
    if (!valid(snapshot, userContextId)) return [];
    const planned = snapshot.entries.filter(entry => entry.userContextId !== userContextId).map(entry => {
      // Follow Firefox155's native reopen-in-container principal policy. Do not
      // duplicate SessionStore state: cookies, POST data and form values stay in
      // the original container. A lazy tab contributes only its principal.
      let principal = entry.tab.linkedPanel ? entry.tab.linkedBrowser.contentPrincipal :
        E10SUtils.deserializePrincipal(JSON.parse(SessionStore.getTabState(entry.tab)).triggeringPrincipal_base64);
      if (!principal || principal.isNullPrincipal) principal = Services.scriptSecurityManager.createNullPrincipal({ userContextId });
      else if (principal.isContentPrincipal) principal = Services.scriptSecurityManager.principalWithOA(principal, { userContextId });
      return { ...entry, principal };
    });
    if (!valid(snapshot, userContextId)) return [];
    const opened = [], selected = gBrowser.selectedTab;
    try {
      ui.withWorkspaceReconciliationPaused(() => {
        for (const entry of planned) {
          if (!valid(snapshot, userContextId)) break;
          const tab = gBrowser.addTab(entry.url, { userContextId, triggeringPrincipal: entry.principal,
            pinned: Boolean(entry.tab.pinned), tabIndex: entry.tab._tPos + 1 });
          ui.setTabWorkspace(tab, entry.workspace);
          opened.push(tab);
          if (entry.tab.muted && !tab.muted) tab.toggleMuteAudio(entry.tab.muteReason);
          if (entry.tab === selected) gBrowser.selectedTab = tab;
        }
      });
    } finally { ui.reconcileTransferredTabs(); }
    return opened;
  }
  const showRoot = event => {
    if (event.target !== root) return;
    current = capture(ui.contextTabs());
    menu.hidden = !current?.identities.length;
    menu.setAttribute("label", current?.entries.length > 1 ? `Open ${current.entries.length} Tabs in Container` : "Open in Container");
  };
  const showPopup = event => {
    if (event.target !== popup) return;
    popup.replaceChildren();
    const snapshot = current;
    for (const identity of snapshot?.identities || []) {
      const item = xul("menuitem", { label: identity.label, "data-usercontextid": String(identity.id) });
      if (!valid(snapshot, identity.id) || snapshot.entries.every(entry => entry.userContextId === identity.id)) item.setAttribute("disabled", "true");
      item.addEventListener("command", () => {
        if (current !== snapshot) return;
        try { open(snapshot, identity.id); }
        catch (error) { Cu.reportError(error); Services.prompt.alert(window, "Container Tab Not Opened",
          "The page could not be opened in that container. The original tabs have not been changed."); }
      });
      popup.appendChild(item);
    }
  };
  const hideRoot = event => { if (event.target === root) current = null; };
  const invalidate = () => { revision += 1; current = null; menu.hidden = true; };
  const observer = { observe: invalidate };
  root.addEventListener("popupshowing", showRoot);
  popup.addEventListener("popupshowing", showPopup);
  root.addEventListener("popuphidden", hideRoot);
  Services.obs.addObserver(observer, "contextual-identity-deleted");
  Services.prefs.addObserver("privacy.userContext.enabled", observer);
  window.addEventListener("unload", () => {
    disposed = true; current = null;
    root.removeEventListener("popupshowing", showRoot); popup.removeEventListener("popupshowing", showPopup);
    root.removeEventListener("popuphidden", hideRoot);
    Services.obs.removeObserver(observer, "contextual-identity-deleted");
    Services.prefs.removeObserver("privacy.userContext.enabled", observer);
    menu.remove(); delete window.FluxionContainers;
  }, { once: true });
  window.FluxionContainers = Object.freeze({ capture, open });
})(window);
