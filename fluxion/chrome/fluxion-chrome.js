/* global gBrowser, Services, SessionStore, FluxionWorkspaces */
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
    #appMenu-fxa-status2,
    #appMenu-fxa-separator,
    #appMenu-new-ai-window-button,
    #appMenu-chats-history-button,
    #appMenu-update-banner { display: none !important; }
    #browser { background: var(--fluxion-bg); }
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
    .fluxion-workspaces { display: flex; gap: 8px; padding: 6px 9px 5px; }
    .fluxion-workspace {
      position: relative; min-width: 0; height: 25px; flex: 1; border: 0; border-radius: 0;
      color: var(--fluxion-muted); background: transparent; font: inherit;
      font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .fluxion-workspace:hover { color: var(--fluxion-ink); }
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
    .fluxion-tab:hover { background: var(--fluxion-hover); color: var(--fluxion-ink); }
    .fluxion-tab[aria-selected="true"] { color: var(--fluxion-ink); background: var(--fluxion-selected); }
    .fluxion-tab[aria-selected="true"]::before {
      content: ""; position: absolute; inset-inline-start: 0; width: 2px; height: 14px;
      background: var(--fluxion-accent);
    }
    .fluxion-tab.is-closing { opacity: 0; transform: scaleY(.72); pointer-events: none; }
    .fluxion-tab.is-dragover::after {
      content: ""; position: absolute; inset: -2px 4px auto; height: 2px; background: var(--fluxion-accent);
    }
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
    #fluxion-flow[data-state="compact"] .fluxion-workspace { flex: none; width: 30px; }
    #fluxion-flow[data-state="compact"] .fluxion-tabs { padding-inline: 6px; }
    #fluxion-flow[data-state="compact"] .fluxion-tab { justify-content: center; padding: 0; }
    #fluxion-flow[data-state="compact"] .fluxion-footer { padding-inline: 7px; }
    #fluxion-flow[data-state="compact"] .fluxion-new-tab { flex: none; width: 30px; text-align: center; }
    @media (prefers-reduced-motion: reduce) {
      #fluxion-flow, .fluxion-tab { transition-duration: 0.01ms !important; }
    }
  `;
  document.documentElement.appendChild(style);

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
  workspaceBar.setAttribute("role", "tablist");
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
    tab.setAttribute(TAB_WORKSPACE, id);
    if (id !== currentWorkspace && tab === gBrowser.selectedTab) {
      const replacement = [...gBrowser.tabs].find(candidate => candidate !== tab && tabWorkspace(candidate) === currentWorkspace);
      if (replacement) gBrowser.selectedTab = replacement;
      else switchWorkspace(currentWorkspace);
    }
    switchWorkspace(currentWorkspace);
  }

  function cycleSidebar() {
    const index = SIDEBAR_STATES.indexOf(flow.dataset.state);
    const state = SIDEBAR_STATES[(index + 1) % SIDEBAR_STATES.length];
    flow.dataset.state = state;
    Services.prefs.setStringPref(PREF_SIDEBAR, state);
    modeButton.textContent = state === "expanded" ? "‹" : state === "compact" ? "·" : "›";
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
    item.tabIndex = 0;
    item.draggable = true;
    item.setAttribute("role", "tab");
    item.setAttribute("aria-selected", String(tab === gBrowser.selectedTab));
    item.title = `${tabLabel(tab)}\n${tab.linkedBrowser?.currentURI?.displaySpec || ""}`;

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

  function fallbackIcon() {
    const fallback = create("span", "fluxion-fallback");
    fallback.textContent = "·";
    return fallback;
  }

  function renderWorkspaces() {
    workspaceBar.replaceChildren();
    const colours = { slate: "#68747b", blue: "#51748a", ochre: "#92794d", sage: "#667c69", rose: "#8b646b" };
    for (const workspace of workspaces) {
      const button = create("button", "fluxion-workspace");
      button.type = "button";
      button.textContent = flow.dataset.state === "compact" ? workspace.name.slice(0, 1) : workspace.name;
      button.title = workspace.name;
      button.setAttribute("role", "tab");
      button.setAttribute("aria-pressed", String(workspace.id === currentWorkspace));
      button.style.setProperty("--workspace-accent", colours[workspace.accent]);
      button.addEventListener("click", () => switchWorkspace(workspace.id));
      workspaceBar.appendChild(button);
    }
  }

  function render() {
    renderQueued = false;
    renderWorkspaces();
    pinnedTabs.replaceChildren();
    tabsList.replaceChildren();
    const visible = [...gBrowser.tabs].filter(tab => tabWorkspace(tab) === currentWorkspace);
    for (const tab of visible) {
      (tab.pinned ? pinnedTabs : tabsList).appendChild(createTabElement(tab));
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

  const contextMenu = xul("menupopup", { id: "fluxion-tab-context" });
  const menuAction = (label, action) => {
    const item = xul("menuitem", { label });
    item.addEventListener("command", () => contextTab && action(contextTab));
    contextMenu.appendChild(item);
  };
  menuAction("Duplicate Tab", tab => gBrowser.duplicateTab(tab));
  menuAction("Reload Tab", tab => tab.linkedBrowser.reload());
  menuAction("Pin / Unpin Tab", tab => tab.pinned ? gBrowser.unpinTab(tab) : gBrowser.pinTab(tab));
  contextMenu.appendChild(xul("menuseparator"));
  for (const workspace of workspaces) {
    menuAction(`Move to ${workspace.name}`, tab => moveTabToWorkspace(tab, workspace.id));
  }
  contextMenu.appendChild(xul("menuseparator"));
  menuAction("Close Tab", tab => gBrowser.removeTab(tab));
  document.getElementById("mainPopupSet").appendChild(contextMenu);

  on(modeButton, "click", cycleSidebar);
  on(flow, "click", event => {
    if (flow.dataset.state === "focus" && event.target === flow) cycleSidebar();
  });
  on(newTabButton, "click", () => {
    openWorkspaceTab();
  });
  for (const eventName of ["TabOpen", "TabClose", "TabSelect", "TabMove", "TabPinned", "TabUnpinned", "TabAttrModified"]) {
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
    cycleSidebar,
    currentWorkspace: () => currentWorkspace,
    moveTabToWorkspace,
    newTab: openWorkspaceTab,
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
  Services.prefs.setStringPref("fluxion.chrome.health", "flow-sidebar-loaded");
  Services.prefs.savePrefFile(null);
})(window);
