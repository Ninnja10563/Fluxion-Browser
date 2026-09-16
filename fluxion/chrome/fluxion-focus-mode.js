/* global Services */
(function initialiseFocusNavigation(window) {
  "use strict";
  const { document } = window, root = document.documentElement;
  const toolbox = document.getElementById("navigator-toolbox");
  const flow = document.getElementById("fluxion-flow");
  if (!toolbox || !flow || window.FluxionFocusMode) return;
  const cleanups = [], popups = new Set();
  let enabled = false, revealed = false, pointerInside = false, timer = 0, disposed = false;
  let sidebarState = null, nativeFocus = false;
  const edge = document.createElementNS("http://www.w3.org/1999/xhtml", "div");
  edge.id = "fluxion-navigation-edge";
  edge.setAttribute("aria-hidden", "true");
  const style = document.createElementNS("http://www.w3.org/1999/xhtml", "style");
  style.id = "fluxion-focus-navigation-style";
  style.textContent = `
    #fluxion-navigation-edge { display: none; }
    :root[data-fluxion-native-focus] #navigator-toolbox { z-index: 19 !important; }
    :root[data-fluxion-focus-mode] #fluxion-navigation-edge {
      display: block; position: fixed; inset: 0 0 auto; height: 4px;
      z-index: 20; background: transparent;
    }
    :root[data-fluxion-focus-mode] #navigator-toolbox {
      position: fixed !important; inset: 0 0 auto !important; width: auto !important;
      z-index: 19; opacity: 0; pointer-events: none;
      transform: translateY(calc(-100% - 2px));
      transition: transform var(--fluxion-fast), opacity 100ms ease;
    }
    :root[data-fluxion-focus-mode][data-fluxion-navigation-revealed="true"] #navigator-toolbox {
      opacity: 1; pointer-events: auto; transform: translateY(0);
      box-shadow: none !important;
    }
    /* Gecko's address/search breakout is a native top-layer popover. It does
       not inherit the toolbox's composited opacity or transformed clipping.
       Hide its paint directly, preserving focus and Gecko's popover lifecycle. */
    :root[data-fluxion-focus-mode]:not([data-fluxion-navigation-revealed="true"]) :is(#urlbar, #searchbar-new) {
      opacity: 0 !important; pointer-events: none !important;
    }
    :root[data-fluxion-focus-mode]:not([data-fluxion-navigation-revealed="true"]) :is(#urlbar, #searchbar-new) * {
      pointer-events: none !important;
    }
    :root[data-fluxion-navigation-pinned] #navigator-toolbox,
    :root[data-fluxion-no-motion] #navigator-toolbox { transition: none !important; }
    @media (prefers-reduced-motion: reduce) {
      :root[data-fluxion-focus-mode] #navigator-toolbox { transition: none !important; }
    }
  `;
  root.append(style, edge);
  function on(target, type, listener, options) {
    target.addEventListener(type, listener, options);
    cleanups.push(() => target.removeEventListener(type, listener, options));
  }
  function cancel() { if (timer) window.clearTimeout(timer); timer = 0; }
  function keepOpen() {
    return pointerInside || toolbox.contains(document.activeElement) || popups.size > 0 ||
      Boolean(window.gURLBar?.view?.isOpen) || root.hasAttribute("customizing");
  }
  function paint(value) {
    revealed = enabled && value;
    if (root.getAttribute("data-fluxion-navigation-revealed") !== String(revealed))
      root.setAttribute("data-fluxion-navigation-revealed", String(revealed));
  }
  function reveal({ immediate = false } = {}) {
    if (disposed || !enabled) return false;
    cancel();
    if (immediate) root.setAttribute("data-fluxion-navigation-pinned", "true");
    paint(true);
    // Native popup anchoring reads layout immediately after popupshowing.
    // Resolve its final, unanimated anchor before Gecko positions the panel.
    if (immediate) toolbox.getBoundingClientRect();
    return true;
  }
  function scheduleHide() {
    cancel();
    if ((!enabled && !nativeFocus) || disposed) return;
    timer = window.setTimeout(() => {
      timer = 0;
      if (!keepOpen()) {
        root.removeAttribute("data-fluxion-navigation-pinned");
        if (nativeFocus) window.FullScreen.hideNavToolbox(true);
        else paint(false);
      }
    }, 180);
  }
  function keepNativeNavigationVisible() {
    if (disposed || !window.fullScreen || document.fullscreenElement ||
        root.hasAttribute("inDOMFullscreen") || flow.dataset.state === "focus") return;
    if (window.FullScreen?.navToolboxHidden) window.FullScreen.showNavToolbox(false);
  }
  const fullscreenObserver = {
    observe(subject, topic, state) {
      // Gecko finishes its collapsed state before this synchronous notification.
      // Restore through the native controller before paint, without changing a
      // profile-wide preference or overriding its keyboard/popup bookkeeping.
      if (subject === toolbox && state === "hidden") keepNativeNavigationVisible();
      // Native tracking only covers tabpanels. Settings and the floating Flow
      // surface are chrome siblings, so also own pointer departure explicitly.
      if (subject === toolbox && state === "shown" && nativeFocus) scheduleHide();
    },
  };
  Services.obs.addObserver(fullscreenObserver, "fullscreen-nav-toolbox");
  function refresh() {
    if (disposed) return;
    const enteringFocus = flow.dataset.state === "focus" && sidebarState !== "focus";
    sidebarState = flow.dataset.state;
    nativeFocus = Boolean(window.fullScreen && sidebarState === "focus" &&
      !document.fullscreenElement && !root.hasAttribute("inDOMFullscreen") && !root.hasAttribute("customizing"));
    root.toggleAttribute("data-fluxion-native-focus", nativeFocus);
    // New Tab automatically focuses the location field. An explicit collapse
    // must not inherit that focus as a request to pin the navigation open.
    // Keep its typed value; a later native Cmd-L still follows normal focusin.
    if (enteringFocus && !root.hasAttribute("inDOMFullscreen") &&
        document.activeElement === window.gURLBar?.inputField && popups.size === 0) {
      window.gURLBar.view?.close();
      window.gBrowser.selectedBrowser.focus();
    }
    if (enteringFocus && nativeFocus && popups.size === 0) {
      // Browser fullscreen owns its native negative-margin/menu-bar reveal.
      // Releasing implicit address focus lets that controller hide normally.
      window.FullScreen.hideNavToolbox(false);
    }
    const next = flow.dataset.state === "focus" && !root.hasAttribute("inFullscreen") &&
      !root.hasAttribute("inDOMFullscreen") && !root.hasAttribute("customizing");
    if (next !== enabled) {
      cancel(); enabled = next; pointerInside = false;
      root.toggleAttribute("data-fluxion-focus-mode", enabled);
      if (!enabled) root.removeAttribute("data-fluxion-navigation-pinned");
      paint(enabled && keepOpen());
      window.FluxionChromeLayout?.refresh();
    }
    keepNativeNavigationVisible();
    if (nativeFocus) scheduleHide();
  }
  const trustedChrome = event => event.isTrusted === true &&
    event.target?.ownerDocument === document && event.target?.nodePrincipal?.isSystemPrincipal === true;
  on(edge, "pointerenter", event => { if (trustedChrome(event)) { pointerInside = true; reveal(); } });
  on(edge, "pointerleave", event => { if (trustedChrome(event)) { pointerInside = false; scheduleHide(); } });
  on(toolbox, "pointerenter", event => { if (trustedChrome(event)) { pointerInside = true; reveal(); } });
  on(toolbox, "pointerleave", event => { if (trustedChrome(event)) { pointerInside = false; scheduleHide(); } });
  // Deliberately keep the offscreen toolbox focusable: Gecko's Cmd-L, menu
  // commands and accessibility navigation retain their native focus routing.
  on(toolbox, "focusin", () => reveal({ immediate: true }));
  on(toolbox, "focusout", scheduleHide);
  on(document, "popupshowing", event => {
    if (event.defaultPrevented || !trustedChrome(event) || !["panel", "menupopup"].includes(event.target.localName)) return;
    if (event.target.id.startsWith("fluxion-workspace") ||
        ["fluxion-tab-context", "fluxion-group-context"].includes(event.target.id) || flow.contains(event.target)) return;
    popups.add(event.target);
    reveal({ immediate: true });
    // A later native handler may cancel opening; Gecko then need not send
    // popuphidden. Release this provisional owner after event dispatch.
    Promise.resolve().then(() => {
      if (!disposed && event.defaultPrevented && popups.delete(event.target)) scheduleHide();
    });
  }, true);
  on(document, "popuphidden", event => {
    if (popups.delete(event.target)) scheduleHide();
  }, true);
  on(window, "blur", event => {
    if (event.target !== window) return;
    pointerInside = false; scheduleHide();
  });
  const observer = new window.MutationObserver(refresh);
  observer.observe(flow, { attributes: true, attributeFilter: ["data-state"] });
  observer.observe(root, { attributes: true, attributeFilter: ["inFullscreen", "inDOMFullscreen", "customizing"] });
  const urlbar = document.getElementById("urlbar");
  const addressObserver = new window.MutationObserver(() => {
    if (urlbar.hasAttribute("open") || urlbar.hasAttribute("focused")) reveal({ immediate: true });
    else scheduleHide();
  });
  if (urlbar) addressObserver.observe(urlbar, { attributes: true, attributeFilter: ["open", "focused"] });
  on(window, "unload", () => {
    disposed = true; cancel(); observer.disconnect(); addressObserver.disconnect(); cleanups.splice(0).forEach(fn => fn());
    Services.obs.removeObserver(fullscreenObserver, "fullscreen-nav-toolbox");
    popups.clear(); edge.remove(); style.remove();
    for (const name of ["data-fluxion-focus-mode", "data-fluxion-native-focus", "data-fluxion-navigation-revealed", "data-fluxion-navigation-pinned"])
      root.removeAttribute(name);
  }, { once: true });
  window.FluxionFocusMode = Object.freeze({ refresh, reveal, state: () => ({ enabled, revealed }) });
  refresh();
})(window);
