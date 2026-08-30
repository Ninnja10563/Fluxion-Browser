/* global gBrowser, Services, SessionStore, FluxionFlowNavigation, FluxionSplitViews, FluxionTabDrop, FluxionTabGroups, FluxionTabSelection, FluxionTabStatus, FluxionWorkspaces */
(function initialiseFluxion(window) {
  "use strict";

  if (!window.gBrowser || window.document.getElementById("fluxion-flow")) return;

  const { document } = window;
  const { PrivateBrowsingUtils } = ChromeUtils.importESModule(
    "resource://gre/modules/PrivateBrowsingUtils.sys.mjs",
  );
  const privateWindow = PrivateBrowsingUtils.isWindowPrivate(window);
  const XUL = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";
  const HTML = "http://www.w3.org/1999/xhtml";
  const PREF_WORKSPACES = "fluxion.workspaces";
  const PREF_CURRENT = "fluxion.workspace.current";
  const PREF_SIDEBAR = "fluxion.sidebar.state";
  const PREF_SPLIT_ORIENTATIONS = "fluxion.split.orientations";
  const TAB_WORKSPACE = "fluxion-workspace";
  const TAB_SPLIT_ORIENTATION = "fluxion-split-orientation";
  const NEW_TAB_URL = Services.prefs.getStringPref("fluxion.newtab.url", "about:newtab");
  const ABOUT_URL = Services.prefs.getStringPref("fluxion.about.url", "about:support");
  const SIDEBAR_STATES = ["expanded", "compact", "focus"];
  const cleanup = [];
  let contextTab = null;
  let contextGroup = null;
  let contextWorkspace = null;
  let dragTab = null;
  let dragTabs = [];
  let dragTargetElement = null;
  let renderQueued = false;
  let focusTabAfterRender = null;
  let focusWorkspaceAfterRender = null;
  const tabElements = new Map();
  const workspaceElements = new Map();

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
    #PanelUI-button { display: none !important; }
    #fluxion-toolbar-menu {
      -moz-context-properties: fill, stroke; fill: currentColor; stroke: currentColor;
    }
    #fluxion-toolbar-menu > .toolbarbutton-icon {
      list-style-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M5 4.5h13.5l-7.2 6.3H18L6 20l3.5-7H5z' fill='none' stroke='context-stroke' stroke-width='1.55' stroke-linejoin='round'/%3E%3C/svg%3E");
    }
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
    #tabbrowser-tabpanels[splitview][data-fluxion-split-orientation="stacked"] {
      flex-direction: column !important;
    }
    #tabbrowser-tabpanels[splitview][data-fluxion-split-orientation="stacked"] > .split-view-panel {
      --panel-min-height: 120px;
      min-width: 0 !important; max-width: none !important; width: auto !important;
      min-height: var(--panel-min-height) !important;
      max-height: calc(100% - var(--panel-min-height)) !important;
      height: 49.4%;
    }
    #tabbrowser-tabpanels[splitview][data-fluxion-split-orientation="stacked"] > .split-view-panel.split-view-panel-active {
      margin-inline: var(--space-xsmall) !important; width: auto !important;
    }
    #tabbrowser-tabpanels[splitview][data-fluxion-split-orientation="stacked"] > .split-view-panel[column="0"] {
      margin-block-end: 0 !important;
    }
    #tabbrowser-tabpanels[splitview][data-fluxion-split-orientation="stacked"] > .split-view-panel[column="1"] {
      margin-block-start: 0 !important;
    }
    #tabbrowser-tabpanels[splitview][data-fluxion-split-orientation="stacked"] > .split-view-panel[height] {
      flex: none;
    }
    #tabbrowser-tabpanels[splitview][data-fluxion-split-orientation="stacked"] > .split-view-splitter {
      width: auto !important; height: 3px !important;
      margin: 2px var(--space-xsmall) !important;
      cursor: row-resize;
    }
    #tabbrowser-tabpanels[splitview][data-fluxion-split-orientation="stacked"]:has(.split-view-panel[column="0"].deck-selected) > .split-view-splitter {
      margin-block-start: 3px !important;
    }
    #tabbrowser-tabpanels[splitview][data-fluxion-split-orientation="stacked"]:has(.split-view-panel[column="1"].deck-selected) > .split-view-splitter {
      margin-block-end: 3px !important;
    }
    #fluxion-flow {
      width: 232px; min-width: 232px; max-width: 232px;
      position: relative; z-index: 4; color: var(--fluxion-ink); background: transparent;
      font: menu; font-size: 12px; overflow: visible;
      transition: width var(--fluxion-fast), min-width var(--fluxion-fast), max-width var(--fluxion-fast);
    }
    .fluxion-surface {
      width: 100%; min-width: 0; height: 100%; display: flex; flex-direction: column;
      overflow: hidden; background: var(--fluxion-bg);
      border-inline-end: 1px solid var(--fluxion-line);
      transform: translateX(0); transform-origin: left center;
      transition: transform var(--fluxion-fast), box-shadow var(--fluxion-fast);
    }
    #fluxion-flow[data-state="compact"] { width: 44px; min-width: 44px; max-width: 44px; }
    #fluxion-flow[data-state="focus"] {
      width: 3px; min-width: 3px; max-width: 3px; cursor: pointer;
      background: var(--fluxion-line);
    }
    #fluxion-flow[data-state="focus"]:hover,
    #fluxion-flow[data-state="focus"]:focus-visible { background: var(--fluxion-accent); }
    #fluxion-flow[data-state="focus"]:focus-visible {
      outline: 2px solid var(--fluxion-accent); outline-offset: -2px;
    }
    #fluxion-flow[data-state="focus"] > .fluxion-surface {
      position: absolute; inset-block: 0; inset-inline-start: 0; width: 232px;
      pointer-events: none; transform: translateX(calc(-100% + 3px)); box-shadow: none;
    }
    #fluxion-flow[data-state="focus"][data-revealed="true"] > .fluxion-surface {
      pointer-events: auto; transform: translateX(0);
      box-shadow: 8px 0 22px rgba(0, 0, 0, .16);
    }
    :root[chromedir="rtl"] #fluxion-flow[data-state="focus"] > .fluxion-surface {
      transform: translateX(calc(100% - 3px)); transform-origin: right center;
    }
    :root[chromedir="rtl"] #fluxion-flow[data-state="focus"][data-revealed="true"] > .fluxion-surface {
      transform: translateX(0); box-shadow: -8px 0 22px rgba(0, 0, 0, .16);
    }
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
    .fluxion-icon-button:focus-visible, .fluxion-tab:focus-visible, .fluxion-workspace:focus-visible,
    .fluxion-add-workspace:focus-visible, .fluxion-group-heading:focus-visible,
    .fluxion-new-tab:focus-visible {
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
    .fluxion-workspace[aria-selected="true"] {
      color: var(--fluxion-ink); background: transparent; font-weight: 600;
    }
    .fluxion-workspace[aria-selected="true"]::after {
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
    :root[data-fluxion-no-motion] .fluxion-surface,
    :root[data-fluxion-no-motion] .fluxion-tab,
    :root[data-fluxion-no-motion] .fluxion-group-disclosure { transition: none !important; }
    :root[data-fluxion-no-motion] .fluxion-status[data-kind="loading"]::before {
      animation: none !important;
    }
    .fluxion-tab:hover { background: var(--fluxion-hover); color: var(--fluxion-ink); }
    .fluxion-tab[aria-selected="true"] { color: var(--fluxion-ink); background: var(--fluxion-selected); }
    .fluxion-tab.is-multiselected:not([data-active="true"]) {
      color: var(--fluxion-ink); background: var(--fluxion-hover);
      box-shadow: inset 0 0 0 1px var(--fluxion-line);
    }
    .fluxion-tab[aria-selected="true"]::before {
      content: ""; position: absolute; inset-inline-start: 0; width: 2px; height: 14px;
      background: var(--fluxion-accent);
    }
    .fluxion-tab.is-closing { opacity: 0; transform: scaleY(.72); pointer-events: none; }
    .fluxion-tab.is-sleeping { color: color-mix(in srgb, var(--fluxion-muted) 82%, transparent); }
    .fluxion-tab[data-drop-intent="reorder-before"]::after,
    .fluxion-tab[data-drop-intent="reorder-after"]::after {
      content: ""; position: absolute; inset-inline: 4px; height: 2px;
      z-index: 3; background: var(--fluxion-accent); pointer-events: none;
    }
    .fluxion-tab[data-drop-intent="reorder-before"]::after { inset-block-start: -2px; }
    .fluxion-tab[data-drop-intent="reorder-after"]::after { inset-block-end: -2px; }
    .fluxion-tab[data-drop-action="split"] {
      color: var(--fluxion-ink); box-shadow: inset 0 0 0 1px var(--fluxion-accent);
    }
    .fluxion-tab[data-drop-action="split"]::after {
      content: attr(data-drop-label); position: absolute; inset: 3px 5px; z-index: 3;
      display: flex; align-items: center; justify-content: center;
      border: 1px solid color-mix(in srgb, var(--fluxion-accent) 72%, transparent);
      border-radius: 2px; color: var(--fluxion-ink); background: var(--fluxion-bg-raised);
      font-size: 9px; font-weight: 650; letter-spacing: .045em; text-transform: uppercase;
      pointer-events: none;
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
    .fluxion-peek-badge {
      flex: none; color: var(--fluxion-muted); font-size: 9px; font-weight: 650;
      letter-spacing: .06em; text-transform: uppercase;
    }
    .fluxion-status-strip {
      min-width: 0; flex: none; display: flex; align-items: center; gap: 3px;
      color: var(--fluxion-muted);
    }
    .fluxion-status {
      width: 13px; height: 13px; flex: none; display: grid; place-items: center;
      color: inherit;
    }
    .fluxion-status svg, .fluxion-control-glyph {
      width: 13px; height: 13px; display: block; overflow: visible;
      fill: none; stroke: currentColor; stroke-width: 1.35;
      stroke-linecap: round; stroke-linejoin: round;
    }
    .fluxion-status[data-tone="active"] { color: var(--fluxion-accent); }
    .fluxion-status[data-tone="warning"] { color: light-dark(#8b5148, #d49386); }
    .fluxion-status[data-tone="critical"] { color: light-dark(#9b403d, #e17f79); }
    .fluxion-status[data-kind="loading"]::before {
      content: ""; width: 8px; height: 8px; border: 1.3px solid currentColor;
      border-block-start-color: transparent; border-radius: 50%;
      animation: fluxion-status-spin 720ms linear infinite;
    }
    .fluxion-status[data-kind="attention"]::before {
      content: ""; width: 5px; height: 5px; border-radius: 50%; background: currentColor;
    }
    @keyframes fluxion-status-spin { to { transform: rotate(1turn); } }
    .fluxion-close, .fluxion-audio { width: 22px; height: 22px; flex: none; opacity: 0; }
    .fluxion-audio .fluxion-control-glyph { width: 14px; height: 14px; }
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
    .fluxion-visually-hidden {
      position: fixed !important; width: 1px !important; height: 1px !important;
      padding: 0 !important; margin: -1px !important; overflow: hidden !important;
      clip-path: inset(50%) !important; white-space: nowrap !important; border: 0 !important;
    }
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
    .fluxion-pinned-tabs .fluxion-status-strip,
    #fluxion-flow[data-state="compact"] .fluxion-status-strip {
      position: absolute; inset-inline-start: 2px; inset-block-end: 2px;
      padding: 1px; gap: 0; border-radius: 2px; background: var(--fluxion-bg);
    }
    .fluxion-pinned-tabs .fluxion-status:not(:first-child),
    #fluxion-flow[data-state="compact"] .fluxion-status:not(:first-child) { display: none; }
    .fluxion-pinned-tabs .fluxion-audio,
    #fluxion-flow[data-state="compact"] .fluxion-audio {
      position: absolute; inset-inline-end: 1px; inset-block-end: 1px;
      width: 15px; height: 15px; border-radius: 2px; background: var(--fluxion-bg);
    }
    .fluxion-pinned-tabs .fluxion-audio .fluxion-control-glyph,
    #fluxion-flow[data-state="compact"] .fluxion-audio .fluxion-control-glyph { width: 12px; height: 12px; }
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
    #fluxion-flow[data-state="compact"] .fluxion-tab[data-drop-action="split"]::after {
      content: ""; inset: 4px;
    }
    #fluxion-flow[data-state="compact"] .fluxion-group-heading { justify-content: center; padding: 0; }
    #fluxion-flow[data-state="compact"] .fluxion-group-disclosure { display: none; }
    #fluxion-flow[data-state="compact"] .fluxion-group-tabs { margin-inline-start: 3px; padding-inline-start: 0; }
    #fluxion-flow[data-state="compact"] .fluxion-footer { padding-inline: 7px; }
    #fluxion-flow[data-state="compact"] .fluxion-new-tab { flex: none; width: 30px; text-align: center; }
    @media (prefers-reduced-motion: reduce) {
      #fluxion-flow, .fluxion-surface, .fluxion-tab { transition-duration: 0.01ms !important; }
      .fluxion-status[data-kind="loading"]::before { animation: none !important; }
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
  let splitOrientations = FluxionSplitViews.parseOrientationMap(
    privateWindow ? "" : Services.prefs.getStringPref(PREF_SPLIT_ORIENTATIONS, ""),
  );
  let currentWorkspace = Services.prefs.getStringPref(PREF_CURRENT, workspaces[0].id);
  if (!workspaces.some(item => item.id === currentWorkspace)) currentWorkspace = workspaces[0].id;

  for (const attribute of [TAB_WORKSPACE, TAB_SPLIT_ORIENTATION]) {
    try {
      SessionStore.persistTabAttribute(attribute);
    } catch (_) {
      // Older compatible Firefox builds may already persist the attribute.
    }
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

  const nativeMenuBar = document.getElementById("main-menubar");
  const nativeFlowMenu = xul("menu", { id: "fluxion-native-menu", label: "Flow" });
  const nativeFlowPopup = xul("menupopup", { id: "fluxion-native-menu-popup" });
  nativeFlowMenu.appendChild(nativeFlowPopup);
  const nativeAction = (label, action, attributes = {}, tracked = true) => {
    const item = xul("menuitem", { label, ...attributes });
    if (tracked) on(item, "command", action);
    else item.addEventListener("command", action, { once: true });
    return item;
  };
  const nativeSeparator = () => xul("menuseparator");

  nativeFlowPopup.append(
    nativeAction("Command Palette…", () => window.FluxionPalette?.open("all"), {
      id: "fluxion-native-command-palette",
      acceltext: window.FluxionShortcuts?.format("palette") || "",
    }),
    nativeAction("Search Tabs…", () => window.FluxionPalette?.open("tabs"), {
      id: "fluxion-native-tab-search",
      acceltext: window.FluxionShortcuts?.format("tabSearch") || "",
    }),
    nativeSeparator(),
  );

  const nativeSidebarMenu = xul("menu", { label: "Sidebar" });
  const nativeSidebarPopup = xul("menupopup", { id: "fluxion-native-sidebar-popup" });
  const nativeSidebarItems = new Map();
  for (const [state, label] of [
    ["expanded", "Expanded"], ["compact", "Compact"], ["focus", "Focus"],
  ]) {
    const item = nativeAction(label, () => setSidebarState(state), {
      type: "radio", name: "fluxion-native-sidebar-state",
    });
    nativeSidebarItems.set(state, item);
    nativeSidebarPopup.appendChild(item);
  }
  on(nativeSidebarPopup, "popupshowing", event => {
    if (event.target !== nativeSidebarPopup) return;
    for (const [state, item] of nativeSidebarItems) {
      item.setAttribute("checked", String(flow.dataset.state === state));
    }
  });
  nativeSidebarMenu.appendChild(nativeSidebarPopup);

  const nativeWorkspaceMenu = xul("menu", { label: "Workspaces" });
  const nativeWorkspacePopup = xul("menupopup", { id: "fluxion-native-workspace-popup" });
  on(nativeWorkspacePopup, "popupshowing", event => {
    if (event.target !== nativeWorkspacePopup) return;
    nativeWorkspacePopup.replaceChildren();
    for (const workspace of workspaces) {
      nativeWorkspacePopup.appendChild(nativeAction(
        workspace.name,
        () => switchWorkspace(workspace.id),
        {
          type: "radio", name: "fluxion-native-workspace",
          checked: String(workspace.id === currentWorkspace),
        }, false,
      ));
    }
    nativeWorkspacePopup.append(
      nativeSeparator(),
      nativeAction("New Workspace…", addWorkspace, {}, false),
    );
  });
  nativeWorkspaceMenu.appendChild(nativeWorkspacePopup);

  const nativeLibraryMenu = xul("menu", { label: "Library" });
  const nativeLibraryPopup = xul("menupopup");
  nativeLibraryPopup.append(
    nativeAction("History", () => window.FluxionLibrary?.open("history")),
    nativeAction("Bookmarks", () => window.FluxionLibrary?.open("bookmarks")),
    nativeAction("Downloads", () => window.FluxionLibrary?.open("downloads")),
  );
  nativeLibraryMenu.appendChild(nativeLibraryPopup);
  nativeFlowPopup.append(
    nativeSidebarMenu,
    nativeWorkspaceMenu,
    nativeSeparator(),
    nativeLibraryMenu,
    nativeAction("New Workspace…", addWorkspace),
  );

  if (nativeMenuBar) {
    nativeMenuBar.insertBefore(nativeFlowMenu, document.getElementById("history-menu"));
    cleanup.push(() => nativeFlowMenu.remove());
    Services.prefs.setStringPref("fluxion.nativeMenu.health", "flow-application-menu-loaded");
    Services.prefs.savePrefFile(null);
  }

  function openProductTab(url) {
    const tab = gBrowser.addTrustedTab(url);
    tab.setAttribute(TAB_WORKSPACE, currentWorkspace);
    gBrowser.selectedTab = tab;
    return tab;
  }

  const toolbarTarget = document.getElementById("nav-bar-customization-target");
  const toolbarMenuButton = xul("toolbarbutton", {
    id: "fluxion-toolbar-menu",
    class: "toolbarbutton-1 chromeclass-toolbar-additional",
    type: "menu",
    label: "Fluxion menu",
    tooltiptext: "Fluxion menu",
    removable: "false",
  });
  toolbarMenuButton.setAttribute("aria-label", "Fluxion menu");
  const toolbarMenuPopup = xul("menupopup", { id: "fluxion-toolbar-menu-popup" });
  const toolbarAccel = (mac, other) => Services.appinfo.OS === "Darwin" ? mac : other;
  const toolbarNewTabItem = nativeAction("New Tab", openWorkspaceTab, {
    id: "fluxion-toolbar-new-tab", acceltext: toolbarAccel("⌘T", "Ctrl+T"),
  });
  const toolbarLibraryMenu = xul("menu", { label: "Library" });
  const toolbarLibraryPopup = xul("menupopup", { id: "fluxion-toolbar-library-popup" });
  toolbarLibraryPopup.append(
    nativeAction("History", () => window.FluxionLibrary?.open("history")),
    nativeAction("Bookmarks", () => window.FluxionLibrary?.open("bookmarks")),
    nativeAction("Downloads", () => window.FluxionLibrary?.open("downloads")),
  );
  toolbarLibraryMenu.appendChild(toolbarLibraryPopup);
  toolbarMenuPopup.append(
    toolbarNewTabItem,
    nativeAction("New Window", () => window.OpenBrowserWindow(), {
      acceltext: toolbarAccel("⌘N", "Ctrl+N"),
    }),
    nativeAction("New Private Window", () => window.OpenBrowserWindow({ private: true }), {
      acceltext: toolbarAccel("⇧⌘P", "Ctrl+Shift+P"),
    }),
    nativeSeparator(),
    nativeAction("Command Palette…", () => window.FluxionPalette?.open("all"), {
      acceltext: window.FluxionShortcuts?.format("palette") || "",
    }),
    nativeAction("Search Tabs…", () => window.FluxionPalette?.open("tabs"), {
      acceltext: window.FluxionShortcuts?.format("tabSearch") || "",
    }),
    nativeSeparator(),
    toolbarLibraryMenu,
    nativeAction("Fluxion Settings…", () => openProductTab("about:preferences"), {
      acceltext: toolbarAccel("⌘,", "Ctrl+,"),
    }),
    nativeAction("About Fluxion", () => openProductTab(ABOUT_URL)),
  );
  toolbarMenuButton.appendChild(toolbarMenuPopup);
  if (toolbarTarget) {
    toolbarTarget.appendChild(toolbarMenuButton);
    cleanup.push(() => toolbarMenuButton.remove());
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
  const updateModeButtonTitle = () => {
    modeButton.title = `Cycle sidebar (${window.FluxionShortcuts?.format("sidebar") || "shortcut"})`;
  };
  updateModeButtonTitle();
  modeButton.setAttribute("aria-label", "Cycle sidebar size");
  modeButton.textContent = flow.dataset.state === "expanded" ? "‹" :
    flow.dataset.state === "compact" ? "·" : "›";
  header.append(mark, name, modeButton);

  const workspaceBar = create("div", "fluxion-workspaces");
  const workspaceList = create("div", "fluxion-workspace-list");
  workspaceList.setAttribute("role", "tablist");
  workspaceList.setAttribute("aria-label", "Workspaces");
  workspaceList.setAttribute("aria-orientation", "horizontal");
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
  pinnedTabs.setAttribute("role", "tablist");
  pinnedTabs.setAttribute("aria-label", "Pinned tabs");
  pinnedTabs.setAttribute("aria-orientation", "horizontal");
  const openLabel = create("div", "fluxion-section-label");
  openLabel.textContent = "Flow";
  const tabsList = create("div", "fluxion-tabs");
  tabsList.setAttribute("role", "tablist");
  tabsList.setAttribute("aria-label", "Open tabs in current workspace");
  tabsList.setAttribute("aria-orientation", "vertical");

  const footer = create("div", "fluxion-footer");
  const newTabButton = create("button", "fluxion-new-tab");
  newTabButton.type = "button";
  newTabButton.innerHTML = `<b aria-hidden="true">+</b> <span>New tab</span>`;
  newTabButton.setAttribute("aria-label", "New tab");
  const count = create("span", "fluxion-count");
  const dragAnnouncement = create("span", "fluxion-visually-hidden");
  dragAnnouncement.setAttribute("role", "status");
  dragAnnouncement.setAttribute("aria-live", "polite");
  dragAnnouncement.setAttribute("aria-atomic", "true");
  footer.append(newTabButton, count);
  const surface = create("div", "fluxion-surface");
  surface.append(
    header, workspaceBar, pinnedLabel, pinnedTabs, openLabel, tabsList, footer, dragAnnouncement,
  );
  flow.append(surface);
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
    if (tab.linkedBrowser?.currentURI?.spec === ABOUT_URL) return "About Fluxion";
    const librarySection = tab.getAttribute("fluxion-library-section");
    if (librarySection) {
      const labels = {
        history: "History", bookmarks: "Bookmarks", folders: "Folders", downloads: "Downloads",
      };
      return `Library · ${labels[librarySection] || "History"}`;
    }
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
    return createGroupForTabs(tab ? [tab] : []);
  }

  function createNamedGroup(tabs, requestedName) {
    const candidates = [...new Set(tabs)].filter(tab => tab?.parentNode && !tab.pinned && !tab.splitview);
    if (!candidates.length) return null;
    const name = FluxionTabGroups.normaliseGroupName(requestedName);
    if (!name) {
      Services.prompt.alert(window, "Group Not Created", "Enter a group name.");
      return null;
    }
    const group = gBrowser.addTabGroup(candidates, { label: name, insertBefore: candidates[0] });
    gBrowser.clearMultiSelectedTabs();
    scheduleRender();
    return group;
  }

  function createGroupForTabs(tabs) {
    const name = askGroupName("New Tab Group");
    return name === null ? null : createNamedGroup(tabs, name);
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
    moveTabsToWorkspace(tab ? [tab] : [], id);
  }

  function moveTabsToWorkspace(tabs, id) {
    if (!tabs.length || !workspaces.some(item => item.id === id)) return;
    const movingTabs = [...new Set(tabs.flatMap(tab => tab?.splitview?.tabs || [tab]).filter(Boolean))];
    for (const movingTab of movingTabs) movingTab.setAttribute(TAB_WORKSPACE, id);
    gBrowser.clearMultiSelectedTabs();
    if (id !== currentWorkspace && movingTabs.includes(gBrowser.selectedTab)) {
      const replacement = [...gBrowser.tabs].find(
        candidate => !movingTabs.includes(candidate) && tabWorkspace(candidate) === currentWorkspace,
      );
      if (replacement) gBrowser.selectedTab = replacement;
      else switchWorkspace(currentWorkspace);
    }
    switchWorkspace(currentWorkspace);
  }

  function contextTabs(tab = contextTab) {
    return FluxionTabSelection.contextTabs(tab, gBrowser.selectedTabs);
  }

  function splitOrientation(tab = gBrowser.selectedTab) {
    const splitView = tab?.splitview;
    const persisted = !privateWindow && splitView
      ? splitOrientations[String(splitView.splitViewId)]
      : "";
    return persisted || FluxionSplitViews.orientationOf(splitView);
  }

  function rememberSplitOrientation(splitView, orientation) {
    if (privateWindow || !splitView) return;
    splitOrientations = FluxionSplitViews.rememberOrientation(
      splitOrientations, splitView.splitViewId, orientation,
    );
    Services.prefs.setStringPref(PREF_SPLIT_ORIENTATIONS, JSON.stringify(splitOrientations));
    Services.prefs.savePrefFile(null);
  }

  function forgetSplitOrientation(splitViewId) {
    if (privateWindow) return;
    splitOrientations = FluxionSplitViews.forgetOrientation(splitOrientations, splitViewId);
    Services.prefs.setStringPref(PREF_SPLIT_ORIENTATIONS, JSON.stringify(splitOrientations));
    Services.prefs.savePrefFile(null);
  }

  function resetSplitPanelSizing(splitView) {
    for (const panel of splitView?.panels || []) {
      panel.removeAttribute("width");
      panel.removeAttribute("height");
      panel.style.removeProperty("width");
      panel.style.removeProperty("height");
    }
  }

  function updateSplitAccessibility(splitView = gBrowser.activeSplitView) {
    if (!splitView || splitView !== gBrowser.activeSplitView) return;
    const tabpanels = gBrowser.tabpanels;
    const splitter = tabpanels?.querySelector(":scope > .split-view-splitter");
    const controlled = splitView.panels?.[0];
    if (!splitter || !controlled) return;
    const orientation = splitOrientation(splitView.tabs[0]);
    const stacked = orientation === FluxionSplitViews.STACKED;
    const containerSize = stacked ? tabpanels.clientHeight : tabpanels.clientWidth;
    const currentSize = stacked ? controlled.clientHeight : controlled.clientWidth;
    const minimum = parseFloat(window.getComputedStyle(controlled)[stacked ? "minHeight" : "minWidth"]) || 0;
    splitter.setAttribute("aria-orientation", stacked ? "horizontal" : "vertical");
    splitter.setAttribute("aria-valuemin", String(Math.round(minimum)));
    splitter.setAttribute("aria-valuemax", String(Math.max(Math.round(minimum), Math.round(containerSize - minimum))));
    splitter.setAttribute("aria-valuenow", String(Math.round(currentSize)));
  }

  function applyActiveSplitOrientation({ reset = false } = {}) {
    const tabpanels = gBrowser.tabpanels;
    const splitView = gBrowser.activeSplitView;
    if (!tabpanels) return;
    if (!splitView) {
      tabpanels.removeAttribute("data-fluxion-split-orientation");
      tabpanels.removeAttribute("orient");
      return;
    }
    const orientation = splitOrientation(splitView.tabs[0]);
    const changed = tabpanels.getAttribute("data-fluxion-split-orientation") !== orientation;
    if (reset || changed) resetSplitPanelSizing(splitView);
    tabpanels.setAttribute("data-fluxion-split-orientation", orientation);
    tabpanels.setAttribute("orient", orientation === FluxionSplitViews.STACKED ? "vertical" : "horizontal");
    window.requestAnimationFrame(() => updateSplitAccessibility(splitView));
  }

  function setSplitOrientation(tab = gBrowser.selectedTab, value = FluxionSplitViews.SIDE_BY_SIDE) {
    const splitView = tab?.splitview;
    if (!splitView || splitView.tabs.length !== 2) return false;
    const orientation = FluxionSplitViews.normaliseOrientation(value);
    for (const member of splitView.tabs) member.setAttribute(TAB_SPLIT_ORIENTATION, orientation);
    rememberSplitOrientation(splitView, orientation);
    applyActiveSplitOrientation({ reset: true });
    scheduleRender();
    return true;
  }

  function toggleSplitOrientation(tab = gBrowser.selectedTab) {
    const next = splitOrientation(tab) === FluxionSplitViews.STACKED
      ? FluxionSplitViews.SIDE_BY_SIDE
      : FluxionSplitViews.STACKED;
    return setSplitOrientation(tab, next);
  }

  function createSplitView(primary, secondary, options = {}) {
    if (!FluxionSplitViews.canSplit(primary, secondary)) return null;
    const orientation = FluxionSplitViews.normaliseOrientation(options.orientation);
    const workspace = tabWorkspace(primary);
    secondary.setAttribute(TAB_WORKSPACE, workspace);
    primary.setAttribute(TAB_SPLIT_ORIENTATION, orientation);
    secondary.setAttribute(TAB_SPLIT_ORIENTATION, orientation);
    const insertionPoint = primary.group || primary;
    const splitView = gBrowser.addTabSplitView([primary, secondary], {
      insertBefore: insertionPoint,
      trigger: "menu_open",
    });
    if (!splitView || splitView.tabs.length !== 2) {
      primary.removeAttribute(TAB_SPLIT_ORIENTATION);
      secondary.removeAttribute(TAB_SPLIT_ORIENTATION);
      return null;
    }
    rememberSplitOrientation(splitView, orientation);
    gBrowser.selectedTab = options.selectSecondary ? secondary : primary;
    applyActiveSplitOrientation({ reset: true });
    scheduleRender();
    return splitView;
  }

  function openNewSplit(primary = gBrowser.selectedTab, orientation = FluxionSplitViews.SIDE_BY_SIDE) {
    if (!primary || primary.pinned || primary.splitview) return null;
    const tab = gBrowser.addTrustedTab(NEW_TAB_URL);
    tab.setAttribute(TAB_WORKSPACE, tabWorkspace(primary));
    const splitView = createSplitView(primary, tab, { selectSecondary: true, orientation });
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
    const members = [...splitView.tabs];
    const splitViewId = splitView.splitViewId;
    splitView.unsplitTabs("menu_separate");
    for (const member of members) member.removeAttribute(TAB_SPLIT_ORIENTATION);
    forgetSplitOrientation(splitViewId);
    applyActiveSplitOrientation();
    scheduleRender();
  }

  function reverseSplitView(tab = gBrowser.selectedTab) {
    const splitView = tab?.splitview;
    if (!splitView || splitView.tabs.length !== 2) return;
    splitView.reverseTabs("menu");
    scheduleRender();
  }

  let focusHideTimer = 0;
  let focusPointerInside = false;

  function clearFocusHideTimer() {
    if (!focusHideTimer) return;
    window.clearTimeout(focusHideTimer);
    focusHideTimer = 0;
  }

  function syncSidebarAccessibility(revealed = flow.dataset.revealed === "true") {
    const focused = flow.dataset.state === "focus";
    const surfaceVisible = !focused || revealed;
    surface.inert = !surfaceVisible;
    if (focused) {
      flow.tabIndex = 0;
      flow.setAttribute("aria-label", surfaceVisible ? "Flow sidebar, expanded over page" : "Reveal Flow sidebar");
      flow.setAttribute("aria-expanded", String(surfaceVisible));
    } else {
      flow.tabIndex = -1;
      flow.setAttribute("aria-label", "Fluxion Flow");
      flow.removeAttribute("aria-expanded");
    }
  }

  function revealFocusSurface({ focusActive = false } = {}) {
    if (flow.dataset.state !== "focus") return false;
    clearFocusHideTimer();
    flow.dataset.revealed = "true";
    syncSidebarAccessibility(true);
    if (focusActive) {
      window.requestAnimationFrame(() => {
        const active = tabElements.get(gBrowser.selectedTab) || renderedTabElements()[0] || modeButton;
        active?.focus();
      });
    }
    return true;
  }

  function hideFocusSurface({ force = false } = {}) {
    if (flow.dataset.state !== "focus") return false;
    clearFocusHideTimer();
    if (!force && (focusPointerInside || surface.contains(document.activeElement))) return false;
    if (force && surface.contains(document.activeElement)) flow.focus();
    flow.dataset.revealed = "false";
    syncSidebarAccessibility(false);
    return true;
  }

  function scheduleFocusSurfaceHide() {
    clearFocusHideTimer();
    focusHideTimer = window.setTimeout(() => {
      focusHideTimer = 0;
      hideFocusSurface();
    }, 160);
  }

  function setSidebarState(value) {
    const state = SIDEBAR_STATES.includes(value) ? value : "expanded";
    flow.dataset.state = state;
    clearFocusHideTimer();
    focusPointerInside = false;
    flow.dataset.revealed = "false";
    syncSidebarAccessibility(false);
    Services.prefs.setStringPref(PREF_SIDEBAR, state);
    Services.prefs.savePrefFile(null);
    modeButton.textContent = state === "expanded" ? "‹" : state === "compact" ? "·" : "›";
    scheduleRender();
  }

  function cycleSidebar() {
    const index = SIDEBAR_STATES.indexOf(flow.dataset.state);
    setSidebarState(SIDEBAR_STATES[(index + 1) % SIDEBAR_STATES.length]);
  }

  syncSidebarAccessibility(false);

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

  function renderedTabElements() {
    return [...flow.querySelectorAll(".fluxion-tab")]
      .filter(element => !element.closest(".fluxion-group.is-collapsed"));
  }

  function clearTabDropFeedback() {
    if (dragTargetElement) {
      dragTargetElement.removeAttribute("data-drop-intent");
      dragTargetElement.removeAttribute("data-drop-action");
      dragTargetElement.removeAttribute("data-drop-label");
    }
    dragTargetElement = null;
    dragAnnouncement.textContent = "";
  }

  function resetTabDrag() {
    clearTabDropFeedback();
    dragTab = null;
    dragTabs = [];
  }

  function tabDropIntent(event, element, target) {
    const canSplit = dragTabs.length === 1 &&
      !dragTabs.includes(target) &&
      tabWorkspace(dragTabs[0]) === tabWorkspace(target) &&
      FluxionSplitViews.canSplit(dragTabs[0], target);
    return FluxionTabDrop.classify({
      canSplit,
      clientX: event.clientX,
      clientY: event.clientY,
      rect: element.getBoundingClientRect(),
      rtl: window.getComputedStyle(element).direction === "rtl",
      stacked: event.shiftKey,
    });
  }

  function showTabDropFeedback(element, intent, target) {
    clearTabDropFeedback();
    if (!element || intent.action === "none") return;
    dragTargetElement = element;
    element.dataset.dropIntent = `${intent.action}-${intent.position}`;
    element.dataset.dropAction = intent.action;
    element.dataset.dropLabel = FluxionTabDrop.shortLabel(intent);
    dragAnnouncement.textContent = FluxionTabDrop.announcement(
      intent,
      tabLabel(dragTab),
      tabLabel(target),
    );
  }

  function reorderTabsAt(movingTabs, target, position) {
    const moving = movingTabs
      .filter(candidate => candidate?.parentNode && candidate !== target)
      .sort((left, right) => left._tPos - right._tPos);
    if (!moving.length || !target?.parentNode) return false;
    if (position === "after" && typeof gBrowser.moveTabsAfter === "function") {
      gBrowser.moveTabsAfter(moving, target);
    } else if (position !== "after" && typeof gBrowser.moveTabsBefore === "function") {
      gBrowser.moveTabsBefore(moving, target);
    } else if (position === "after") {
      for (const candidate of [...moving].reverse()) {
        gBrowser.moveTabTo(candidate, target._tPos + 1);
      }
    } else {
      for (const candidate of moving) gBrowser.moveTabTo(candidate, target._tPos);
    }
    scheduleRender();
    return true;
  }

  function applyTabDrop(movingTabs, target, intent) {
    if (!intent || intent.action === "none" || movingTabs.includes(target)) return null;
    if (intent.action === "split") {
      if (
        movingTabs.length !== 1 ||
        tabWorkspace(movingTabs[0]) !== tabWorkspace(target) ||
        !FluxionSplitViews.canSplit(movingTabs[0], target)
      ) return null;
      const dragged = movingTabs[0];
      const before = intent.position !== "after";
      const primary = before ? dragged : target;
      const secondary = before ? target : dragged;
      const splitView = createSplitView(primary, secondary, {
        orientation: intent.orientation,
        selectSecondary: dragged === secondary,
      });
      return splitView ? { action: "split", splitView } : null;
    }
    return reorderTabsAt(movingTabs, target, intent.position)
      ? { action: "reorder", position: intent.position }
      : null;
  }

  function closeWithStability(tab, element) {
    if (!tab || tab.closing) return;
    const tabs = contextTabs(tab);
    if (element.matches(":focus-within")) {
      const rendered = renderedTabElements();
      const index = rendered.indexOf(element);
      const closing = new Set(tabs);
      const replacement = [
        ...rendered.slice(index + 1),
        ...rendered.slice(0, index).reverse(),
      ].find(candidate => !closing.has(candidate._fluxionTab));
      focusTabAfterRender = replacement?._fluxionTab || null;
    }
    element.classList.add("is-closing");
    window.setTimeout(() => {
      closeTabs(tabs, { animate: false });
    }, window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 120);
  }

  function closeTabs(tabs, options = {}) {
    const ordinary = tabs.filter(tab =>
      tab?.parentNode && !window.FluxionPeek?.close(tab, { returnToSource: false })
    );
    if (ordinary.length === 1) gBrowser.removeTab(ordinary[0], options);
    else if (ordinary.length > 1) gBrowser.removeTabs(ordinary, options);
  }

  function vectorGlyph(className, shapes, viewBox = "0 0 16 16") {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", className);
    svg.setAttribute("viewBox", viewBox);
    svg.setAttribute("aria-hidden", "true");
    for (const [tag, attributes] of shapes) {
      const shape = document.createElementNS("http://www.w3.org/2000/svg", tag);
      for (const [name, value] of Object.entries(attributes)) shape.setAttribute(name, value);
      svg.appendChild(shape);
    }
    return svg;
  }

  function statusGlyph(indicator) {
    const icon = create("span", "fluxion-status");
    icon.dataset.kind = indicator.kind;
    icon.dataset.tone = indicator.tone;
    icon.title = indicator.label;
    icon.setAttribute("aria-hidden", "true");
    let shapes = null;
    if (indicator.kind === "picture-in-picture") {
      shapes = [
        ["rect", { x: "1.5", y: "2.25", width: "13", height: "10.5", rx: "1.3" }],
        ["rect", { x: "7.4", y: "7", width: "5", height: "3.6", rx: ".55" }],
      ];
    } else if (indicator.kind === "sharing-screen") {
      shapes = [
        ["rect", { x: "1.5", y: "2.25", width: "13", height: "9", rx: "1.25" }],
        ["path", { d: "M5.5 14h5M8 11.5V14" }],
        ["circle", { cx: "11.5", cy: "5.2", r: "1.2", fill: "currentColor", stroke: "none" }],
      ];
    } else if (indicator.kind.includes("camera")) {
      shapes = [
        ["rect", { x: "1.5", y: "4.1", width: "9.2", height: "7.8", rx: "1.4" }],
        ["path", { d: "m10.7 6.3 3.8-1.7v6.8l-3.8-1.7Z" }],
      ];
    } else if (indicator.kind === "sharing-microphone") {
      shapes = [
        ["rect", { x: "5.4", y: "1.5", width: "5.2", height: "8.5", rx: "2.6" }],
        ["path", { d: "M3.6 7.8a4.4 4.4 0 0 0 8.8 0M8 12.2v2.3M5.7 14.5h4.6" }],
      ];
    } else if (indicator.kind === "sharing-media") {
      shapes = [
        ["circle", { cx: "8", cy: "8", r: "1.3", fill: "currentColor", stroke: "none" }],
        ["path", { d: "M4.8 4.8a4.5 4.5 0 0 0 0 6.4M11.2 4.8a4.5 4.5 0 0 1 0 6.4M2.5 2.8a7.3 7.3 0 0 0 0 10.4M13.5 2.8a7.3 7.3 0 0 1 0 10.4" }],
      ];
    } else if (indicator.kind === "crashed") {
      shapes = [
        ["path", { d: "M8 1.5 15 14H1Z" }],
        ["path", { d: "M8 5.2v4.3M8 12h.01" }],
      ];
    } else if (indicator.kind === "sleeping") {
      shapes = [["path", { d: "M11.9 11.7A5.9 5.9 0 0 1 4.3 4.1 6.1 6.1 0 1 0 11.9 11.7Z" }]];
    }
    if (shapes) icon.appendChild(vectorGlyph("fluxion-status-glyph", shapes));
    return icon;
  }

  function controlGlyph(kind) {
    if (kind === "close") {
      return vectorGlyph("fluxion-control-glyph", [["path", { d: "m4.5 4.5 7 7m0-7-7 7" }]]);
    }
    const shapes = [["path", { d: "M2 6h3l3-2.8v9.6L5 10H2Z" }]];
    if (kind === "playing") shapes.push(["path", { d: "M10.3 5.4a3.7 3.7 0 0 1 0 5.2M12.4 3.5a6.3 6.3 0 0 1 0 9" }]);
    else if (kind === "muted") shapes.push(["path", { d: "m10.3 6 4 4m0-4-4 4" }]);
    else shapes.push(["path", { d: "m10.5 5.2 4 2.8-4 2.8Z" }]);
    return vectorGlyph("fluxion-control-glyph", shapes);
  }

  function describeTab(tab, sleeping) {
    const browser = tab.linkedBrowser;
    const nativeSharing = tab.sharingState;
    const hasNativeSharing = nativeSharing && (
      typeof nativeSharing !== "object" ||
      Object.values(nativeSharing).some(value => value && value !== "none" && value !== "false")
    );
    const sharing = hasNativeSharing
      ? nativeSharing
      : tab.getAttribute("sharing") || browser?.getAttribute("sharing");
    return FluxionTabStatus.describe({
      attention: tab.hasAttribute("attention"),
      busy: tab.hasAttribute("busy") || tab.hasAttribute("progress"),
      crashed: tab.hasAttribute("crashed"),
      mediaBlocked: tab.activeMediaBlocked || tab.hasAttribute("activemedia-blocked"),
      muted: tab.muted || tab.hasAttribute("muted"),
      pictureInPicture: tab.pictureinpicture || tab.hasAttribute("pictureinpicture"),
      sharing,
      sleeping,
      soundPlaying: tab.soundPlaying || tab.hasAttribute("soundplaying"),
    });
  }

  function createTabElement(tab) {
    const item = create("div", "fluxion-tab");
    const sleeping = !tab.linkedPanel || tab.hasAttribute("pending") || tab.hasAttribute("fluxion-sleeping");
    const status = describeTab(tab, sleeping);
    item.classList.toggle("is-sleeping", sleeping);
    item.classList.toggle("is-multiselected", Boolean(tab.multiselected));
    item.tabIndex = tab === gBrowser.selectedTab ? 0 : -1;
    item.draggable = true;
    item._fluxionTab = tab;
    item.setAttribute("role", "tab");
    item.setAttribute("aria-keyshortcuts", "ArrowUp ArrowDown Home End Delete M");
    item.dataset.active = String(tab === gBrowser.selectedTab);
    item.dataset.status = status.indicators.map(indicator => indicator.kind).join(" ");
    item.setAttribute("aria-selected", String(tab === gBrowser.selectedTab || tab.multiselected));
    item.setAttribute(
      "aria-label",
      [tabLabel(tab), ...status.labels].join(", "),
    );
    item.title = [
      tabLabel(tab),
      tab.linkedBrowser?.currentURI?.displaySpec || "",
      ...status.labels,
    ].filter(Boolean).join("\n");

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

    if (tab.hasAttribute("fluxion-peek")) {
      const badge = create("span", "fluxion-peek-badge");
      badge.textContent = "Peek";
      badge.title = "Temporary page — switch away to close";
      item.appendChild(badge);
    }

    if (tab.splitview) {
      const splitMark = create("span", "fluxion-split-mark");
      const position = FluxionSplitViews.splitPosition(tab);
      const orientation = splitOrientation(tab);
      const spatialPosition = FluxionSplitViews.positionLabel(
        position, orientation, tab.splitview.tabs.length,
      );
      splitMark.title = `${orientation === FluxionSplitViews.STACKED ? "Stacked" : "Side-by-side"} split view, ${spatialPosition} pane`;
      splitMark.setAttribute("aria-label", splitMark.title);
      item.appendChild(splitMark);
    }

    if (status.indicators.length) {
      const indicators = create("span", "fluxion-status-strip");
      indicators.setAttribute("aria-hidden", "true");
      for (const indicator of status.indicators) indicators.appendChild(statusGlyph(indicator));
      item.appendChild(indicators);
    }

    if (status.audio) {
      const audio = create("button", "fluxion-audio");
      audio.type = "button";
      audio.appendChild(controlGlyph(status.audio.kind));
      audio.title = status.audio.action;
      audio.setAttribute("aria-label", audio.title);
      audio.tabIndex = -1;
      audio.addEventListener("click", event => {
        event.stopPropagation();
        if (status.audio.kind === "blocked") tab.resumeDelayedMedia();
        else tab.toggleMuteAudio();
      });
      item.appendChild(audio);
    }

    const close = create("button", "fluxion-close");
    close.type = "button";
    close.appendChild(controlGlyph("close"));
    close.title = "Close tab";
    close.setAttribute("aria-label", `Close ${tabLabel(tab)}`);
    close.tabIndex = -1;
    close.addEventListener("click", event => {
      event.stopPropagation();
      closeWithStability(tab, item);
    });
    item.appendChild(close);

    const select = event => {
      const accelerator = event && (navigator.platform.includes("Mac") ? event.metaKey : event.ctrlKey);
      if (event?.shiftKey) {
        const anchor = gBrowser.lastMultiSelectedTab;
        if (!accelerator) {
          gBrowser.selectedTab = anchor;
          gBrowser.clearMultiSelectedTabs();
        }
        gBrowser.addRangeToMultiSelectedTabs(anchor, tab);
      } else if (accelerator) {
        if (tab.multiselected) gBrowser.removeFromMultiSelectedTabs(tab);
        else if (tab !== gBrowser.selectedTab) {
          gBrowser.addToMultiSelectedTabs(tab);
          gBrowser.lastMultiSelectedTab = tab;
        }
      } else {
        if (tab.multiselected) gBrowser.lockClearMultiSelectionOnce();
        gBrowser.selectedTab = tab;
      }
      scheduleRender();
    };
    item.addEventListener("click", select);
    item.addEventListener("auxclick", event => {
      if (event.button === 1) closeWithStability(tab, item);
    });
    item.addEventListener("keydown", event => {
      if (FluxionFlowNavigation.handlesRovingKey(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        const rendered = renderedTabElements();
        const targetIndex = FluxionFlowNavigation.rovingIndex(
          rendered.length, rendered.indexOf(item), event.key,
        );
        const targetTab = rendered[targetIndex]?._fluxionTab;
        if (targetTab) {
          focusTabAfterRender = targetTab;
          gBrowser.selectedTab = targetTab;
          scheduleRender();
        }
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        focusTabAfterRender = tab;
        select(event);
      } else if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        closeWithStability(tab, item);
      } else if (event.key.toLowerCase() === "m" && status.audio) {
        event.preventDefault();
        if (status.audio.kind === "blocked") tab.resumeDelayedMedia();
        else tab.toggleMuteAudio();
      }
    });
    item.addEventListener("contextmenu", event => {
      event.preventDefault();
      contextTab = tab;
      contextMenu.openPopupAtScreen(event.screenX, event.screenY, true);
    });
    item.addEventListener("dragstart", event => {
      dragTab = tab;
      dragTabs = contextTabs(tab);
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("application/x-fluxion-tab", "tab");
      }
      dragAnnouncement.textContent =
        "Drag to an edge to reorder, or over the centre to split. Hold Shift to stack pages.";
    });
    item.addEventListener("dragover", event => {
      if (!dragTab || dragTabs.includes(tab)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      showTabDropFeedback(item, tabDropIntent(event, item, tab), tab);
    });
    item.addEventListener("dragleave", event => {
      if (event.relatedTarget?.nodeType && item.contains(event.relatedTarget)) return;
      if (dragTargetElement === item) clearTabDropFeedback();
    });
    item.addEventListener("drop", event => {
      event.preventDefault();
      event.stopPropagation();
      if (dragTab && !dragTabs.includes(tab)) {
        applyTabDrop(dragTabs, tab, tabDropIntent(event, item, tab));
      }
      resetTabDrag();
    });
    item.addEventListener("dragend", resetTabDrag);
    tabElements.set(tab, item);
    return item;
  }

  function createSplitElement(splitView, tabs) {
    const item = create("div", "fluxion-split");
    const orientation = FluxionSplitViews.orientationOf(splitView);
    item.setAttribute("role", "group");
    item.setAttribute(
      "aria-label",
      orientation === FluxionSplitViews.STACKED ? "Stacked split view" : "Side-by-side split view",
    );
    item.dataset.orientation = orientation;
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
      clearTabDropFeedback();
      heading.setAttribute("data-dragover", "true");
    });
    heading.addEventListener("dragleave", () => heading.removeAttribute("data-dragover"));
    heading.addEventListener("drop", event => {
      event.preventDefault();
      heading.removeAttribute("data-dragover");
      if (dragTabs.length) group.addTabs(dragTabs.filter(tab => !tab.pinned && !tab.splitview));
      resetTabDrag();
      scheduleRender();
    });

    const groupTabs = create("div", "fluxion-group-tabs");
    appendSplitRows(groupTabs, tabs);
    item.append(heading, groupTabs);
    return item;
  }

  function renderWorkspaces() {
    workspaceList.replaceChildren();
    workspaceElements.clear();
    const colours = { slate: "#68747b", blue: "#51748a", ochre: "#92794d", sage: "#667c69", rose: "#8b646b" };
    for (const [workspaceIndex, workspace] of workspaces.entries()) {
      const button = create("button", "fluxion-workspace");
      button.type = "button";
      button.tabIndex = workspace.id === currentWorkspace ? 0 : -1;
      button.title = workspace.name;
      button.setAttribute("role", "tab");
      button.setAttribute("aria-selected", String(workspace.id === currentWorkspace));
      button.setAttribute("aria-posinset", String(workspaceIndex + 1));
      button.setAttribute("aria-setsize", String(workspaces.length));
      button.style.setProperty("--workspace-accent", colours[workspace.accent]);
      const label = create("span", "fluxion-workspace-name");
      label.textContent = workspace.name;
      button.append(workspaceSymbol(workspace.icon), label);
      button.addEventListener("click", () => switchWorkspace(workspace.id));
      button.addEventListener("keydown", event => {
        if (!FluxionFlowNavigation.handlesRovingKey(event.key, "horizontal")) return;
        event.preventDefault();
        event.stopPropagation();
        const targetIndex = FluxionFlowNavigation.rovingIndex(
          workspaces.length, workspaceIndex, event.key, "horizontal",
        );
        const target = workspaces[targetIndex];
        if (target) {
          focusWorkspaceAfterRender = target.id;
          switchWorkspace(target.id);
        }
      });
      button.addEventListener("contextmenu", event => {
        event.preventDefault();
        contextWorkspace = workspace.id;
        workspaceMenu.openPopupAtScreen(event.screenX, event.screenY, true);
      });
      button.addEventListener("dragover", event => {
        if (!dragTab || tabWorkspace(dragTab) === workspace.id) return;
        event.preventDefault();
        clearTabDropFeedback();
        button.setAttribute("data-dragover", "true");
      });
      button.addEventListener("dragleave", () => button.removeAttribute("data-dragover"));
      button.addEventListener("drop", event => {
        event.preventDefault();
        button.removeAttribute("data-dragover");
        if (dragTabs.length) moveTabsToWorkspace(dragTabs, workspace.id);
        resetTabDrag();
      });
      workspaceList.appendChild(button);
      workspaceElements.set(workspace.id, button);
    }
    addWorkspaceButton.disabled = workspaces.length >= FluxionWorkspaces.MAX_WORKSPACES;
  }

  function render() {
    renderQueued = false;
    renderWorkspaces();
    tabElements.clear();
    pinnedTabs.replaceChildren();
    tabsList.replaceChildren();
    const visible = [...gBrowser.tabs].filter(tab => tabWorkspace(tab) === currentWorkspace);
    const visibleSet = new Set(visible);
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
        visibleSet.has(tab) && !tab.pinned && !tab.group
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
    const rendered = renderedTabElements();
    rendered.forEach((element, index) => {
      element.setAttribute("aria-posinset", String(index + 1));
      element.setAttribute("aria-setsize", String(rendered.length));
    });
    if (focusTabAfterRender) {
      const element = tabElements.get(focusTabAfterRender);
      focusTabAfterRender = null;
      if (element && !element.closest(".fluxion-group.is-collapsed")) {
        element.focus({ preventScroll: true });
        element.scrollIntoView({ block: "nearest" });
      }
    } else if (focusWorkspaceAfterRender) {
      const element = workspaceElements.get(focusWorkspaceAfterRender);
      focusWorkspaceAfterRender = null;
      element?.focus({ preventScroll: true });
    }
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
  const duplicateTabItem = appendAction(contextMenu, "Duplicate Tab", () => {
    for (const tab of contextTabs()) {
      const duplicate = gBrowser.duplicateTab(tab);
      duplicate?.removeAttribute("fluxion-peek");
    }
  });
  const reloadTabItem = appendAction(contextMenu, "Reload Tab", () => {
    for (const tab of contextTabs()) tab.linkedBrowser.reload();
  });
  const mediaTabItem = appendAction(contextMenu, "Mute Tab", () => {
    const tabs = contextTabs();
    const blocked = tabs.filter(tab => tab.activeMediaBlocked || tab.hasAttribute("activemedia-blocked"));
    if (blocked.length) {
      for (const tab of blocked) tab.resumeDelayedMedia();
      return;
    }
    const unmute = tabs.every(tab => tab.muted || tab.hasAttribute("muted"));
    for (const tab of tabs) {
      const muted = tab.muted || tab.hasAttribute("muted");
      if ((unmute && muted) || (!unmute && !muted)) tab.toggleMuteAudio();
    }
  });
  const pinTabItem = appendAction(contextMenu, "Pin / Unpin Tab", () => {
    const tabs = contextTabs();
    const unpin = tabs.every(tab => tab.pinned);
    for (const tab of unpin ? [...tabs].reverse() : tabs) {
      if (unpin) gBrowser.unpinTab(tab);
      else if (!tab.pinned) gBrowser.pinTab(tab);
    }
  });
  const sleepTabItem = appendAction(contextMenu, "Sleep Background Tab", () => {
    for (const tab of contextTabs()) window.FluxionTabSleeping?.sleep(tab, { forceAge: true });
  });
  const promotePeekItem = appendAction(contextMenu, "Keep Peek as Tab", () => {
    if (contextTab) window.FluxionPeek?.promote(contextTab);
  });
  const splitPeekItem = appendAction(contextMenu, "Open Peek Side by Side", () => {
    if (contextTab) window.FluxionPeek?.openBeside(contextTab);
  });
  contextMenu.appendChild(xul("menuseparator"));
  const splitWithMenu = xul("menu", { label: "Open in Split View With" });
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
  const orientSplitItem = appendAction(
    contextMenu,
    "Stack Pages Vertically",
    () => toggleSplitOrientation(contextTab),
  );
  splitWithPopup.addEventListener("popupshowing", event => {
    if (event.target !== splitWithPopup) return;
    splitWithPopup.replaceChildren();
    appendAction(
      splitWithPopup,
      "New Page Side by Side",
      () => openNewSplit(contextTab, FluxionSplitViews.SIDE_BY_SIDE),
    );
    appendAction(
      splitWithPopup,
      "New Page Stacked",
      () => openNewSplit(contextTab, FluxionSplitViews.STACKED),
    );
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
    appendAction(tabGroupPopup, "New Group…", () => createGroupForTabs(contextTabs()));
    const groups = gBrowser.tabGroups.filter(group =>
      group.tabs.some(tab => tabWorkspace(tab) === currentWorkspace)
    );
    if (groups.length) tabGroupPopup.appendChild(xul("menuseparator"));
    for (const group of groups) {
      appendAction(
        tabGroupPopup,
        `Move to ${group.label || "Group"}`,
        () => {
          const tabs = contextTabs().filter(tab => !tab.pinned && !tab.splitview);
          if (tabs.length) group.addTabs(tabs);
          gBrowser.clearMultiSelectedTabs();
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
    const actionTabs = contextTabs();
    const count = actionTabs.length;
    const inSplitView = Boolean(contextTab?.splitview);
    const isPeek = Boolean(window.FluxionPeek?.isPeek(contextTab));
    duplicateTabItem.setAttribute("label", count > 1 ? `Duplicate ${count} Tabs` : "Duplicate Tab");
    reloadTabItem.setAttribute("label", count > 1 ? `Reload ${count} Tabs` : "Reload Tab");
    const mediaBlocked = actionTabs.some(tab =>
      tab.activeMediaBlocked || tab.hasAttribute("activemedia-blocked")
    );
    const allMuted = actionTabs.every(tab => tab.muted || tab.hasAttribute("muted"));
    mediaTabItem.setAttribute(
      "label",
      mediaBlocked
        ? (count > 1 ? "Play Blocked Audio" : "Play Audio")
        : `${allMuted ? "Unmute" : "Mute"} ${count > 1 ? `${count} Tabs` : "Tab"}`,
    );
    pinTabItem.setAttribute("label", count > 1
      ? `${actionTabs.every(tab => tab.pinned) ? "Unpin" : "Pin"} ${count} Tabs`
      : "Pin / Unpin Tab");
    sleepTabItem.setAttribute("label", count > 1 ? "Sleep Selected Background Tabs" : "Sleep Background Tab");
    splitWithMenu.hidden = inSplitView || Boolean(contextTab?.pinned);
    separateSplitItem.hidden = !inSplitView;
    reverseSplitItem.hidden = !inSplitView;
    orientSplitItem.hidden = !inSplitView;
    if (inSplitView) {
      reverseSplitItem.setAttribute(
        "label",
        splitOrientation(contextTab) === FluxionSplitViews.STACKED
          ? "Swap Top and Bottom"
          : "Swap Left and Right",
      );
      orientSplitItem.setAttribute(
        "label",
        splitOrientation(contextTab) === FluxionSplitViews.STACKED
          ? "Place Pages Side by Side"
          : "Stack Pages Vertically",
      );
    }
    sleepTabItem.hidden = !actionTabs.some(tab => !tab.selected && !tab.pinned && !tab.splitview && tab.linkedPanel);
    promotePeekItem.hidden = !isPeek;
    splitPeekItem.hidden = !isPeek;
    moveToPopup.replaceChildren();
    for (const workspace of workspaces) {
      appendAction(
        moveToPopup,
        workspace.name,
        () => moveTabsToWorkspace(contextTabs(), workspace.id),
        contextTab && tabWorkspace(contextTab) === workspace.id ? { disabled: "true" } : {},
      );
    }
  });
  contextMenu.appendChild(xul("menuseparator"));
  const closeTabItem = appendAction(contextMenu, "Close Tab", () => {
    closeTabs(contextTabs());
  });
  contextMenu.addEventListener("popupshowing", event => {
    if (event.target !== contextMenu) return;
    const count = contextTabs().length;
    closeTabItem.setAttribute("label", count > 1 ? `Close ${count} Tabs` : "Close Tab");
  });

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
  on(window, "FluxionShortcutsChanged", updateModeButtonTitle);
  on(addWorkspaceButton, "click", addWorkspace);
  on(flow, "pointerenter", () => {
    focusPointerInside = true;
    revealFocusSurface();
  });
  on(flow, "pointerleave", () => {
    focusPointerInside = false;
    scheduleFocusSurfaceHide();
  });
  on(flow, "focusin", () => {
    revealFocusSurface();
  });
  on(flow, "focusout", () => {
    scheduleFocusSurfaceHide();
  });
  on(flow, "click", event => {
    if (flow.dataset.state === "focus" && event.target === flow) revealFocusSurface();
  });
  on(flow, "keydown", event => {
    if (flow.dataset.state !== "focus") return;
    if (event.key === "Escape" && flow.dataset.revealed === "true") {
      event.preventDefault();
      event.stopPropagation();
      flow.focus();
      hideFocusSurface({ force: true });
      return;
    }
    if (event.target === flow && ["Enter", " ", "ArrowRight"].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      revealFocusSurface({ focusActive: true });
    }
  });
  on(newTabButton, "click", () => {
    openWorkspaceTab();
  });
  for (const eventName of [
    "TabOpen", "TabClose", "TabSelect", "TabMove", "TabPinned", "TabUnpinned",
    "TabAttrModified", "TabGroupCreate", "TabGroupRemoved", "TabGroupUpdate",
    "TabGroupCollapse", "TabGroupExpand", "TabGrouped", "TabUngrouped",
    "SplitViewCreated", "SplitViewRemoved", "SplitViewTabChange",
    "TabSharingStateChanged",
    "FluxionTabSleep",
    "FluxionPeekChange",
    "TabMultiSelect",
  ]) {
    on(gBrowser.tabContainer, eventName, scheduleRender);
  }
  for (const eventName of [
    "TabSelect", "SplitViewCreated", "SplitViewTabChange", "TabSplitViewActivate",
  ]) {
    on(gBrowser.tabContainer, eventName, () => {
      window.requestAnimationFrame(() => applyActiveSplitOrientation());
    });
  }
  on(gBrowser.tabContainer, "SplitViewRemoved", () => {
    window.requestAnimationFrame(() => applyActiveSplitOrientation());
  });
  on(gBrowser.tabpanels, "command", event => {
    if (event.target?.classList?.contains("split-view-splitter")) {
      window.requestAnimationFrame(() => updateSplitAccessibility());
    }
  });
  on(window, "keydown", event => {
    if (window.FluxionShortcuts?.matches(event, "sidebar")) {
      event.preventDefault();
      event.stopPropagation();
      cycleSidebar();
    }
    if (
      window.FluxionShortcuts?.matches(event, "workspaceNext") ||
      window.FluxionShortcuts?.matches(event, "workspacePrevious")
    ) {
      event.preventDefault();
      event.stopPropagation();
      cycleWorkspace(window.FluxionShortcuts.matches(event, "workspaceNext") ? 1 : -1);
    }
  }, true);
  on(window, "unload", () => {
    clearFocusHideTimer();
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
  applyActiveSplitOrientation();
  updateWindowTitle();
  window.FluxionUI = Object.freeze({
    addWorkspace,
    createGroup: () => createGroupForTab(gBrowser.selectedTab),
    createSuggestedGroup: (tabs, name) => createNamedGroup(tabs, name),
    createSplitView,
    cycleSidebar,
    currentWorkspace: () => currentWorkspace,
    deleteWorkspace,
    moveTabToWorkspace,
    newTab: openWorkspaceTab,
    openNewSplit,
    refresh: scheduleRender,
    renameWorkspace,
    reverseSplitView,
    revealSidebar: revealFocusSurface,
    hideSidebar: hideFocusSurface,
    separateSplitView,
    setSplitOrientation,
    setSidebarState,
    setTabDensity,
    splitOrientation,
    selectTab(tab) {
      if (!tab || !tab.parentNode) return;
      const workspace = tabWorkspace(tab);
      if (workspace !== currentWorkspace) switchWorkspace(workspace);
      gBrowser.selectedTab = tab;
    },
    switchWorkspace,
    tabWorkspace,
    toggleSplitOrientation,
    workspaces: () => workspaces.map(workspace => ({ ...workspace })),
  });
  if (Services.env.get("FLUXION_VISUAL_STATUS_TEST") === "1") {
    window.setTimeout(() => {
      const video = gBrowser.addTrustedTab("about:blank?fluxion-status=video", { skipAnimation: true });
      const capture = gBrowser.addTrustedTab("about:blank?fluxion-status=capture", { skipAnimation: true });
      const crashed = gBrowser.addTrustedTab("about:blank?fluxion-status=crash", { skipAnimation: true });
      for (const tab of [video, capture, crashed]) tab.setAttribute(TAB_WORKSPACE, currentWorkspace);
      video.setAttribute("label", "Video reference");
      video.setAttribute("pictureinpicture", "true");
      video.setAttribute("soundplaying", "true");
      video.setAttribute("busy", "true");
      capture.setAttribute("label", "Live camera session");
      capture.setAttribute("sharing", "camera microphone");
      crashed.setAttribute("label", "Crashed fixture");
      crashed.setAttribute("crashed", "true");
      crashed.setAttribute("pictureinpicture", "true");
      crashed.setAttribute("soundplaying", "true");
      render();
      const videoRow = tabElements.get(video);
      const captureRow = tabElements.get(capture);
      const crashedRow = tabElements.get(crashed);
      const checks = {
        audio: Boolean(videoRow?.querySelector('.fluxion-audio[aria-label="Mute tab"]')),
        capture: Boolean(captureRow?.querySelector('[data-kind="sharing-camera-microphone"]')),
        captureLabel: Boolean(captureRow?.getAttribute("aria-label").includes("Using the camera and microphone")),
        crash: Boolean(crashedRow?.querySelector('[data-kind="crashed"]')),
        crashExclusive: crashedRow?.querySelectorAll(".fluxion-status").length === 1 &&
          !crashedRow?.querySelector(".fluxion-audio"),
        loading: Boolean(videoRow?.querySelector('[data-kind="loading"]')),
        pictureInPicture: Boolean(videoRow?.querySelector('[data-kind="picture-in-picture"]')),
        pictureInPictureLabel: Boolean(
          videoRow?.getAttribute("aria-label").includes("Video playing in Picture-in-Picture")
        ),
      };
      const initial = Object.values(checks).every(Boolean);
      videoRow?.querySelector(".fluxion-audio")?.click();
      video.removeAttribute("busy");
      render();
      const updated = tabElements.get(video);
      const controlled = Boolean(
        video.hasAttribute("muted") &&
        updated?.querySelector('.fluxion-audio[aria-label="Unmute tab"]') &&
        !updated?.querySelector('[data-kind="loading"]')
      );
      if (initial && controlled) {
        Services.prefs.setStringPref(
          "fluxion.status.health",
          "native-gecko-tab-states-projected-and-controllable",
        );
      } else {
        const failed = Object.entries(checks)
          .filter(([, passed]) => !passed)
          .map(([name]) => name)
          .join(",") || "none";
        Services.prefs.setStringPref(
          "fluxion.status.visual.error",
          `failed=${failed} controlled=${controlled} muted=${video.hasAttribute("muted")} ` +
            `rows=${Boolean(videoRow)},${Boolean(captureRow)},${Boolean(crashedRow)}`,
        );
      }
      Services.prefs.savePrefFile(null);
      gBrowser.removeTab(crashed, { animate: false });
      scheduleRender();
    }, 2200);
  }
  if (Services.env.get("FLUXION_VISUAL_DROP_TEST") === "1") {
    window.setTimeout(() => {
      const dragged = gBrowser.addTrustedTab("about:blank?fluxion-drop=dragged", { skipAnimation: true });
      const target = gBrowser.addTrustedTab("about:blank?fluxion-drop=target", { skipAnimation: true });
      dragged.setAttribute(TAB_WORKSPACE, currentWorkspace);
      target.setAttribute(TAB_WORKSPACE, currentWorkspace);
      dragged.setAttribute("label", "Dragged reference");
      target.setAttribute("label", "Drop target");
      render();

      const rect = { left: 0, top: 0, width: 200, height: 100 };
      const sideIntent = FluxionTabDrop.classify({
        canSplit: true, clientX: 40, clientY: 50, rect,
      });
      dragTab = dragged;
      dragTabs = [dragged];
      const targetRow = tabElements.get(target);
      showTabDropFeedback(targetRow, sideIntent, target);
      const sideFeedback = targetRow?.dataset.dropAction === "split" &&
        targetRow?.dataset.dropLabel === "Split left" &&
        dragAnnouncement.textContent.includes("to the left of");
      const sideResult = applyTabDrop([dragged], target, sideIntent);
      const sideBySide = Boolean(
        sideResult?.splitView?.tabs?.[0] === dragged &&
        FluxionSplitViews.orientationOf(sideResult.splitView) === FluxionSplitViews.SIDE_BY_SIDE
      );

      separateSplitView(dragged);
      const stackedIntent = FluxionTabDrop.classify({
        canSplit: true, clientX: 100, clientY: 60, rect, stacked: true,
      });
      const stackedResult = applyTabDrop([dragged], target, stackedIntent);
      const stacked = Boolean(
        stackedResult?.splitView?.tabs?.[1] === dragged &&
        FluxionSplitViews.orientationOf(stackedResult.splitView) === FluxionSplitViews.STACKED
      );

      separateSplitView(dragged);
      const reorderIntent = FluxionTabDrop.classify({
        canSplit: true, clientX: 100, clientY: 8, rect,
      });
      const reordered = applyTabDrop([dragged], target, reorderIntent)?.action === "reorder" &&
        dragged._tPos + 1 === target._tPos;
      if (sideFeedback && sideBySide && stacked && reordered) {
        Services.prefs.setStringPref(
          "fluxion.drop.health",
          "native-drag-reorder-and-two-orientation-split",
        );
      } else {
        Services.prefs.setStringPref(
          "fluxion.drop.visual.error",
          `feedback=${sideFeedback} side=${sideBySide} stacked=${stacked} reorder=${reordered}`,
        );
      }
      Services.prefs.savePrefFile(null);
      if (dragged.splitview) separateSplitView(dragged);
      gBrowser.removeTabs([dragged, target], { animate: false });
      resetTabDrag();
      scheduleRender();
    }, 3000);
  }
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
    setSplitOrientation(primary, FluxionSplitViews.STACKED);
    const [topPanel, bottomPanel] = splitView.panels;
    const topRect = topPanel?.getBoundingClientRect();
    const bottomRect = bottomPanel?.getBoundingClientRect();
    const stacked = gBrowser.tabpanels.getAttribute("orient") === "vertical" &&
      gBrowser.tabpanels.getAttribute("data-fluxion-split-orientation") === "stacked" &&
      topRect?.height > 100 && bottomRect?.height > 100 && bottomRect.top > topRect.top;
    setSplitOrientation(primary, FluxionSplitViews.SIDE_BY_SIDE);
    const leftRect = topPanel?.getBoundingClientRect();
    const rightRect = bottomPanel?.getBoundingClientRect();
    const sideBySide = gBrowser.tabpanels.getAttribute("orient") === "horizontal" &&
      gBrowser.tabpanels.getAttribute("data-fluxion-split-orientation") === "side-by-side" &&
      leftRect?.width > 100 && rightRect?.width > 100 && rightRect.left > leftRect.left;
    if (stacked && sideBySide) {
      Services.prefs.setStringPref(
        "fluxion.splitview.health",
        "native-side-by-side-and-stacked-rendered",
      );
    } else {
      const rect = value => value
        ? `${Math.round(value.left)},${Math.round(value.top)},${Math.round(value.width)},${Math.round(value.height)}`
        : "missing";
      Services.prefs.setStringPref(
        "fluxion.splitview.visual.error",
        `stacked=${Boolean(stacked)}[${rect(topRect)}|${rect(bottomRect)}] ` +
          `sideBySide=${Boolean(sideBySide)}[${rect(leftRect)}|${rect(rightRect)}] ` +
          `orient=${gBrowser.tabpanels.getAttribute("orient") || "none"}`,
      );
    }
    Services.prefs.savePrefFile(null);
    scheduleRender();
  }
  if (Services.env.get("FLUXION_VISUAL_ORGANISATION_TEST") === "1") {
    const fixtures = [
      ["https://react.dev/learn?fluxion-organise=guide", "React learning guide"],
      ["https://github.com/facebook/react?fluxion-organise=source", "React source repository"],
      ["https://www.npmjs.com/package/react?fluxion-organise=package", "React package"],
    ];
    for (const [url, label] of fixtures) {
      const tab = gBrowser.addTrustedTab(url, { skipAnimation: true });
      tab.setAttribute(TAB_WORKSPACE, currentWorkspace);
      tab.setAttribute("label", label);
    }
    scheduleRender();
  }
  if (Services.env.get("FLUXION_VISUAL_MULTISELECT_TEST") === "1") {
    window.setTimeout(() => {
      const selected = gBrowser.selectedTab;
      const other = gBrowser.visibleTabs.find(tab => tab !== selected && !tab.closing);
      if (!other) return;
      gBrowser.addToMultiSelectedTabs(other);
      gBrowser.lastMultiSelectedTab = other;
      Promise.resolve().then(() => {
        if (gBrowser.selectedTabs.length >= 2 && selected.multiselected && other.multiselected) {
          Services.prefs.setStringPref("fluxion.multiselect.health", "native-multiselect-visible");
          Services.prefs.savePrefFile(null);
          scheduleRender();
        }
      });
    }, 2600);
  }
  if (Services.env.get("FLUXION_VISUAL_SCALE_TEST") === "1") {
    window.setTimeout(() => {
      const creationStarted = window.performance.now();
      const scaleTabs = Array.from({ length: 200 }, (_, index) => {
        const tab = gBrowser.addTrustedTab(`about:blank?fluxion-scale=${index}`, {
          skipAnimation: true,
        });
        tab.setAttribute(TAB_WORKSPACE, currentWorkspace);
        tab.setAttribute("label", `Scale tab ${index + 1}`);
        return tab;
      });
      const creationElapsed = window.performance.now() - creationStarted;
      const renderStarted = window.performance.now();
      window.requestAnimationFrame(() => {
        const renderElapsed = window.performance.now() - renderStarted;
        const rendered = renderedTabElements();
        const tabStops = rendered.filter(element => element.tabIndex === 0);
        const selectedBefore = gBrowser.selectedTab;
        const selectedElement = tabElements.get(selectedBefore);
        if (
          creationElapsed > 8000 || renderElapsed > 1500 ||
          rendered.length < scaleTabs.length || tabStops.length !== 1 || !selectedElement
        ) {
          Services.prefs.setStringPref(
            "fluxion.scale.visual.error",
            `create=${creationElapsed.toFixed(1)} render=${renderElapsed.toFixed(1)} rows=${rendered.length} tabstops=${tabStops.length}`,
          );
          Services.prefs.savePrefFile(null);
          return;
        }
        selectedElement.focus();
        selectedElement.dispatchEvent(new window.KeyboardEvent("keydown", {
          key: "ArrowDown", bubbles: true,
        }));
        window.requestAnimationFrame(() => {
          const focusStable = document.activeElement?._fluxionTab === gBrowser.selectedTab;
          const selectionMoved = gBrowser.selectedTab !== selectedBefore;
          if (focusStable && selectionMoved) {
            Services.prefs.setStringPref(
              "fluxion.scale.health",
              "200-tabs-rendered-with-roving-keyboard-focus",
            );
          } else {
            Services.prefs.setStringPref(
              "fluxion.scale.visual.error",
              `focusStable=${focusStable} selectionMoved=${selectionMoved}`,
            );
          }
          Services.prefs.savePrefFile(null);
          gBrowser.removeTabs(scaleTabs, { animate: false });
          scheduleRender();
        });
      });
    }, 3600);
  }
  if (Services.env.get("FLUXION_VISUAL_FOCUS_TEST") === "1") {
    window.setTimeout(() => {
      setSidebarState("focus");
      window.setTimeout(() => {
        focusPointerInside = false;
        hideFocusSurface({ force: true });
        const railRect = flow.getBoundingClientRect();
        const hiddenSurfaceRect = surface.getBoundingClientRect();
        const contentBefore = gBrowser.tabpanels.getBoundingClientRect();
        const hidden = railRect.width >= 2 && railRect.width <= 4 &&
          surface.inert && flow.tabIndex === 0 && flow.getAttribute("aria-expanded") === "false" &&
          hiddenSurfaceRect.width >= 228 && hiddenSurfaceRect.width <= 236 &&
          Math.abs(hiddenSurfaceRect.right - railRect.right) <= 1.5;
        revealFocusSurface();
        window.setTimeout(() => {
          const revealedSurfaceRect = surface.getBoundingClientRect();
          const contentAfter = gBrowser.tabpanels.getBoundingClientRect();
          const contentStable = Math.abs(contentAfter.left - contentBefore.left) <= 1 &&
            Math.abs(contentAfter.width - contentBefore.width) <= 1;
          const revealed = flow.dataset.revealed === "true" && !surface.inert &&
            flow.getAttribute("aria-expanded") === "true" &&
            revealedSurfaceRect.width >= 228 && revealedSurfaceRect.width <= 236 &&
            Math.abs(revealedSurfaceRect.left - railRect.left) <= 1.5;
          if (hidden && revealed && contentStable) {
            Services.prefs.setStringPref(
              "fluxion.focus.health",
              "focus-rail-overlay-revealed-without-content-reflow",
            );
          } else {
            const rect = value =>
              `${Math.round(value.left)},${Math.round(value.top)},${Math.round(value.width)},${Math.round(value.height)}`;
            Services.prefs.setStringPref(
              "fluxion.focus.visual.error",
              `hidden=${hidden} revealed=${revealed} stable=${contentStable} ` +
                `rail=[${rect(railRect)}] hiddenSurface=[${rect(hiddenSurfaceRect)}] ` +
                `revealedSurface=[${rect(revealedSurfaceRect)}] ` +
                `content=[${rect(contentBefore)}|${rect(contentAfter)}] inert=${surface.inert}`,
            );
          }
          Services.prefs.savePrefFile(null);
        }, document.documentElement.hasAttribute("data-fluxion-no-motion") ? 20 : 240);
      }, document.documentElement.hasAttribute("data-fluxion-no-motion") ? 20 : 240);
    }, 23500);
  }
  if (Services.env.get("FLUXION_VISUAL_TOOLBAR_MENU_TEST") === "1") {
    window.setTimeout(() => {
      const panelButton = document.getElementById("PanelUI-button");
      const inheritedHidden = !panelButton || window.getComputedStyle(panelButton).display === "none";
      const buttonRect = toolbarMenuButton.getBoundingClientRect();
      const labels = [...toolbarMenuPopup.children].map(item => item.getAttribute("label")).filter(Boolean);
      const expectedLabels = [
        "New Tab", "New Window", "New Private Window", "Command Palette…",
        "Search Tabs…", "Library", "Fluxion Settings…", "About Fluxion",
      ];
      const mounted = toolbarMenuButton.parentNode === toolbarTarget &&
        buttonRect.width >= 24 && buttonRect.width <= 38 && buttonRect.height >= 24 &&
        toolbarMenuButton.getAttribute("aria-label") === "Fluxion menu" &&
        expectedLabels.every(label => labels.includes(label));
      const before = gBrowser.tabs.length;
      toolbarNewTabItem.dispatchEvent(new window.CustomEvent("command", { bubbles: true }));
      const created = gBrowser.selectedTab;
      const commandWorked = gBrowser.tabs.length === before + 1 &&
        tabWorkspace(created) === currentWorkspace && created.linkedBrowser.currentURI.spec === NEW_TAB_URL;
      if (commandWorked) gBrowser.removeTab(created, { animate: false });
      toolbarMenuPopup.openPopup(toolbarMenuButton, "after_end");
      window.setTimeout(() => {
        const opened = ["open", "showing"].includes(toolbarMenuPopup.state);
        if (inheritedHidden && mounted && commandWorked && opened) {
          Services.prefs.setStringPref(
            "fluxion.toolbarMenu.health",
            "product-menu-opened-and-native-command-executed",
          );
        } else {
          Services.prefs.setStringPref(
            "fluxion.toolbarMenu.visual.error",
            `hidden=${inheritedHidden} mounted=${mounted} command=${commandWorked} ` +
              `opened=${opened} state=${toolbarMenuPopup.state} ` +
              `button=${Math.round(buttonRect.width)}x${Math.round(buttonRect.height)} labels=${labels.join("|")}`,
          );
        }
        Services.prefs.savePrefFile(null);
      }, 180);
    }, 25500);
  }
  Services.prefs.setStringPref("fluxion.chrome.health", "flow-sidebar-loaded");
  Services.prefs.savePrefFile(null);
})(window);
