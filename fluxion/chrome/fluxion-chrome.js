/* global gBrowser, Services, SessionStore, FluxionSplitViews, FluxionTabGroups, FluxionWorkspaces */
(function initialiseFluxion(window) {
  "use strict";

  if (!window.gBrowser || window.document.getElementById("fluxion-flow")) return;

  const { document } = window;
  const XUL = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";
  const HTML = "http://www.w3.org/1999/xhtml";
  const PREF_WORKSPACES = "fluxion.workspaces";
  const PREF_CURRENT = "fluxion.workspace.current";
  const PREF_SIDEBAR = "fluxion.sidebar.state";
  const TAB_WORKSPACE = "fluxion-workspace";
  const NEW_TAB_URL = Services.prefs.getStringPref("fluxion.newtab.url", "about:newtab");
  const ABOUT_URL = Services.prefs.getStringPref("fluxion.about.url", "about:support");
  const SIDEBAR_STATES = ["expanded", "compact", "focus"];
  const cleanup = [];
  let contextTab = null;
  let contextGroup = null;
  let contextWorkspace = null;
  let dragTab = null;
  let renderQueued = false;

  document.documentElement.setAttribute("data-fluxion", "true");

  const create = (tag, className) => {
    const element = document.createElementNS(HTML, tag);
    if (className) element.className = className;
    return element;
  };

  const xul = (tag, attributes = {}) => {
    const element = document.createElementNS(XUL, tag);
    for (const [name, value] of Object.entries(attributes)) {
      element.setAttribute(name, value);
    }
    return element;
  };

  const on = (target, type, listener, options) => {
    target.addEventListener(type, listener, options);
    cleanup.push(() => target.removeEventListener(type, listener, options));
  };

  const style = create("style");
  style.id = "fluxion-style";
  style.textContent = `
    :root {
      --fluxion-bg: light-dark(#f3f3f1, #20211f);
      --fluxion-bg-raised: light-dark(#fafaf8, #292a27);
      --fluxion-ink: light-dark(#20211f, #efefeb);
      --fluxion-muted: light-dark(#696a65, #a8a9a3);
      --fluxion-line: light-dark(rgba(25,26,23,.11), rgba(255,255,250,.10));
      --fluxion-selected: light-dark(#dfdfdb, #373834);
      --fluxion-hover: light-dark(rgba(25,26,23,.055), rgba(255,255,250,.06));
      --fluxion-accent: light-dark(#3f596e, #8ba9bd);
      --fluxion-fast: 140ms cubic-bezier(.2,.7,.2,1);
    }
    #toolbar-menubar, #TabsToolbar, #PersonalToolbar { visibility: collapse !important; }
    #navigator-toolbox {
      appearance: none !important; background: var(--fluxion-bg) !important;
      border: 0 !important; border-bottom: 1px solid var(--fluxion-line) !important;
    }
    #nav-bar {
      min-height: 46px !important; padding: 5px 8px !important;
      background: var(--fluxion-bg) !important; box-shadow: none !important;
      border: 0 !important;
    }
    #nav-bar-customization-target { align-items: center; gap: 2px; }
    #nav-bar #firefox-view-button,
    #nav-bar #fxa-toolbar-menu-button,
    #nav-bar #save-to-pocket-button,
    #nav-bar #pocket-button,
    #nav-bar #sidebar-button,
    #nav-bar #smartwindow-ask-button,
    #nav-bar #ip-protection-button { display: none !important; }
    #nav-bar .toolbarbutton-1 {
      margin: 0 !important; padding: 0 !important; border-radius: 5px !important;
    }
    #nav-bar .toolbarbutton-1 > .toolbarbutton-icon,
    #nav-bar .toolbarbutton-1 > .toolbarbutton-badge-stack {
      width: 30px !important; height: 30px !important; padding: 7px !important;
      border-radius: 5px !important; background: transparent !important;
    }
    #nav-bar .toolbarbutton-1:not([disabled]):hover > .toolbarbutton-icon,
    #nav-bar .toolbarbutton-1:not([disabled]):hover > .toolbarbutton-badge-stack {
      background: var(--fluxion-hover) !important;
    }
    #urlbar-container { margin-inline: 7px !important; padding: 0 !important; }
    #urlbar { --urlbar-height: 34px; font-size: 13px !important; }
    #urlbar-background {
      background: var(--fluxion-bg-raised) !important;
      border: 1px solid var(--fluxion-line) !important;
      border-radius: 6px !important; box-shadow: none !important;
    }
    #urlbar[focused] > #urlbar-background,
    #urlbar[open] > #urlbar-background {
      border-color: color-mix(in srgb, var(--fluxion-accent) 66%, transparent) !important;
      outline: 2px solid color-mix(in srgb, var(--fluxion-accent) 17%, transparent) !important;
      outline-offset: -1px !important;
    }
    #urlbar-input { font-size: 13px !important; letter-spacing: -.005em; }
    #urlbar .urlbarView {
      border: 1px solid var(--fluxion-line) !important; border-radius: 7px !important;
      background: var(--fluxion-bg-raised) !important;
      box-shadow: 0 10px 28px rgba(0,0,0,.18) !important;
    }
    #PanelUI-button { padding-inline-start: 2px !important; }
    @media (-moz-platform: macos) {
      #nav-bar > .titlebar-buttonbox-container { display: flex !important; }
    }
    #appMenu-fxa-status2,
    #appMenu-fxa-separator,
    #appMenu-new-ai-window-button,
    #appMenu-chats-history-button,
    #appMenu-update-banner { display: none !important; }
    #browser { background: var(--fluxion-bg); }
    #tabbrowser-tabpanels[splitview] .split-view-panel.deck-selected > .browserContainer {
      outline: 1px solid color-mix(in srgb, var(--fluxion-accent) 70%, transparent) !important;
    }
    #tabbrowser-tabpanels[splitview] .split-view-splitter {
      width: 3px !important; margin-inline: 2px !important;
      border-radius: 0 !important; transition: background-color 100ms linear !important;
    }
    #tabbrowser-tabpanels[splitview] .split-view-splitter:hover {
      background-color: color-mix(in srgb, var(--fluxion-accent) 58%, transparent) !important;
    }
    #tabbrowser-tabpanels[splitview] split-view-footer {
      min-height: 25px; padding: 2px 4px 2px 7px !important; gap: 5px !important;
      color: var(--fluxion-muted) !important; background: var(--fluxion-bg-raised) !important;
      border-color: var(--fluxion-line) !important; border-start-start-radius: 3px !important;
      border-end-end-radius: 0 !important; font: menu; font-size: 11px;
    }
    #tabbrowser-tabpanels[splitview] split-view-footer toolbarbutton {
      width: 20px; height: 20px; min-width: 20px; padding: 4px !important;
      border-radius: 3px !important;
    }
    #fluxion-flow {
      width: 232px; min-width: 232px; max-width: 232px;
      color: var(--fluxion-ink); background: var(--fluxion-bg);
      border-inline-end: 1px solid var(--fluxion-line);
      font: menu; font-size: 12px; overflow: hidden;
      transition: width var(--fluxion-fast), min-width var(--fluxion-fast), max-width var(--fluxion-fast);
    }
    #fluxion-flow[data-state="compact"] { width: 44px; min-width: 44px; max-width: 44px; }
    #fluxion-flow[data-state="focus"] { width: 3px; min-width: 3px; max-width: 3px; cursor: e-resize; }
    #fluxion-flow[data-state="focus"] > * { opacity: 0; pointer-events: none; }
    #fluxion-flow[data-state="focus"]:hover { background: var(--fluxion-accent); }
    #fluxion-flow * { box-sizing: border-box; }
    .fluxion-header {
      min-height: 38px; display: flex; align-items: center; gap: 6px;
      padding: 5px 7px; border-bottom: 1px solid var(--fluxion-line);
    }
    .fluxion-mark {
      width: 24px; height: 24px; flex: none; display: grid; place-items: center;
      color: var(--fluxion-ink);
    }
    .fluxion-mark svg { width: 18px; height: 18px; }
    .fluxion-name { font-weight: 600; letter-spacing: -.005em; flex: 1; white-space: nowrap; }
    .fluxion-icon-button, .fluxion-close, .fluxion-audio {
      border: 0; padding: 0; color: inherit; background: transparent; border-radius: 4px;
      display: grid; place-items: center; cursor: default;
    }
    .fluxion-icon-button { width: 24px; height: 24px; font-size: 15px; }
    .fluxion-icon-button:hover, .fluxion-close:hover, .fluxion-audio:hover { background: var(--fluxion-hover); }
    .fluxion-icon-button:focus-visible, .fluxion-tab:focus-visible, .fluxion-workspace:focus-visible {
      outline: 2px solid var(--fluxion-accent); outline-offset: -2px;
    }
    .fluxion-workspaces { display: flex; align-items: center; gap: 3px; padding: 5px 7px 4px; }
    .fluxion-workspace-list {
      min-width: 0; flex: 1; display: flex; align-items: center; gap: 2px;
      overflow-x: auto; scrollbar-width: none;
    }
    .fluxion-workspace-list::-webkit-scrollbar { display: none; }
    .fluxion-workspace {
      position: relative; min-width: 44px; max-width: 88px; height: 27px; flex: 1 0 44px;
      display: flex; align-items: center; justify-content: center; gap: 5px;
      border: 0; border-radius: 0;
      color: var(--fluxion-muted); background: transparent; font: inherit;
      font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .fluxion-workspace-symbol { width: 10px; height: 10px; flex: none; color: var(--workspace-accent); }
    .fluxion-workspace-symbol * { vector-effect: non-scaling-stroke; }
    .fluxion-workspace-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
    .fluxion-add-workspace {
      width: 24px; height: 27px; flex: none; display: grid; place-items: center;
      border: 0; border-radius: 3px; color: var(--fluxion-muted); background: transparent;
      font: inherit; font-size: 15px;
    }
    .fluxion-add-workspace:hover { color: var(--fluxion-ink); background: var(--fluxion-hover); }
    .fluxion-add-workspace:disabled { opacity: .35; }
    .fluxion-workspace:hover { color: var(--fluxion-ink); }
    .fluxion-workspace[data-dragover="true"] { background: var(--fluxion-hover); color: var(--fluxion-ink); }
    .fluxion-workspace[aria-pressed="true"] {
      color: var(--fluxion-ink); background: transparent; font-weight: 600;
    }
    .fluxion-workspace[aria-pressed="true"]::after {
      content: ""; position: absolute; inset: auto 3px 0; height: 1px;
      background: var(--workspace-accent, var(--fluxion-accent));
    }
    .fluxion-section-label {
      height: 24px; display: flex; align-items: center; padding: 4px 11px 3px;
      color: var(--fluxion-muted); font-size: 10px; font-weight: 600;
      letter-spacing: .055em; text-transform: uppercase; white-space: nowrap;
    }
    .fluxion-section-label[hidden], .fluxion-tabs[hidden] { display: none !important; }
    .fluxion-tabs { flex: 1; overflow-y: auto; overflow-x: hidden; padding: 1px 5px 7px; scrollbar-width: thin; }
    .fluxion-tab {
      position: relative; height: 32px; display: flex; align-items: center; gap: 7px;
      padding: 0 6px; margin: 1px 0; border-radius: 3px; color: var(--fluxion-muted);
      user-select: none; transition: opacity 100ms ease, transform var(--fluxion-fast), background-color 80ms linear;
    }
    :root[data-fluxion-density="compact"] .fluxion-tab { height: 28px; }
    :root[data-fluxion-density="roomy"] .fluxion-tab { height: 36px; }
    :root[data-fluxion-no-motion] #fluxion-flow,
    :root[data-fluxion-no-motion] .fluxion-tab,
    :root[data-fluxion-no-motion] .fluxion-group-disclosure { transition: none !important; }
    .fluxion-tab:hover { background: var(--fluxion-hover); color: var(--fluxion-ink); }
    .fluxion-tab[aria-selected="true"] { color: var(--fluxion-ink); background: var(--fluxion-selected); }
    .fluxion-tab[aria-selected="true"]::before {
      content: ""; position: absolute; inset-inline-start: 0; width: 2px; height: 14px;
      background: var(--fluxion-accent);
    }
    .fluxion-tab.is-closing { opacity: 0; transform: scaleY(.72); pointer-events: none; }
    .fluxion-tab.is-sleeping { color: color-mix(in srgb, var(--fluxion-muted) 82%, transparent); }
    .fluxion-tab.is-sleeping::after {
      content: ""; width: 7px; height: 7px; flex: none; border: 1px solid currentColor;
      border-block-start-color: transparent; border-radius: 50%; transform: rotate(-35deg);
    }
    .fluxion-tab.is-dragover::after {
      content: ""; position: absolute; inset: -2px 4px auto; height: 2px; background: var(--fluxion-accent);
    }
    .fluxion-split {
      position: relative; margin: 2px 0 3px; padding-inline-start: 3px;
      border-inline-start: 1px solid var(--fluxion-line);
    }
    .fluxion-split[data-active="true"] { border-inline-start-color: var(--fluxion-accent); }
    .fluxion-split > .fluxion-tab { margin-block: 0; }
    .fluxion-split-mark {
      width: 13px; height: 12px; flex: none; position: relative;
      color: var(--fluxion-muted); opacity: .8;
    }
    .fluxion-split-mark::before,
    .fluxion-split-mark::after {
      content: ""; position: absolute; inset-block: 2px; width: 4px;
      border: 1px solid currentColor; border-radius: 1px;
    }
    .fluxion-split-mark::before { inset-inline-start: 1px; }
    .fluxion-split-mark::after { inset-inline-end: 1px; }
    .fluxion-group { margin: 2px 0 4px; }
    .fluxion-group-heading {
      width: 100%; height: 25px; display: flex; align-items: center; gap: 5px;
      padding: 0 7px; border: 0; border-radius: 3px; color: var(--fluxion-muted);
      background: transparent; font: inherit; font-size: 10.5px; text-align: start;
    }
    .fluxion-group-heading:hover,
    .fluxion-group-heading[data-dragover="true"] { color: var(--fluxion-ink); background: var(--fluxion-hover); }
    .fluxion-group-heading.has-active { color: var(--fluxion-ink); }
    .fluxion-group-disclosure { width: 9px; flex: none; font-size: 12px; transition: transform var(--fluxion-fast); }
    .fluxion-group:not(.is-collapsed) .fluxion-group-disclosure { transform: rotate(90deg); }
    .fluxion-group-mark { width: 2px; height: 12px; flex: none; background: var(--group-accent); }
    .fluxion-group-name { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .fluxion-group-count { color: var(--fluxion-muted); font-variant-numeric: tabular-nums; }
    .fluxion-group-tabs { margin-inline-start: 8px; padding-inline-start: 3px; border-inline-start: 1px solid var(--fluxion-line); }
    .fluxion-group.is-collapsed .fluxion-group-tabs { display: none; }
    .fluxion-favicon {
      width: 16px; height: 16px; flex: none; object-fit: contain; border-radius: 2px;
    }
    .fluxion-fallback {
      width: 16px; height: 16px; flex: none; display: grid; place-items: center;
      color: var(--fluxion-muted); font-size: 11px; border: 1px solid var(--fluxion-line); border-radius: 50%;
    }
    .fluxion-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .fluxion-close, .fluxion-audio { width: 22px; height: 22px; flex: none; font-size: 14px; opacity: 0; }
    .fluxion-tab:hover .fluxion-close, .fluxion-tab:focus-within .fluxion-close, .fluxion-audio { opacity: 1; }
    .fluxion-footer {
      height: 36px; display: flex; align-items: center; gap: 6px; padding: 4px 7px;
      border-top: 1px solid var(--fluxion-line);
    }
    .fluxion-new-tab {
      flex: 1; height: 26px; border: 0; border-radius: 3px; background: transparent;
      color: var(--fluxion-ink); font: inherit; text-align: start; padding: 0 7px;
    }
    .fluxion-new-tab:hover { background: var(--fluxion-hover); }
    .fluxion-count { color: var(--fluxion-muted); min-width: 18px; text-align: center; font-variant-numeric: tabular-nums; }
    #fluxion-flow[data-state="compact"] .fluxion-name,
    #fluxion-flow[data-state="compact"] .fluxion-section-label,
    #fluxion-flow[data-state="compact"] .fluxion-title,
    #fluxion-flow[data-state="compact"] .fluxion-group-name,
    #fluxion-flow[data-state="compact"] .fluxion-group-count,
    #fluxion-flow[data-state="compact"] .fluxion-split-mark,
    #fluxion-flow[data-state="compact"] .fluxion-close,
    #fluxion-flow[data-state="compact"] .fluxion-count,
    #fluxion-flow[data-state="compact"] .fluxion-new-tab span { display: none; }
    .fluxion-pinned-tabs {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(30px, 1fr));
      gap: 2px; padding: 1px 5px 6px;
    }
    .fluxion-pinned-tabs .fluxion-tab { justify-content: center; margin: 0; padding: 0; }
    .fluxion-pinned-tabs .fluxion-title,
    .fluxion-pinned-tabs .fluxion-close { display: none; }
    #fluxion-flow[data-state="compact"] .fluxion-header { padding-inline: 10px; }
    #fluxion-flow[data-state="compact"] .fluxion-icon-button { display: none; }
    #fluxion-flow[data-state="compact"] .fluxion-workspaces { flex-direction: column; gap: 2px; padding: 4px 7px; }
    #fluxion-flow[data-state="compact"] .fluxion-workspace-list {
      width: 30px; flex: none; flex-direction: column; overflow-x: hidden; overflow-y: auto;
    }
    #fluxion-flow[data-state="compact"] .fluxion-workspace {
      min-width: 30px; width: 30px; height: 28px; flex: none; padding: 0;
    }
    #fluxion-flow[data-state="compact"] .fluxion-workspace-name { display: none; }
    #fluxion-flow[data-state="compact"] .fluxion-workspace-symbol { width: 12px; height: 12px; }
    #fluxion-flow[data-state="compact"] .fluxion-add-workspace { width: 30px; height: 28px; }
    #fluxion-flow[data-state="compact"] .fluxion-tabs { padding-inline: 6px; }
    #fluxion-flow[data-state="compact"] .fluxion-tab { justify-content: center; padding: 0; }
    #fluxion-flow[data-state="compact"] .fluxion-group-heading { justify-content: center; padding: 0; }
    #fluxion-flow[data-state="compact"] .fluxion-group-disclosure { display: none; }
    #fluxion-flow[data-state="compact"] .fluxion-group-tabs { margin-inline-start: 3px; padding-inline-start: 0; }
    #fluxion-flow[data-state="compact"] .fluxion-footer { padding-inline: 7px; }
    #fluxion-flow[data-state="compact"] .fluxion-new-tab { flex: none; width: 30px; text-align: center; }
    @media (prefers-reduced-motion: reduce) {
      #fluxion-flow, .fluxion-tab { transition-duration: 0.01ms !important; }
    }
  `;
  document.documentElement.appendChild(style);
  document.documentElement.setAttribute(
    "data-fluxion-density",
    ["compact", "standard", "roomy"].includes(Services.prefs.getStringPref("fluxion.tabs.density", "standard"))
      ? Services.prefs.getStringPref("fluxion.tabs.density", "standard")
      : "standard",
  );
  document.documentElement.toggleAttribute(
    "data-fluxion-no-motion",
    !Services.prefs.getBoolPref("fluxion.animations.enabled", true),
  );

  let workspaces;
  try {
    workspaces = FluxionWorkspaces.parseWorkspaces(Services.prefs.getStringPref(PREF_WORKSPACES, ""));
  } catch (_) {
    workspaces = FluxionWorkspaces.DEFAULTS.map(item => ({ ...item }));
  }
  Services.prefs.setStringPref(PREF_WORKSPACES, JSON.stringify(workspaces));
  let currentWorkspace = Services.prefs.getStringPref(PREF_CURRENT, workspaces[0].id);
  if (!workspaces.some(item => item.id === currentWorkspace)) currentWorkspace = workspaces[0].id;

  try {
    SessionStore.persistTabAttribute(TAB_WORKSPACE);
  } catch (_) {
    // Older compatible Firefox builds may already persist the attribute.
  }

  const browser = document.getElementById("browser");
  if (!browser) throw new Error("Fluxion: Firefox browser deck was not found");

  function brandMenuItem(id, label) {
    const item = document.getElementById(id);
    if (!item) return null;
    item.removeAttribute("data-l10n-id");
    item.setAttribute("label", label);
    return item;
  }

  brandMenuItem("aboutName", "About Fluxion");
  brandMenuItem("menu_preferences", "Fluxion Settings…");
  brandMenuItem("menu_setAsDefault", "Set Fluxion as Default Browser");
  brandMenuItem("menu_FileQuitItem", "Quit Fluxion");
  brandMenuItem("menu_mac_hide_app", "Hide Fluxion");
  const aboutItem = document.getElementById("aboutName");
  if (aboutItem) {
    on(aboutItem, "command", event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const tab = gBrowser.addTrustedTab(ABOUT_URL);
      tab.setAttribute(TAB_WORKSPACE, currentWorkspace);
      gBrowser.selectedTab = tab;
    }, true);
  }

  const flow = xul("vbox", { id: "fluxion-flow", role: "navigation", "aria-label": "Fluxion Flow" });
  const initialState = Services.prefs.getStringPref(PREF_SIDEBAR, "expanded");
  flow.dataset.state = SIDEBAR_STATES.includes(initialState) ? initialState : "expanded";

  const header = create("div", "fluxion-header");
  const mark = create("div", "fluxion-mark");
  mark.setAttribute("aria-hidden", "true");
  const markSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  markSvg.setAttribute("viewBox", "0 0 24 24");
  markSvg.setAttribute("fill", "none");
  const markPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
  markPath.setAttribute("d", "M5 4.5h13.5l-7.2 6.3H18L6 20l3.5-7H5z");
  markPath.setAttribute("stroke", "currentColor");
  markPath.setAttribute("stroke-width", "1.55");
  markPath.setAttribute("stroke-linejoin", "round");
  markSvg.appendChild(markPath);
  mark.appendChild(markSvg);
  const name = create("div", "fluxion-name");
  name.textContent = "Fluxion";
  const modeButton = create("button", "fluxion-icon-button");
  modeButton.type = "button";
  modeButton.title = "Cycle sidebar (Ctrl/⌘ Shift \\)";
  modeButton.setAttribute("aria-label", "Cycle sidebar size");
  modeButton.textContent = "‹";
  header.append(mark, name, modeButton);

  const workspaceBar = create("div", "fluxion-workspaces");
  const workspaceList = create("div", "fluxion-workspace-list");
  workspaceList.setAttribute("role", "tablist");
  workspaceList.setAttribute("aria-label", "Workspaces");
  const addWorkspaceButton = create("button", "fluxion-add-workspace");
  addWorkspaceButton.type = "button";
  addWorkspaceButton.textContent = "+";
  addWorkspaceButton.title = "New workspace";
  addWorkspaceButton.setAttribute("aria-label", "New workspace");
  workspaceBar.append(workspaceList, addWorkspaceButton);
  const pinnedLabel = create("div", "fluxion-section-label");
  pinnedLabel.textContent = "Pinned";
  const pinnedTabs = create("div", "fluxion-tabs fluxion-pinned-tabs");
  pinnedTabs.style.flex = "none";
  const openLabel = create("div", "fluxion-section-label");
  openLabel.textContent = "Flow";
  const tabsList = create("div", "fluxion-tabs");
  tabsList.setAttribute("role", "tablist");

  const footer = create("div", "fluxion-footer");
  const newTabButton = create("button", "fluxion-new-tab");
  newTabButton.type = "button";
  newTabButton.innerHTML = `<b aria-hidden="true">+</b> <span>New tab</span>`;
  newTabButton.setAttribute("aria-label", "New tab");
  const count = create("span", "fluxion-count");
  footer.append(newTabButton, count);
  flow.append(header, workspaceBar, pinnedLabel, pinnedTabs, openLabel, tabsList, footer);
  browser.prepend(flow);

  function tabWorkspace(tab) {
    let id = tab.getAttribute(TAB_WORKSPACE);
    if (!workspaces.some(item => item.id === id)) {
      id = currentWorkspace;
      tab.setAttribute(TAB_WORKSPACE, id);
    }
    return id;
  }

  function tabLabel(tab) {
    return tab.label || tab.getAttribute("label") || "New tab";
  }

  function iconFor(tab) {
    return tab.getAttribute("image") || tab.image || "";
  }

  function askGroupName(title, initialValue = "") {
    const value = { value: initialValue };
    const accepted = Services.prompt.prompt(
      window,
      title,
      "Group name:",
      value,
      null,
      { value: false },
    );
    return accepted ? FluxionTabGroups.normaliseGroupName(value.value) : null;
  }

  function createGroupForTab(tab) {
    if (!tab || !tab.parentNode) return null;
    const name = askGroupName("New Tab Group");
    if (name === null) return null;
    if (!name) {
      Services.prompt.alert(window, "Group Not Created", "Enter a group name.");
      return null;
    }
    const group = gBrowser.addTabGroup([tab], { label: name, insertBefore: tab });
    scheduleRender();
    return group;
  }

  function renameGroup(group) {
    if (!group?.isConnected) return;
    const name = askGroupName("Rename Tab Group", group.label || "");
    if (name) group.label = name;
  }

  function moveGroupToWorkspace(group, id) {
    if (!group?.isConnected || !workspaces.some(item => item.id === id)) return;
    for (const tab of group.tabs) tab.setAttribute(TAB_WORKSPACE, id);
    if (id !== currentWorkspace && group.tabs.includes(gBrowser.selectedTab)) {
      const replacement = [...gBrowser.tabs].find(
        tab => !group.tabs.includes(tab) && tabWorkspace(tab) === currentWorkspace,
      );
      if (replacement) gBrowser.selectedTab = replacement;
    }
    switchWorkspace(currentWorkspace);
  }

  function reorderGroup(group, direction) {
    const groups = gBrowser.tabGroups.filter(candidate =>
      candidate.tabs.some(tab => tabWorkspace(tab) === currentWorkspace)
    );
    const index = groups.indexOf(group);
    const target = groups[index + Math.sign(direction)];
    if (index < 0 || !target) return;
    if (direction < 0) gBrowser.moveTabBefore(group, target);
    else gBrowser.moveTabAfter(group, target);
    scheduleRender();
  }

  function saveWorkspaces(next) {
    workspaces = next.map(workspace => ({ ...workspace }));
    Services.prefs.setStringPref(PREF_WORKSPACES, JSON.stringify(workspaces));
    Services.prefs.savePrefFile(null);
    scheduleRender();
  }

  function askWorkspaceName(title, message, initialValue = "") {
    const value = { value: initialValue };
    const accepted = Services.prompt.prompt(window, title, message, value, null, {
      value: false,
    });
    return accepted ? value.value : null;
  }

  function addWorkspace() {
    const name = askWorkspaceName("New Workspace", "Name this workspace:");
    if (name === null) return null;
    const result = FluxionWorkspaces.createWorkspace(workspaces, name);
    if (!result) {
      Services.prompt.alert(
        window,
        "Workspace Not Created",
        workspaces.length >= FluxionWorkspaces.MAX_WORKSPACES
          ? `Fluxion supports up to ${FluxionWorkspaces.MAX_WORKSPACES} workspaces.`
          : "Enter a workspace name.",
      );
      return null;
    }
    saveWorkspaces(result.items);
    switchWorkspace(result.workspace.id);
    return result.workspace;
  }

  function renameWorkspace(id) {
    const workspace = workspaces.find(item => item.id === id);
    if (!workspace) return;
    const name = askWorkspaceName("Rename Workspace", "Workspace name:", workspace.name);
    if (name === null) return;
    const next = FluxionWorkspaces.updateWorkspace(workspaces, id, { name });
    if (next) saveWorkspaces(next);
  }

  function updateWorkspaceAppearance(id, changes) {
    const next = FluxionWorkspaces.updateWorkspace(workspaces, id, changes);
    if (next) saveWorkspaces(next);
  }

  function reorderWorkspace(id, direction) {
    const next = FluxionWorkspaces.moveWorkspace(workspaces, id, direction);
    if (next) saveWorkspaces(next);
  }

  function deleteWorkspace(id) {
    const workspace = workspaces.find(item => item.id === id);
    const result = FluxionWorkspaces.removeWorkspace(workspaces, id);
    if (!workspace || !result) {
      Services.prompt.alert(window, "Workspace Required", "Fluxion must keep at least one workspace.");
      return;
    }
    const ownedTabs = [...gBrowser.tabs].filter(tab => tab.getAttribute(TAB_WORKSPACE) === id);
    const destination = result.items.find(item => item.id === result.fallbackId);
    const confirmed = Services.prompt.confirm(
      window,
      "Delete Workspace",
      ownedTabs.length
        ? `Delete “${workspace.name}” and move its ${ownedTabs.length} tab${ownedTabs.length === 1 ? "" : "s"} to “${destination.name}”?`
        : `Delete “${workspace.name}”?`,
    );
    if (!confirmed) return;
    for (const tab of ownedTabs) tab.setAttribute(TAB_WORKSPACE, result.fallbackId);
    if (currentWorkspace === id) currentWorkspace = result.fallbackId;
    saveWorkspaces(result.items);
    switchWorkspace(currentWorkspace);
  }

  function switchWorkspace(id) {
    if (!workspaces.some(item => item.id === id)) return;
    currentWorkspace = id;
    Services.prefs.setStringPref(PREF_CURRENT, id);

    let workspaceTabs = [...gBrowser.tabs].filter(tab => tabWorkspace(tab) === id);
    for (const tab of workspaceTabs) {
      if (tab.hidden) gBrowser.showTab(tab);
    }
    if (!workspaceTabs.length) {
      const tab = gBrowser.addTrustedTab(NEW_TAB_URL);
      tab.setAttribute(TAB_WORKSPACE, id);
      workspaceTabs = [tab];
    }

    if (tabWorkspace(gBrowser.selectedTab) !== id) {
      gBrowser.selectedTab = workspaceTabs[0];
    }
    for (const tab of gBrowser.tabs) {
      if (tabWorkspace(tab) !== id && !tab.hidden && tab !== gBrowser.selectedTab) {
        gBrowser.hideTab(tab);
      }
    }
    scheduleRender();
  }

  function cycleWorkspace(direction) {
    const id = FluxionWorkspaces.nextWorkspaceId(workspaces, currentWorkspace, direction);
    if (id) switchWorkspace(id);
  }

  function moveTabToWorkspace(tab, id) {
    if (!tab || !workspaces.some(item => item.id === id)) return;
    const movingTabs = tab.splitview?.tabs || [tab];
    for (const movingTab of movingTabs) movingTab.setAttribute(TAB_WORKSPACE, id);
    if (id !== currentWorkspace && movingTabs.includes(gBrowser.selectedTab)) {
      const replacement = [...gBrowser.tabs].find(
        candidate => !movingTabs.includes(candidate) && tabWorkspace(candidate) === currentWorkspace,
      );
      if (replacement) gBrowser.selectedTab = replacement;
      else switchWorkspace(currentWorkspace);
    }
    switchWorkspace(currentWorkspace);
  }

  function createSplitView(primary, secondary, options = {}) {
    if (!FluxionSplitViews.canSplit(primary, secondary)) return null;
    const workspace = tabWorkspace(primary);
    secondary.setAttribute(TAB_WORKSPACE, workspace);
    const insertionPoint = primary.group || primary;
    const splitView = gBrowser.addTabSplitView([primary, secondary], {
      insertBefore: insertionPoint,
      trigger: "menu_open",
    });
    if (!splitView || splitView.tabs.length !== 2) return null;
    gBrowser.selectedTab = options.selectSecondary ? secondary : primary;
    scheduleRender();
    return splitView;
  }

  function openNewSplit(primary = gBrowser.selectedTab) {
    if (!primary || primary.pinned || primary.splitview) return null;
    const tab = gBrowser.addTrustedTab(NEW_TAB_URL);
    tab.setAttribute(TAB_WORKSPACE, tabWorkspace(primary));
    const splitView = createSplitView(primary, tab, { selectSecondary: true });
    if (!splitView) {
      gBrowser.removeTab(tab, { animate: false });
      return null;
    }
    window.requestAnimationFrame(() => {
      if (gBrowser.selectedTab === tab && window.gURLBar) window.gURLBar.select();
    });
    return splitView;
  }

  function separateSplitView(tab = gBrowser.selectedTab) {
    const splitView = tab?.splitview;
    if (!splitView) return;
    splitView.unsplitTabs("menu_separate");
    scheduleRender();
  }

  function reverseSplitView(tab = gBrowser.selectedTab) {
    const splitView = tab?.splitview;
    if (!splitView || splitView.tabs.length !== 2) return;
    splitView.reverseTabs("menu");
    scheduleRender();
  }

  function setSidebarState(value) {
    const state = SIDEBAR_STATES.includes(value) ? value : "expanded";
    flow.dataset.state = state;
    Services.prefs.setStringPref(PREF_SIDEBAR, state);
    Services.prefs.savePrefFile(null);
    modeButton.textContent = state === "expanded" ? "‹" : state === "compact" ? "·" : "›";
    scheduleRender();
  }

  function cycleSidebar() {
    const index = SIDEBAR_STATES.indexOf(flow.dataset.state);
    setSidebarState(SIDEBAR_STATES[(index + 1) % SIDEBAR_STATES.length]);
  }

  function setTabDensity(value) {
    const density = ["compact", "standard", "roomy"].includes(value) ? value : "standard";
    document.documentElement.setAttribute("data-fluxion-density", density);
    Services.prefs.setStringPref("fluxion.tabs.density", density);
    Services.prefs.savePrefFile(null);
  }

  function openWorkspaceTab() {
    const tab = gBrowser.addTrustedTab(NEW_TAB_URL);
    tab.setAttribute(TAB_WORKSPACE, currentWorkspace);
    gBrowser.selectedTab = tab;
    window.requestAnimationFrame(() => {
      if (window.gURLBar && tab === gBrowser.selectedTab) window.gURLBar.select();
    });
    return tab;
  }

  function closeWithStability(tab, element) {
    if (!tab || tab.closing) return;
    element.classList.add("is-closing");
    window.setTimeout(() => {
      if (tab.parentNode) gBrowser.removeTab(tab, { animate: false });
    }, window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 120);
  }

  function createTabElement(tab) {
    const item = create("div", "fluxion-tab");
    const sleeping = !tab.linkedPanel || tab.hasAttribute("pending") || tab.hasAttribute("fluxion-sleeping");
    item.classList.toggle("is-sleeping", sleeping);
    item.tabIndex = 0;
    item.draggable = true;
    item.setAttribute("role", "tab");
    item.setAttribute("aria-selected", String(tab === gBrowser.selectedTab));
    item.title = `${tabLabel(tab)}\n${tab.linkedBrowser?.currentURI?.displaySpec || ""}${sleeping ? "\nSleeping — select to restore" : ""}`;

    const faviconUrl = iconFor(tab);
    if (faviconUrl) {
      const favicon = create("img", "fluxion-favicon");
      favicon.alt = "";
      favicon.src = faviconUrl;
      favicon.addEventListener("error", () => favicon.replaceWith(fallbackIcon()));
      item.appendChild(favicon);
    } else {
      item.appendChild(fallbackIcon());
    }

    const title = create("span", "fluxion-title");
    title.textContent = tabLabel(tab);
    item.appendChild(title);

    if (tab.splitview) {
      const splitMark = create("span", "fluxion-split-mark");
      const position = FluxionSplitViews.splitPosition(tab);
      splitMark.title = `Split view, side ${position} of ${tab.splitview.tabs.length}`;
      splitMark.setAttribute("aria-label", splitMark.title);
      item.appendChild(splitMark);
    }

    if (tab.soundPlaying || tab.muted) {
      const audio = create("button", "fluxion-audio");
      audio.type = "button";
      audio.textContent = tab.muted ? "×" : "◦";
      audio.title = tab.muted ? "Unmute tab" : "Mute tab";
      audio.setAttribute("aria-label", audio.title);
      audio.addEventListener("click", event => {
        event.stopPropagation();
        tab.toggleMuteAudio();
      });
      item.appendChild(audio);
    }

    const close = create("button", "fluxion-close");
    close.type = "button";
    close.textContent = "×";
    close.title = "Close tab";
    close.setAttribute("aria-label", `Close ${tabLabel(tab)}`);
    close.addEventListener("click", event => {
      event.stopPropagation();
      closeWithStability(tab, item);
    });
    item.appendChild(close);

    const select = () => { gBrowser.selectedTab = tab; };
    item.addEventListener("click", select);
    item.addEventListener("auxclick", event => {
      if (event.button === 1) closeWithStability(tab, item);
    });
    item.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); select(); }
      if (event.key === "Delete") { event.preventDefault(); closeWithStability(tab, item); }
    });
    item.addEventListener("contextmenu", event => {
      event.preventDefault();
      contextTab = tab;
      contextMenu.openPopupAtScreen(event.screenX, event.screenY, true);
    });
    item.addEventListener("dragstart", event => {
      dragTab = tab;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("application/x-fluxion-tab", "tab");
    });
    item.addEventListener("dragover", event => {
      if (!dragTab || dragTab === tab) return;
      event.preventDefault();
      item.classList.add("is-dragover");
    });
    item.addEventListener("dragleave", () => item.classList.remove("is-dragover"));
    item.addEventListener("drop", event => {
      event.preventDefault();
      item.classList.remove("is-dragover");
      if (dragTab && dragTab !== tab) gBrowser.moveTabTo(dragTab, tab._tPos);
      dragTab = null;
    });
    item.addEventListener("dragend", () => { dragTab = null; });
    return item;
  }

  function createSplitElement(splitView, tabs) {
    const item = create("div", "fluxion-split");
    item.setAttribute("role", "group");
    item.setAttribute("aria-label", "Split view");
    item.dataset.active = String(Boolean(splitView?.hasActiveTab));
    for (const tab of tabs) item.appendChild(createTabElement(tab));
    return item;
  }

  function appendSplitRows(container, tabs) {
    for (const row of FluxionSplitViews.projectSplitRows(tabs)) {
      container.appendChild(
        row.kind === "split"
          ? createSplitElement(row.splitView, row.tabs)
          : createTabElement(row.tab),
      );
    }
  }

  function fallbackIcon() {
    const fallback = create("span", "fluxion-fallback");
    fallback.textContent = "·";
    return fallback;
  }

  function workspaceSymbol(icon) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "fluxion-workspace-symbol");
    svg.setAttribute("viewBox", "0 0 12 12");
    svg.setAttribute("fill", "none");
    svg.setAttribute("aria-hidden", "true");
    const addShape = (tag, attributes) => {
      const shape = document.createElementNS("http://www.w3.org/2000/svg", tag);
      for (const [name, value] of Object.entries(attributes)) shape.setAttribute(name, value);
      svg.appendChild(shape);
    };
    const stroke = { stroke: "currentColor", "stroke-width": "1.2" };
    if (icon === "diamond") {
      addShape("path", { d: "M6 1.5 10.5 6 6 10.5 1.5 6Z", ...stroke });
    } else if (icon === "square") {
      addShape("rect", { x: "1.75", y: "1.75", width: "8.5", height: "8.5", rx: ".6", ...stroke });
    } else if (icon === "arc") {
      addShape("path", { d: "M2 8.5a4.5 4.5 0 0 1 8 0", "stroke-linecap": "round", ...stroke });
    } else if (icon === "grid") {
      for (const [x, y] of [[2, 2], [7, 2], [2, 7], [7, 7]]) {
        addShape("rect", { x: String(x), y: String(y), width: "3", height: "3", rx: ".35", ...stroke });
      }
    } else {
      addShape("circle", { cx: "6", cy: "6", r: "4.25", ...stroke });
    }
    return svg;
  }

  function createGroupElement(group, tabs) {
    const colours = {
      blue: "#51748a", purple: "#756681", cyan: "#4f7d7e",
      orange: "#907052", yellow: "#8a7b4c", pink: "#896777",
      green: "#667c69", gray: "#68747b", red: "#8b646b",
    };
    const item = create("div", "fluxion-group");
    item.classList.toggle("is-collapsed", Boolean(group.collapsed));
    item.style.setProperty("--group-accent", colours[group.color] || colours.gray);

    const heading = create("button", "fluxion-group-heading");
    heading.type = "button";
    heading.classList.toggle("has-active", tabs.includes(gBrowser.selectedTab));
    heading.setAttribute("aria-expanded", String(!group.collapsed));
    heading.title = group.label || "Tab group";
    const disclosure = create("span", "fluxion-group-disclosure");
    disclosure.textContent = "›";
    disclosure.setAttribute("aria-hidden", "true");
    const mark = create("span", "fluxion-group-mark");
    mark.setAttribute("aria-hidden", "true");
    const label = create("span", "fluxion-group-name");
    label.textContent = group.label || "Group";
    const groupCount = create("span", "fluxion-group-count");
    groupCount.textContent = String(tabs.length);
    heading.append(disclosure, mark, label, groupCount);
    heading.addEventListener("click", () => {
      group.collapsed = !group.collapsed;
      scheduleRender();
    });
    heading.addEventListener("contextmenu", event => {
      event.preventDefault();
      contextGroup = group;
      groupMenu.openPopupAtScreen(event.screenX, event.screenY, true);
    });
    heading.addEventListener("dragover", event => {
      if (!dragTab || dragTab.group === group) return;
      event.preventDefault();
      heading.setAttribute("data-dragover", "true");
    });
    heading.addEventListener("dragleave", () => heading.removeAttribute("data-dragover"));
    heading.addEventListener("drop", event => {
      event.preventDefault();
      heading.removeAttribute("data-dragover");
      if (dragTab) group.addTabs([dragTab]);
      dragTab = null;
      scheduleRender();
    });

    const groupTabs = create("div", "fluxion-group-tabs");
    appendSplitRows(groupTabs, tabs);
    item.append(heading, groupTabs);
    return item;
  }

  function renderWorkspaces() {
    workspaceList.replaceChildren();
    const colours = { slate: "#68747b", blue: "#51748a", ochre: "#92794d", sage: "#667c69", rose: "#8b646b" };
    for (const workspace of workspaces) {
      const button = create("button", "fluxion-workspace");
      button.type = "button";
      button.title = workspace.name;
      button.setAttribute("role", "tab");
      button.setAttribute("aria-pressed", String(workspace.id === currentWorkspace));
      button.style.setProperty("--workspace-accent", colours[workspace.accent]);
      const label = create("span", "fluxion-workspace-name");
      label.textContent = workspace.name;
      button.append(workspaceSymbol(workspace.icon), label);
      button.addEventListener("click", () => switchWorkspace(workspace.id));
      button.addEventListener("contextmenu", event => {
        event.preventDefault();
        contextWorkspace = workspace.id;
        workspaceMenu.openPopupAtScreen(event.screenX, event.screenY, true);
      });
      button.addEventListener("dragover", event => {
        if (!dragTab || tabWorkspace(dragTab) === workspace.id) return;
        event.preventDefault();
        button.setAttribute("data-dragover", "true");
      });
      button.addEventListener("dragleave", () => button.removeAttribute("data-dragover"));
      button.addEventListener("drop", event => {
        event.preventDefault();
        button.removeAttribute("data-dragover");
        if (dragTab) moveTabToWorkspace(dragTab, workspace.id);
        dragTab = null;
      });
      workspaceList.appendChild(button);
    }
    addWorkspaceButton.disabled = workspaces.length >= FluxionWorkspaces.MAX_WORKSPACES;
  }

  function render() {
    renderQueued = false;
    renderWorkspaces();
    pinnedTabs.replaceChildren();
    tabsList.replaceChildren();
    const visible = [...gBrowser.tabs].filter(tab => tabWorkspace(tab) === currentWorkspace);
    for (const tab of visible.filter(tab => tab.pinned)) {
      pinnedTabs.appendChild(createTabElement(tab));
    }
    const rows = FluxionTabGroups.projectTabRows(
      visible.filter(tab => !tab.pinned),
      currentWorkspace,
      { workspaceOf: tabWorkspace, groupOf: tab => tab.group },
    );
    const seenSplitViews = new Set();
    for (const row of rows) {
      if (row.kind === "group") {
        tabsList.appendChild(createGroupElement(row.group, row.tabs));
        continue;
      }
      const splitView = row.tab.splitview;
      if (!splitView) {
        tabsList.appendChild(createTabElement(row.tab));
        continue;
      }
      if (seenSplitViews.has(splitView)) continue;
      seenSplitViews.add(splitView);
      const splitTabs = splitView.tabs.filter(tab =>
        visible.includes(tab) && !tab.pinned && !tab.group
      );
      tabsList.appendChild(
        splitTabs.length > 1
          ? createSplitElement(splitView, splitTabs)
          : createTabElement(row.tab),
      );
    }
    pinnedLabel.hidden = pinnedTabs.childElementCount === 0;
    pinnedTabs.hidden = pinnedTabs.childElementCount === 0;
    count.textContent = String(visible.length);
  }

  function updateWindowTitle() {
    const label = tabLabel(gBrowser.selectedTab);
    const isPrivate = Boolean(window.PrivateBrowsingUtils?.isWindowPrivate(window));
    const title = `${label} — Fluxion${isPrivate ? " Private" : ""}`;
    if (document.title !== title) document.title = title;
  }

  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    window.requestAnimationFrame(() => {
      render();
      updateWindowTitle();
    });
  }

  const popupSet = document.getElementById("mainPopupSet");
  const appendAction = (popup, label, action, attributes = {}) => {
    const item = xul("menuitem", { label, ...attributes });
    item.addEventListener("command", action);
    popup.appendChild(item);
    return item;
  };

  const contextMenu = xul("menupopup", { id: "fluxion-tab-context" });
  appendAction(contextMenu, "Duplicate Tab", () => contextTab && gBrowser.duplicateTab(contextTab));
  appendAction(contextMenu, "Reload Tab", () => contextTab?.linkedBrowser.reload());
  appendAction(contextMenu, "Pin / Unpin Tab", () => {
    if (!contextTab) return;
    contextTab.pinned ? gBrowser.unpinTab(contextTab) : gBrowser.pinTab(contextTab);
  });
  const sleepTabItem = appendAction(contextMenu, "Sleep Background Tab", () => {
    if (contextTab) window.FluxionTabSleeping?.sleep(contextTab, { forceAge: true });
  });
  contextMenu.appendChild(xul("menuseparator"));
  const splitWithMenu = xul("menu", { label: "Open Side by Side With" });
  const splitWithPopup = xul("menupopup");
  splitWithMenu.appendChild(splitWithPopup);
  contextMenu.appendChild(splitWithMenu);
  const separateSplitItem = appendAction(
    contextMenu,
    "Separate Split View",
    () => separateSplitView(contextTab),
  );
  const reverseSplitItem = appendAction(
    contextMenu,
    "Swap Split Sides",
    () => reverseSplitView(contextTab),
  );
  splitWithPopup.addEventListener("popupshowing", event => {
    if (event.target !== splitWithPopup) return;
    splitWithPopup.replaceChildren();
    appendAction(splitWithPopup, "New Page", () => openNewSplit(contextTab));
    const candidates = [...gBrowser.tabs]
      .filter(tab =>
        tab !== contextTab &&
        tabWorkspace(tab) === currentWorkspace &&
        FluxionSplitViews.canSplit(contextTab, tab)
      )
      .sort((left, right) => (right.lastAccessed || 0) - (left.lastAccessed || 0));
    if (candidates.length) splitWithPopup.appendChild(xul("menuseparator"));
    for (const tab of candidates.slice(0, 16)) {
      appendAction(
        splitWithPopup,
        tabLabel(tab),
        () => createSplitView(contextTab, tab),
      );
    }
  });
  contextMenu.appendChild(xul("menuseparator"));
  const moveToMenu = xul("menu", { label: "Move to Workspace" });
  const moveToPopup = xul("menupopup");
  moveToMenu.appendChild(moveToPopup);
  contextMenu.appendChild(moveToMenu);
  const tabGroupMenu = xul("menu", { label: "Tab Group" });
  const tabGroupPopup = xul("menupopup");
  tabGroupMenu.appendChild(tabGroupPopup);
  contextMenu.appendChild(tabGroupMenu);
  tabGroupPopup.addEventListener("popupshowing", event => {
    if (event.target !== tabGroupPopup) return;
    tabGroupPopup.replaceChildren();
    appendAction(tabGroupPopup, "New Group…", () => createGroupForTab(contextTab));
    const groups = gBrowser.tabGroups.filter(group =>
      group.tabs.some(tab => tabWorkspace(tab) === currentWorkspace)
    );
    if (groups.length) tabGroupPopup.appendChild(xul("menuseparator"));
    for (const group of groups) {
      appendAction(
        tabGroupPopup,
        `Move to ${group.label || "Group"}`,
        () => {
          if (contextTab) group.addTabs([contextTab]);
          scheduleRender();
        },
        contextTab?.group === group ? { disabled: "true" } : {},
      );
    }
    if (contextTab?.group) {
      tabGroupPopup.appendChild(xul("menuseparator"));
      appendAction(tabGroupPopup, "Remove from Group", () => {
        if (contextTab) gBrowser.ungroupTab(contextTab);
        scheduleRender();
      });
    }
  });
  contextMenu.addEventListener("popupshowing", event => {
    if (event.target !== contextMenu) return;
    const inSplitView = Boolean(contextTab?.splitview);
    splitWithMenu.hidden = inSplitView || Boolean(contextTab?.pinned);
    separateSplitItem.hidden = !inSplitView;
    reverseSplitItem.hidden = !inSplitView;
    sleepTabItem.hidden = Boolean(contextTab?.selected || contextTab?.pinned || inSplitView || !contextTab?.linkedPanel);
    moveToPopup.replaceChildren();
    for (const workspace of workspaces) {
      appendAction(
        moveToPopup,
        workspace.name,
        () => contextTab && moveTabToWorkspace(contextTab, workspace.id),
        contextTab && tabWorkspace(contextTab) === workspace.id ? { disabled: "true" } : {},
      );
    }
  });
  contextMenu.appendChild(xul("menuseparator"));
  appendAction(contextMenu, "Close Tab", () => contextTab && gBrowser.removeTab(contextTab));

  const groupMenu = xul("menupopup", { id: "fluxion-group-context" });
  appendAction(groupMenu, "Rename Group…", () => renameGroup(contextGroup));
  const collapseGroupItem = appendAction(groupMenu, "Collapse Group", () => {
    if (contextGroup) contextGroup.collapsed = !contextGroup.collapsed;
  });
  const moveGroupUp = appendAction(groupMenu, "Move Group Up", () => reorderGroup(contextGroup, -1));
  const moveGroupDown = appendAction(groupMenu, "Move Group Down", () => reorderGroup(contextGroup, 1));
  groupMenu.appendChild(xul("menuseparator"));
  const groupColourMenu = xul("menu", { label: "Colour" });
  const groupColourPopup = xul("menupopup");
  const groupColourItems = new Map();
  for (const colour of FluxionTabGroups.GROUP_COLORS) {
    const item = appendAction(
      groupColourPopup,
      colour[0].toUpperCase() + colour.slice(1),
      () => {
        if (contextGroup) contextGroup.color = colour;
      },
      { type: "radio", name: "fluxion-tab-group-colour" },
    );
    groupColourItems.set(colour, item);
  }
  groupColourMenu.appendChild(groupColourPopup);
  groupMenu.appendChild(groupColourMenu);
  const groupWorkspaceMenu = xul("menu", { label: "Move Group to Workspace" });
  const groupWorkspacePopup = xul("menupopup");
  groupWorkspaceMenu.appendChild(groupWorkspacePopup);
  groupMenu.appendChild(groupWorkspaceMenu);
  groupMenu.appendChild(xul("menuseparator"));
  appendAction(groupMenu, "Ungroup Tabs", () => {
    contextGroup?.ungroupTabs();
    scheduleRender();
  });
  groupMenu.addEventListener("popupshowing", event => {
    if (event.target !== groupMenu) return;
    const groups = gBrowser.tabGroups.filter(group =>
      group.tabs.some(tab => tabWorkspace(tab) === currentWorkspace)
    );
    const index = groups.indexOf(contextGroup);
    collapseGroupItem.setAttribute(
      "label",
      contextGroup?.collapsed ? "Expand Group" : "Collapse Group",
    );
    moveGroupUp.setAttribute("disabled", String(index <= 0));
    moveGroupDown.setAttribute("disabled", String(index < 0 || index >= groups.length - 1));
    for (const [colour, item] of groupColourItems) {
      item.setAttribute("checked", String(contextGroup?.color === colour));
    }
    groupWorkspacePopup.replaceChildren();
    for (const workspace of workspaces) {
      const alreadyThere = contextGroup?.tabs.every(tab => tabWorkspace(tab) === workspace.id);
      appendAction(
        groupWorkspacePopup,
        workspace.name,
        () => moveGroupToWorkspace(contextGroup, workspace.id),
        alreadyThere ? { disabled: "true" } : {},
      );
    }
  });

  const workspaceMenu = xul("menupopup", { id: "fluxion-workspace-context" });
  appendAction(workspaceMenu, "Rename Workspace…", () => renameWorkspace(contextWorkspace));
  const moveWorkspaceLeft = appendAction(
    workspaceMenu,
    "Move Workspace Left",
    () => reorderWorkspace(contextWorkspace, -1),
  );
  const moveWorkspaceRight = appendAction(
    workspaceMenu,
    "Move Workspace Right",
    () => reorderWorkspace(contextWorkspace, 1),
  );
  workspaceMenu.appendChild(xul("menuseparator"));

  const accentMenu = xul("menu", { label: "Accent" });
  const accentPopup = xul("menupopup");
  const accentItems = new Map();
  for (const accent of FluxionWorkspaces.ACCENTS) {
    const item = appendAction(
      accentPopup,
      accent[0].toUpperCase() + accent.slice(1),
      () => updateWorkspaceAppearance(contextWorkspace, { accent }),
      { type: "radio", name: "fluxion-workspace-accent" },
    );
    accentItems.set(accent, item);
  }
  accentMenu.appendChild(accentPopup);
  workspaceMenu.appendChild(accentMenu);

  const symbolMenu = xul("menu", { label: "Symbol" });
  const symbolPopup = xul("menupopup");
  const symbolItems = new Map();
  for (const icon of FluxionWorkspaces.ICONS) {
    const item = appendAction(
      symbolPopup,
      icon[0].toUpperCase() + icon.slice(1),
      () => updateWorkspaceAppearance(contextWorkspace, { icon }),
      { type: "radio", name: "fluxion-workspace-symbol" },
    );
    symbolItems.set(icon, item);
  }
  symbolMenu.appendChild(symbolPopup);
  workspaceMenu.appendChild(symbolMenu);
  workspaceMenu.appendChild(xul("menuseparator"));
  const deleteWorkspaceItem = appendAction(
    workspaceMenu,
    "Delete Workspace…",
    () => deleteWorkspace(contextWorkspace),
  );
  workspaceMenu.addEventListener("popupshowing", event => {
    if (event.target !== workspaceMenu) return;
    const index = workspaces.findIndex(item => item.id === contextWorkspace);
    const workspace = workspaces[index];
    moveWorkspaceLeft.setAttribute("disabled", String(index <= 0));
    moveWorkspaceRight.setAttribute("disabled", String(index < 0 || index >= workspaces.length - 1));
    deleteWorkspaceItem.setAttribute("disabled", String(workspaces.length <= 1));
    for (const [accent, item] of accentItems) {
      item.setAttribute("checked", String(workspace?.accent === accent));
    }
    for (const [icon, item] of symbolItems) {
      item.setAttribute("checked", String(workspace?.icon === icon));
    }
  });

  popupSet.append(contextMenu, groupMenu, workspaceMenu);

  on(modeButton, "click", cycleSidebar);
  on(addWorkspaceButton, "click", addWorkspace);
  on(flow, "click", event => {
    if (flow.dataset.state === "focus" && event.target === flow) cycleSidebar();
  });
  on(newTabButton, "click", () => {
    openWorkspaceTab();
  });
  for (const eventName of [
    "TabOpen", "TabClose", "TabSelect", "TabMove", "TabPinned", "TabUnpinned",
    "TabAttrModified", "TabGroupCreate", "TabGroupRemoved", "TabGroupUpdate",
    "TabGroupCollapse", "TabGroupExpand", "TabGrouped", "TabUngrouped",
    "SplitViewCreated", "SplitViewRemoved", "SplitViewTabChange",
    "FluxionTabSleep",
  ]) {
    on(gBrowser.tabContainer, eventName, scheduleRender);
  }
  on(window, "keydown", event => {
    const accelerator = navigator.platform.includes("Mac") ? event.metaKey : event.ctrlKey;
    if (accelerator && event.shiftKey && event.code === "Backslash") {
      event.preventDefault();
      cycleSidebar();
    }
    if (accelerator && event.altKey && (event.code === "BracketRight" || event.code === "BracketLeft")) {
      event.preventDefault();
      cycleWorkspace(event.code === "BracketRight" ? 1 : -1);
    }
  }, true);
  on(window, "unload", () => {
    while (cleanup.length) cleanup.pop()();
    contextMenu.remove();
    groupMenu.remove();
    workspaceMenu.remove();
    style.remove();
    delete window.FluxionUI;
    document.documentElement.removeAttribute("data-fluxion");
  }, { once: true });

  // Assign restored/unowned tabs before filtering, then reveal the saved workspace.
  for (const tab of gBrowser.tabs) tabWorkspace(tab);
  switchWorkspace(currentWorkspace);
  render();
  updateWindowTitle();
  window.FluxionUI = Object.freeze({
    addWorkspace,
    createGroup: () => createGroupForTab(gBrowser.selectedTab),
    createSplitView,
    cycleSidebar,
    currentWorkspace: () => currentWorkspace,
    deleteWorkspace,
    moveTabToWorkspace,
    newTab: openWorkspaceTab,
    openNewSplit,
    renameWorkspace,
    reverseSplitView,
    separateSplitView,
    setSidebarState,
    setTabDensity,
    selectTab(tab) {
      if (!tab || !tab.parentNode) return;
      const workspace = tabWorkspace(tab);
      if (workspace !== currentWorkspace) switchWorkspace(workspace);
      gBrowser.selectedTab = tab;
    },
    switchWorkspace,
    tabWorkspace,
    workspaces: () => workspaces.map(workspace => ({ ...workspace })),
  });
  if (Services.env.get("FLUXION_VISUAL_GROUP_TEST") === "1") {
    const groupTabs = [...gBrowser.tabs]
      .filter(tab => tabWorkspace(tab) === currentWorkspace && !tab.pinned)
      .slice(0, 2);
    if (groupTabs.length < 2) {
      const tab = gBrowser.addTrustedTab("https://example.org/");
      tab.setAttribute(TAB_WORKSPACE, currentWorkspace);
      groupTabs.push(tab);
    }
    const group = gBrowser.addTabGroup(groupTabs, {
      label: "Reference",
      color: "blue",
      insertBefore: groupTabs[0],
    });
    if (!group) throw new Error("Fluxion: native Gecko tab-group integration failed");
    group.collapsed = false;
    Services.prefs.setStringPref("fluxion.groups.health", "native-group-rendered");
    scheduleRender();
  }
  if (Services.env.get("FLUXION_VISUAL_SPLIT_TEST") === "1") {
    const primary = gBrowser.addTrustedTab("https://example.com/?fluxion-split=left");
    const secondary = gBrowser.addTrustedTab("https://example.org/?fluxion-split=right");
    primary.setAttribute(TAB_WORKSPACE, currentWorkspace);
    secondary.setAttribute(TAB_WORKSPACE, currentWorkspace);
    const splitView = createSplitView(primary, secondary);
    if (!splitView || splitView.tabs.length !== 2 || !gBrowser.activeSplitView) {
      throw new Error("Fluxion: native Gecko split-view integration failed");
    }
    Services.prefs.setStringPref("fluxion.splitview.health", "native-split-rendered");
    scheduleRender();
  }
  Services.prefs.setStringPref("fluxion.chrome.health", "flow-sidebar-loaded");
  Services.prefs.savePrefFile(null);
})(window);
