/* global gBrowser, Services, SessionStore, FluxionPeekPolicy */
(function initialiseFluxionPeek(window) {
  "use strict";

  if (!window.FluxionUI || window.FluxionPeek) return;
  const { document } = window;
  const XUL = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";
  const PEEK = FluxionPeekPolicy.ATTRIBUTE;
  const sources = new WeakMap();
  let activePeek = null;
  let retaining = false;

  try { SessionStore.persistTabAttribute(PEEK); } catch (_) {}

  // A Peek is deliberately absent after restart or crash recovery. Promoted
  // tabs have the marker removed and continue through normal SessionStore.
  for (const tab of [...gBrowser.tabs]) {
    if (tab.hasAttribute(PEEK)) {
      if (gBrowser.tabs.length === 1) gBrowser.addTrustedTab("about:newtab");
      gBrowser.removeTab(tab, { animate: false, skipSessionStore: true });
    }
  }

  function mark(tab, source) {
    if (!tab) return null;
    if (activePeek?.parentNode && activePeek !== tab) close(activePeek, { returnToSource: false });
    tab.setAttribute(PEEK, "true");
    tab.setAttribute("fluxion-workspace", window.FluxionUI.tabWorkspace(source));
    sources.set(tab, source);
    activePeek = tab;
    gBrowser.selectedTab = tab;
    return tab;
  }

  function openContextLink() {
    const menu = window.gContextMenu;
    if (!menu || !FluxionPeekPolicy.isSafeLink(menu.linkURL)) return null;
    const source = gBrowser.getTabForBrowser(menu.browser) || gBrowser.selectedTab;
    const params = menu._openLinkInParameters({
      ...menu._getGlobalHistoryOptions(),
      inBackground: false,
      resolveOnNewTabCreated(browser) {
        mark(gBrowser.getTabForBrowser(browser), source);
      },
    });
    window.openLinkIn(menu.linkURL, "tab", params);
    return true;
  }

  function promote(tab = activePeek) {
    if (!tab?.hasAttribute(PEEK)) return false;
    tab.removeAttribute(PEEK);
    sources.delete(tab);
    if (activePeek === tab) activePeek = null;
    gBrowser.tabContainer.dispatchEvent(new CustomEvent("FluxionPeekChange", { bubbles: true }));
    return true;
  }

  function close(tab = activePeek, { returnToSource = true } = {}) {
    if (!tab?.parentNode || !tab.hasAttribute(PEEK)) return false;
    const source = sources.get(tab);
    sources.delete(tab);
    if (activePeek === tab) activePeek = null;
    if (returnToSource && source?.parentNode) gBrowser.selectedTab = source;
    gBrowser.removeTab(tab, { animate: false, skipSessionStore: true });
    return true;
  }

  function openBeside(tab = activePeek) {
    const source = tab && sources.get(tab);
    if (!FluxionPeekPolicy.canPair(source, tab)) return false;
    retaining = true;
    promote(tab);
    window.FluxionUI.createSplitView(source, tab, { selectSecondary: true });
    retaining = false;
    return true;
  }

  const popup = document.getElementById("contentAreaContextMenu");
  const nativeOpenTab = document.getElementById("context-openlinkintab");
  let peekItem = null;
  if (popup && nativeOpenTab) {
    peekItem = document.createElementNS(XUL, "menuitem");
    peekItem.id = "context-fluxion-peek-link";
    peekItem.setAttribute("label", "Peek Link");
    nativeOpenTab.parentNode.insertBefore(peekItem, nativeOpenTab.nextSibling);
    peekItem.addEventListener("command", openContextLink);
    popup.addEventListener("popupshowing", () => {
      peekItem.hidden = !window.gContextMenu?.onLink ||
        !FluxionPeekPolicy.isSafeLink(window.gContextMenu?.linkURL);
    });
  }

  gBrowser.tabContainer.addEventListener("TabSelect", event => {
    const selected = event.target;
    const previous = activePeek;
    if (selected?.hasAttribute(PEEK)) activePeek = selected;
    else if (previous?.parentNode && !retaining) close(previous, { returnToSource: false });
  });
  window.addEventListener("unload", () => peekItem?.remove(), { once: true });
  window.FluxionPeek = Object.freeze({ close, isPeek: tab => tab?.hasAttribute(PEEK), openBeside, openContextLink, promote });
  Services.prefs.setStringPref("fluxion.peek.health", "secure-context-link-peek-loaded");
  Services.prefs.savePrefFile(null);

  if (Services.env.get("FLUXION_VISUAL_PEEK_TEST") === "1") {
    window.setTimeout(() => {
      const source = gBrowser.selectedTab;
      const tab = gBrowser.addTrustedTab("https://example.net/", { relatedToCurrent: true });
      mark(tab, source);
      Services.prefs.setStringPref("fluxion.peek.visual.health", "temporary-gecko-tab-opened");
      Services.prefs.savePrefFile(null);
    }, 1600);
  }
})(window);
