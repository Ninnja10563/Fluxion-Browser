/* global ChromeUtils, Cu */
(function initialiseUpdateIndicator(window) {
  "use strict";
  const { document, gBrowser } = window;
  if (!gBrowser || window.FluxionUpdatesUI) return;
  const { PrivateBrowsingUtils } = ChromeUtils.importESModule("resource://gre/modules/PrivateBrowsingUtils.sys.mjs");
  if (PrivateBrowsingUtils.isWindowPrivate(window)) return;
  const target = document.getElementById("nav-bar-customization-target");
  if (!target) return;
  const { FluxionUpdateCoordinator: coordinator } = ChromeUtils.importESModule(
    "resource://fluxion/modules/FluxionUpdateCoordinator.sys.mjs",
  );
  const button = document.createXULElement("toolbarbutton");
  button.id = "fluxion-update-indicator";
  button.className = "toolbarbutton-1 chromeclass-toolbar-additional";
  button.setAttribute("removable", "false");
  button.hidden = true;
  const menu = document.getElementById("fluxion-toolbar-menu");
  target.insertBefore(button, menu?.parentNode === target ? menu : null);
  button.render();
  const SVG = "http://www.w3.org/2000/svg";
  const glyph = document.createElementNS(SVG, "svg");
  glyph.setAttribute("viewBox", "0 0 16 16");
  glyph.setAttribute("aria-hidden", "true");
  glyph.setAttribute("focusable", "false");
  const path = document.createElementNS(SVG, "path");
  path.setAttribute("d", "M8 2v8m-3-3 3 3 3-3M3 11v3h10v-3");
  glyph.appendChild(path);
  const progress = document.createElementNS("http://www.w3.org/1999/xhtml", "span");
  progress.className = "fluxion-update-indicator-progress";
  progress.setAttribute("aria-hidden", "true");
  button.append(glyph, progress);
  const style = document.createElementNS("http://www.w3.org/1999/xhtml", "style");
  style.id = "fluxion-updates-ui-style";
  style.textContent = `
    #fluxion-update-indicator[hidden] { display: none !important; }
    #fluxion-update-indicator {
      position: relative; width: 30px !important; min-width: 30px !important; height: 30px !important;
      padding: 7px !important; color: var(--fluxion-ink) !important; align-items: center; justify-content: center;
    }
    #fluxion-update-indicator > .toolbarbutton-icon { display: none !important; }
    #fluxion-update-indicator:not([disabled]):hover { background: var(--fluxion-hover) !important; }
    #fluxion-update-indicator:focus-visible { outline: 2px solid var(--fluxion-accent); outline-offset: -2px; }
    #fluxion-update-indicator > svg { width: 16px; height: 16px; flex: none; fill: none;
      stroke: currentColor; stroke-width: 1.4; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
    .fluxion-update-indicator-progress { position: absolute; inset: auto 7px 2px; height: 2px;
      background: var(--fluxion-accent); transform-origin: left center; pointer-events: none; }
    .fluxion-update-indicator-progress:dir(rtl) { transform-origin: right center; }
    .fluxion-update-indicator-progress[hidden] { display: none; }
  `;
  document.documentElement.appendChild(style);
  let disposed = false, pending = false, state = coordinator.getState();
  function openAbout() {
    const url = "about:preferences?fluxion=about";
    const existing = [...gBrowser.tabs].find(tab => !tab.closing && tab.linkedBrowser?.currentURI?.spec === url);
    const tab = existing || gBrowser.addTrustedTab(url);
    if (!existing) window.FluxionUI.setTabWorkspace(tab, window.FluxionUI.currentWorkspace());
    window.FluxionUI.selectTab(tab);
  }
  function project(next) {
    if (disposed) return;
    state = next;
    if (state.state !== "available") pending = false;
    const active = ["downloading", "extracting", "installing"].includes(state.state);
    const visible = active || ["available", "checking-install", "retry", "error"].includes(state.state) ||
      state.state === "checking" && !button.hidden;
    button.hidden = !visible;
    const hasProgress = active && typeof state.progress === "number" && Number.isFinite(state.progress);
    const fraction = hasProgress ? Math.max(0, Math.min(1, state.progress)) : 0;
    let label = state.state === "available" && state.canInstall
      ? `Update to ${state.latest} and restart Fluxion`
      : state.detail || ({ available: `Fluxion ${state.latest} is available · install manually`,
        downloading: "Downloading Fluxion update", extracting: "Preparing Fluxion update",
        installing: "Installing Fluxion update", retry: "Fluxion update needs another attempt",
        error: "Fluxion update needs attention", checking: "Checking for Fluxion updates",
        "checking-install": "Verifying the signed update offer" })[state.state] || "Fluxion updates";
    if (hasProgress) label += ` · ${Math.round(fraction * 100)}%`;
    button.setAttribute("label", label);
    button.setAttribute("aria-label", label);
    button.setAttribute("tooltiptext", label);
    button.setAttribute("data-state", state.state);
    button.disabled = pending;
    progress.hidden = !hasProgress;
    if (hasProgress) progress.style.transform = `scaleX(${fraction})`;
  }
  const activate = async () => {
    if (disposed || pending || button.hidden) return;
    if (state.state !== "available" || !state.canInstall) { openAbout(); return; }
    pending = true; project(state);
    try { await coordinator.install(); }
    catch (error) { Cu.reportError(error); if (!disposed) openAbout(); }
    finally { pending = false; if (!disposed) project(coordinator.getState()); }
  };
  button.addEventListener("command", activate);
  const stop = coordinator.watch(window, project);
  project(coordinator.getState());
  window.addEventListener("unload", () => {
    disposed = true; stop(); button.removeEventListener("command", activate); button.remove(); style.remove();
  }, { once: true });
  window.FluxionUpdatesUI = Object.freeze({ openAbout });
})(window);
