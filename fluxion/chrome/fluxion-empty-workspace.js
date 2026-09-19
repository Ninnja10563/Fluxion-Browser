/* global Services, SessionStore */
(function initialiseEmptyWorkspaces(window) {
  "use strict";
  const { document, gBrowser } = window;
  if (!gBrowser || window.FluxionEmptyWorkspace) return;
  const ATTRIBUTE = "fluxion-empty-workspace";
  const NEW_TAB_URL = Services.prefs.getStringPref("fluxion.newtab.url", "about:newtab");
  const initialURLs = new Set(["about:blank", "about:newtab", "about:privatebrowsing", NEW_TAB_URL]);
  const root = document.documentElement, cleanup = [], replacements = [];
  let disposed = false, queued = false;
  const isPlaceholder = tab => tab?.getAttribute(ATTRIBUTE) === "true";
  const live = tab => !!tab?.parentNode && !tab.closing;
  const style = document.createElementNS("http://www.w3.org/1999/xhtml", "style");
  style.textContent = `
    /* Only an explicitly owned backing tab is visually empty. Gecko retains
       its browser and focus routing; ordinary blank pages are untouched. */
    :root[data-fluxion-empty-workspace] #tabbrowser-tabpanels { visibility: hidden !important; }
    :root[data-fluxion-empty-workspace] #star-button-box { visibility: hidden !important; }
  `;
  root.appendChild(style);
  try { SessionStore.persistTabAttribute(ATTRIBUTE); } catch (_) {}
  function on(target, type, handler, capture = false) {
    target.addEventListener(type, handler, capture);
    cleanup.push(() => target.removeEventListener(type, handler, capture));
  }
  function replace(target, name, build) {
    if (typeof target?.[name] !== "function") return;
    const descriptor = Object.getOwnPropertyDescriptor(target, name), original = target[name];
    const wrapper = build(original);
    target[name] = wrapper;
    replacements.push(() => {
      if (target[name] !== wrapper) return;
      if (descriptor) Object.defineProperty(target, name, descriptor);
      else delete target[name];
    });
  }
  const ownedDisabled = new Map();
  function disableOwnedCommand(id, disabled) {
    const command = document.getElementById(id);
    if (!command) return;
    if (disabled) {
      if (!ownedDisabled.has(command)) ownedDisabled.set(command, command.getAttribute("disabled"));
      if (command.getAttribute("disabled") !== "true") command.setAttribute("disabled", "true");
    } else if (ownedDisabled.has(command)) {
      const previous = ownedDisabled.get(command);
      ownedDisabled.delete(command);
      if (command.getAttribute("disabled") === "true") {
        if (previous === null) command.removeAttribute("disabled");
        else command.setAttribute("disabled", previous);
      }
    }
  }
  function refresh() {
    if (disposed) return;
    const empty = isPlaceholder(gBrowser.selectedTab);
    if (root.hasAttribute("data-fluxion-empty-workspace") !== empty)
      root.toggleAttribute("data-fluxion-empty-workspace", empty);
    disableOwnedCommand("Browser:AddBookmarkAs", empty);
    disableOwnedCommand("Browser:BookmarkAllTabs", empty && ![...gBrowser.tabs].some(tab => live(tab) && !tab.hidden && !isPlaceholder(tab)));
  }
  function promote(tab) {
    if (!isPlaceholder(tab)) return false;
    tab.removeAttribute(ATTRIBUTE);
    refresh();
    window.FluxionUI?.refresh();
    return true;
  }
  function adopt(tab) {
    if (disposed || !live(tab) || !isPlaceholder(tab)) return null;
    const ui = window.FluxionUI;
    if (ui && !tab.hasAttribute("fluxion-workspace")) ui.setTabWorkspace(tab, ui.currentWorkspace());
    refresh();
    ui?.refresh();
    return tab;
  }
  function create(workspace) {
    if (disposed) return null;
    const tab = gBrowser.addTrustedTab(NEW_TAB_URL, { skipAnimation: true });
    tab.setAttribute(ATTRIBUTE, "true");
    if (window.FluxionUI && workspace) window.FluxionUI.setTabWorkspace(tab, workspace);
    return adopt(tab);
  }
  function settle() {
    queued = false;
    if (disposed || window.closed) return;
    const ui = window.FluxionUI, selected = gBrowser.selectedTab;
    // A real selected page replaces its workspace's backing tab. Do not remove
    // the selected placeholder for a background-open command, or touch another
    // workspace. Native removal owns focus and session notifications.
    if (ui && live(selected) && !isPlaceholder(selected)) {
      const workspace = ui.tabWorkspace(selected);
      for (const tab of [...gBrowser.tabs]) {
        if (live(tab) && isPlaceholder(tab) && tab !== selected && ui.tabWorkspace(tab) === workspace)
          gBrowser.removeTab(tab, { animate: false, skipSessionStore: true });
      }
    }
    refresh();
  }
  function schedule() {
    refresh();
    if (queued || disposed) return;
    queued = true;
    window.queueMicrotask(settle);
  }
  const progress = {
    onLocationChange(browser, webProgress) {
      if (disposed || !webProgress?.isTopLevel) return;
      const tab = gBrowser.getTabForBrowser(browser);
      if (isPlaceholder(tab) && !initialURLs.has(browser.currentURI.spec)) promote(tab);
    },
  };
  gBrowser.addTabsProgressListener(progress);
  for (const name of ["TabSelect", "TabOpen", "TabClose", "SSTabRestored"]) on(gBrowser.tabContainer, name, schedule);
  on(window, "FluxionWorkspacesChanged", schedule);
  // The backing browser is not a user tab. Closing it again would create a
  // replacement loop. Keep explicit Close Window (including Shift+accel+W).
  function stopEmptyClose(event) {
    if (!isPlaceholder(gBrowser.selectedTab)) return;
    if (event.type === "keydown") {
      const accelerator = Services.appinfo.OS === "Darwin" ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
      if (!accelerator || event.altKey || event.shiftKey || event.key?.toLowerCase() !== "w") return;
    } else if (event.target?.id !== "cmd_close") return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }
  on(window, "keydown", stopEmptyClose, true);
  on(window, "command", stopEmptyClose, true);
  // Preserve native bookmark destinations and dialogs, but do not manufacture
  // bookmarks for the implementation-only browser behind an empty workspace.
  const places = window.PlacesCommandHook;
  replace(places, "bookmarkPage", original => function (...args) {
    if (isPlaceholder(gBrowser.selectedTab)) return Promise.resolve();
    return original.apply(this, args);
  });
  replace(places, "bookmarkTabs", original => function (tabs, ...args) {
    const real = [...(tabs ?? gBrowser.visibleTabs.filter(tab => !tab.pinned))].filter(tab => !isPlaceholder(tab));
    if (!real.length) return Promise.resolve();
    return original.call(this, real, ...args);
  });
  on(window, "unload", () => {
    disposed = true;
    cleanup.splice(0).forEach(remove => remove());
    gBrowser.removeTabsProgressListener(progress);
    replacements.reverse().forEach(restore => restore());
    for (const command of [...ownedDisabled.keys()]) disableOwnedCommand(command.id, false);
    style.remove(); root.removeAttribute("data-fluxion-empty-workspace");
    delete window.FluxionEmptyWorkspace;
  });
  window.FluxionEmptyWorkspace = Object.freeze({ isPlaceholder, adopt, create, promote, refresh });
  for (const tab of gBrowser.tabs) {
    if (isPlaceholder(tab) && !initialURLs.has(tab.linkedBrowser.currentURI.spec)) promote(tab);
    else if (isPlaceholder(tab)) adopt(tab);
  }
  refresh();
})(window);
