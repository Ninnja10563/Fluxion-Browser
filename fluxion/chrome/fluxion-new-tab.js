(function initialiseDeferredNewTab(window) {
  "use strict";
  const { document, gBrowser, gURLBar: urlbar, FluxionUI: ui, BrowserCommands } = window;
  const controller = urlbar?.controller;
  const required = ["whereToOpen", "loadURL", "openSERP", "openSearchForm", "resolveFallbackNavigation", "willLoadInBackground", "cancelQuery"];
  const inputMethods = ["getSearchMode", "getBrowserState", "_updateSearchModeUI", "setURI", "search", "select"];
  if (!ui || !controller || typeof BrowserCommands?.openTab !== "function" || window.FluxionNewTab ||
      required.some(name => typeof controller[name] !== "function") ||
      inputMethods.some(name => typeof urlbar[name] !== "function")) return;
  let draft = null, disposed = false, generation = 0;
  const cleanup = [], replacements = [];
  function on(target, type, handler, capture = false) {
    target.addEventListener(type, handler, capture);
    cleanup.push(() => target.removeEventListener(type, handler, capture));
  }
  function replace(target, name, build) {
    const own = Object.getOwnPropertyDescriptor(target, name), original = target[name];
    const wrapper = build(original);
    target[name] = wrapper;
    replacements.push(() => {
      if (target[name] !== wrapper) return;
      if (own) Object.defineProperty(target, name, own);
      else delete target[name];
    });
  }
  function live(tab) {
    return !!tab?.parentNode && !tab.closing && gBrowser.getTabForBrowser(tab.linkedBrowser) === tab;
  }
  function valid(snapshot) {
    return !disposed && !window.closed && snapshot === draft && live(snapshot?.tab) &&
      snapshot.tab === gBrowser.selectedTab && snapshot.browser === snapshot.tab.linkedBrowser &&
      snapshot.workspace === ui.currentWorkspace() && snapshot.workspace === ui.tabWorkspace(snapshot.tab) &&
      snapshot.context === Number(snapshot.tab.getAttribute("usercontextid") || 0) &&
      snapshot.url === snapshot.browser.currentURI.spec && snapshot.location === snapshot.browser.lastLocationChange;
  }
  function restoreSource(snapshot, restoreInput) {
    if (!live(snapshot.tab) || snapshot.browser !== snapshot.tab.linkedBrowser) return;
    const unchanged = snapshot.url === snapshot.browser.currentURI.spec && snapshot.location === snapshot.browser.lastLocationChange;
    function restoreModes() {
      const state = urlbar.getBrowserState(snapshot.browser);
      if (snapshot.searchModes) state.searchModes = cloneModes(snapshot.searchModes);
      else delete state.searchModes;
    }
    if (unchanged) {
      snapshot.browser.userTypedValue = snapshot.userTypedValue;
      restoreModes();
    }
    if (restoreInput && gBrowser.selectedTab === snapshot.tab) {
      // setSearchMode can await engine startup and later overwrite a new
      // draft's text. Restore the public browser-local mode record directly;
      // setURI still owns URI exposure and page-proxy/security presentation.
      // This is a restoration in the same tab, not a tab-switch search request.
      urlbar.setURI({ hideSearchTerms: true });
      if (unchanged) {
        restoreModes();
        urlbar._updateSearchModeUI(urlbar.getSearchMode(snapshot.browser));
      }
    }
  }
  function cloneModes(modes) {
    if (!modes) return undefined;
    return Object.fromEntries(Object.entries(modes).map(([name, mode]) => [name, { ...mode }]));
  }
  function cancel({ focusPage = false } = {}) {
    const snapshot = draft;
    if (!snapshot) return false;
    draft = null; generation++;
    urlbar.removeAttribute("data-fluxion-new-tab");
    controller.cancelQuery();
    urlbar.view.close();
    restoreSource(snapshot, true);
    if (focusPage && gBrowser.selectedTab === snapshot.tab) snapshot.browser.focus();
    return true;
  }
  function begin() {
    if (disposed || window.closed || !live(gBrowser.selectedTab)) return null;
    if (draft && valid(draft)) {
      urlbar.select();
      return null;
    }
    cancel();
    generation++;
    const tab = gBrowser.selectedTab, browser = tab.linkedBrowser;
    draft = { tab, browser, workspace: ui.currentWorkspace(),
      context: Number(tab.getAttribute("usercontextid") || 0), url: browser.currentURI.spec,
      location: browser.lastLocationChange, userTypedValue: browser.userTypedValue,
      searchModes: cloneModes(urlbar.getBrowserState(browser).searchModes), revision: 0 };
    urlbar.setAttribute("data-fluxion-new-tab", "true");
    urlbar.searchMode = null;
    urlbar.search("", { focus: true });
    return null;
  }
  // Only the address controller's final navigation boundary creates the tab.
  // Gecko still resolves URLs, search engines, POST bodies and principals.
  function targetFor(snapshot, where, inBackground, context = snapshot.context) {
    if (!valid(snapshot)) { cancel(); return null; }
    draft = null; generation++;
    urlbar.removeAttribute("data-fluxion-new-tab");
    restoreSource(snapshot, false);
    if (!["current", "tab", "tabshifted"].includes(where)) return { where, browserId: snapshot.browser.browserId };
    const tab = gBrowser.addTrustedTab("about:blank", { userContextId: context });
    ui.setTabWorkspace(tab, snapshot.workspace);
    if (!inBackground) gBrowser.selectedTab = tab;
    else urlbar.setURI({ dueToTabSwitch: true, hideSearchTerms: true });
    return { where: "current", browserId: tab.linkedBrowser.browserId };
  }
  replace(controller, "whereToOpen", original => function (...args) {
    const where = original.apply(this, args);
    return draft && valid(draft) && where === "current" ? "tab" : where;
  });
  replace(controller, "loadURL", original => function (details) {
    const snapshot = draft;
    if (!snapshot) return original.call(this, details);
    if (details.browserId != null && details.browserId !== snapshot.browser.browserId) {
      cancel(); return { reverted: false, browserId: snapshot.browser.browserId };
    }
    const background = controller.willLoadInBackground(details.where, details.params);
    const target = targetFor(snapshot, details.where, background, details.params.userContextId ?? snapshot.context);
    if (!target) return { reverted: false, browserId: snapshot.browser.browserId };
    return original.call(this, { ...details, ...target,
      params: { ...details.params, ...(background ? { avoidBrowserFocus: true } : {}) } });
  });
  for (const name of ["openSERP", "openSearchForm"]) {
    replace(controller, name, original => function (...args) {
      const snapshot = draft;
      if (!snapshot) return original.apply(this, args);
      const whereIndex = name === "openSERP" ? 2 : 1;
      if (args[whereIndex + 2] != null && args[whereIndex + 2] !== snapshot.browser.browserId) {
        cancel(); return undefined;
      }
      const target = targetFor(snapshot, args[whereIndex], !!args[whereIndex + 1]);
      if (!target) return undefined;
      args[whereIndex] = target.where;
      args[whereIndex + 2] = target.browserId;
      return original.apply(this, args);
    });
  }
  replace(controller, "resolveFallbackNavigation", original => async function (...args) {
    const snapshot = draft;
    const revision = snapshot?.revision;
    const epoch = generation;
    const result = await original.apply(this, args);
    // A late heuristic must not open a tab after Escape, a workspace switch,
    // or a replacement draft. No stale input reaches Gecko's load callback.
    return generation !== epoch || (snapshot && (!valid(snapshot) || snapshot.revision !== revision)) ? {} : result;
  });
  if (typeof controller.switchToTab === "function") {
    replace(controller, "switchToTab", original => function (...args) {
      cancel();
      return original.apply(this, args);
    });
  }
  replace(BrowserCommands, "openTab", original => function (options = {}) {
    const { event, url } = options;
    // Explicit URLs and modified mouse/clipboard actions retain native policy.
    if (url !== undefined || event?.button > 0 ||
        (event?.type?.includes("click") && (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey))) {
      cancel();
      return original.call(this, options);
    }
    return begin();
  });
  on(window, "keydown", event => {
    if (!draft || !event.isTrusted || event.isComposing) return;
    if (event.key?.toLowerCase() === "l" && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey) {
      cancel(); return;
    }
    if (event.key !== "Escape") return;
    event.preventDefault(); event.stopImmediatePropagation();
    cancel({ focusPage: true });
  }, true);
  on(urlbar, "focusout", () => {
    const snapshot = draft;
    // Picking a native suggestion can move focus before its click handler.
    // Let that same synchronous command commit before treating blur as cancel.
    window.queueMicrotask(() => {
      if (snapshot && snapshot === draft && !urlbar.contains(document.activeElement)) cancel();
    });
  });
  on(urlbar, "input", () => { if (draft) draft.revision++; });
  on(gBrowser.tabContainer, "TabSelect", () => { if (draft && !valid(draft)) cancel(); });
  on(gBrowser.tabContainer, "TabClose", event => { if (event.target === draft?.tab) cancel(); });
  on(window, "FluxionWorkspacesChanged", () => { if (draft && !valid(draft)) cancel(); });
  on(window, "blur", () => { if (draft) cancel(); });
  on(window, "unload", () => {
    cancel(); disposed = true;
    cleanup.splice(0).forEach(remove => remove());
    replacements.reverse().forEach(restore => restore());
    delete window.FluxionNewTab;
  });
  window.FluxionNewTab = Object.freeze({ begin, cancel, get pending() { return !!draft; } });
})(window);
