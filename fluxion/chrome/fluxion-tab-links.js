/* global Cc, Ci, Cu, FluxionTabLinksCore */
(function initialiseTabLinks(window) {
  "use strict";
  const { document, gBrowser, FluxionUI: ui } = window;
  const popup = document.getElementById("fluxion-tab-context");
  if (!popup || !ui || window.FluxionTabLinks) return;
  const item = document.createXULElement("menuitem");
  item.id = "fluxion-copy-tab-links";
  item.setAttribute("label", "Copy Tab Link");
  item.setAttribute("tooltiptext", "Copy HTTP or HTTPS links; embedded URL usernames/passwords are omitted");
  // Preserve Duplicate as the first native keyboard action, and keep this
  // simple leaf before optional container/window submenus.
  popup.insertBefore(item, popup.children[1] || null);
  let snapshot = null, disposed = false;
  const live = tab => Boolean(tab?.parentNode && !tab.closing && !window.closed &&
    gBrowser.getTabForBrowser(tab.linkedBrowser) === tab &&
    (tab.ownerGlobal || tab.documentGlobal || tab.ownerDocument?.defaultView) === window);
  function capture() {
    const tabs = [...new Set(ui.contextTabs())];
    if (!tabs.length || tabs.some(tab => !live(tab))) return null;
    const order = new Map([...gBrowser.tabs].map((tab, index) => [tab, index]));
    tabs.sort((a, b) => order.get(a) - order.get(b));
    const entries = tabs.map(tab => {
      const url = tab.linkedBrowser.currentURI.spec;
      return Object.freeze({ tab, browser: tab.linkedBrowser, parent: tab.parentNode, group: tab.group,
        index: order.get(tab), url, link: FluxionTabLinksCore.shareableURL(url), workspace: ui.tabWorkspace(tab),
        container: tab.getAttribute("usercontextid") || "0" });
    });
    return Object.freeze({ workspace: ui.currentWorkspace(), entries: Object.freeze(entries) });
  }
  function valid(value) {
    if (!value || disposed || window.closed || ui.currentWorkspace() !== value.workspace) return false;
    const order = new Map([...gBrowser.tabs].map((tab, index) => [tab, index]));
    const spaces = new Set(ui.workspaces().map(space => space.id));
    return value.entries.every(entry => entry.link && live(entry.tab) && entry.parent === entry.tab.parentNode &&
      entry.group === entry.tab.group && order.get(entry.tab) === entry.index &&
      entry.browser === entry.tab.linkedBrowser && entry.url === entry.browser.currentURI.spec &&
      spaces.has(entry.workspace) && ui.tabWorkspace(entry.tab) === entry.workspace &&
      (entry.tab.getAttribute("usercontextid") || "0") === entry.container);
  }
  const invalidate = () => { snapshot = null; item.setAttribute("disabled", "true"); };
  const show = event => {
    if (event.target !== popup) return;
    try { snapshot = capture(); } catch (_) { snapshot = null; }
    const count = snapshot?.entries.length || 1;
    item.setAttribute("label", count === 1 ? "Copy Tab Link" : `Copy ${count} Tab Links`);
    item.toggleAttribute("disabled", !valid(snapshot));
  };
  const hidden = event => { if (event.target === popup) invalidate(); };
  const command = () => {
    const value = snapshot;
    invalidate(); // A native command is single-use, even if the helper throws.
    if (!valid(value)) return;
    try {
      Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper)
        .copyString(value.entries.map(entry => entry.link).join("\n"));
    } catch (error) { Cu.reportError(error); }
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
    item.remove(); delete window.FluxionTabLinks;
  }, { once: true });
  window.FluxionTabLinks = Object.freeze({ available: true });
})(window);
