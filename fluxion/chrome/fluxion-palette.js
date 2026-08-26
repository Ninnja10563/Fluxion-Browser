/* global gBrowser, Services, SessionStore, FluxionSearch, FluxionUrl, ChromeUtils, Ci, Cu */
(function initialiseFluxionPalette(window) {
  "use strict";

  if (!window.FluxionUI || window.document.getElementById("fluxion-palette-layer")) return;

  const { document } = window;
  const HTML = "http://www.w3.org/1999/xhtml";
  const cleanup = [];
  const ui = window.FluxionUI;
  const { PlacesUtils } = ChromeUtils.importESModule(
    "resource://gre/modules/PlacesUtils.sys.mjs"
  );
  const { PrivateBrowsingUtils } = ChromeUtils.importESModule(
    "resource://gre/modules/PrivateBrowsingUtils.sys.mjs"
  );
  let activeIndex = 0;
  let visibleItems = [];
  let lastFocus = null;
  let mode = "all";
  let placesTimer = 0;

  const create = (tag, className) => {
    const element = document.createElementNS(HTML, tag);
    if (className) element.className = className;
    return element;
  };
  const on = (target, type, listener, options) => {
    target.addEventListener(type, listener, options);
    cleanup.push(() => target.removeEventListener(type, listener, options));
  };

  const style = create("style");
  style.id = "fluxion-palette-style";
  style.textContent = `
    #fluxion-palette-layer[hidden] { display: none !important; }
    #fluxion-palette-layer {
      position: fixed; inset: 0; z-index: 2147483646;
      display: flex; justify-content: center; align-items: flex-start;
      padding-top: clamp(62px, 10vh, 104px);
      background: transparent; color: var(--fluxion-ink);
    }
    #fluxion-palette {
      width: min(560px, calc(100vw - 36px)); max-height: min(470px, calc(100vh - 96px));
      display: flex; flex-direction: column; overflow: hidden;
      border: 1px solid var(--fluxion-line); border-radius: 6px;
      background: var(--fluxion-bg-raised); box-shadow: 0 8px 24px rgba(0,0,0,.18);
      animation: fluxion-palette-in 100ms ease-out;
      font: menu; font-size: 13px;
    }
    .fluxion-palette-input-row {
      height: 44px; display: flex; align-items: center; gap: 9px;
      padding: 0 12px; border-bottom: 1px solid var(--fluxion-line);
    }
    .fluxion-palette-glyph { width: 15px; height: 15px; color: var(--fluxion-muted); }
    #fluxion-palette-input {
      min-width: 0; flex: 1; border: 0; outline: 0; padding: 0;
      color: var(--fluxion-ink); background: transparent; font: inherit; font-size: 14px;
    }
    #fluxion-palette-input::placeholder { color: var(--fluxion-muted); opacity: .8; }
    #fluxion-palette-results { overflow-y: auto; padding: 4px; }
    .fluxion-palette-result {
      width: 100%; min-height: 38px; display: grid;
      grid-template-columns: minmax(0, 1fr) auto; align-items: center; column-gap: 14px;
      border: 0; border-radius: 3px; padding: 5px 8px; text-align: start;
      color: var(--fluxion-ink); background: transparent; font: inherit;
    }
    .fluxion-palette-result[aria-selected="true"] { background: var(--fluxion-selected); }
    .fluxion-palette-result-main { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .fluxion-palette-result-label,
    .fluxion-palette-result-detail { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .fluxion-palette-result-detail { color: var(--fluxion-muted); font-size: 11px; }
    .fluxion-palette-result-kind {
      color: var(--fluxion-muted); font-size: 10px; letter-spacing: .035em;
      text-transform: uppercase;
    }
    .fluxion-palette-empty { padding: 24px 14px; color: var(--fluxion-muted); text-align: center; }
    @keyframes fluxion-palette-in {
      from { opacity: 0; transform: translateY(-2px); }
    }
    @media (prefers-reduced-motion: reduce) {
      #fluxion-palette { animation: none; }
    }
  `;
  document.documentElement.appendChild(style);

  const layer = create("div");
  layer.id = "fluxion-palette-layer";
  layer.hidden = true;
  const palette = create("div");
  palette.id = "fluxion-palette";
  palette.setAttribute("role", "dialog");
  palette.setAttribute("aria-modal", "true");
  palette.setAttribute("aria-label", "Fluxion command palette");
  const inputRow = create("div", "fluxion-palette-input-row");
  const glyph = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  glyph.setAttribute("class", "fluxion-palette-glyph");
  glyph.setAttribute("viewBox", "0 0 16 16");
  glyph.setAttribute("fill", "none");
  glyph.setAttribute("aria-hidden", "true");
  const glyphCircle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  glyphCircle.setAttribute("cx", "6.5");
  glyphCircle.setAttribute("cy", "6.5");
  glyphCircle.setAttribute("r", "4.25");
  glyphCircle.setAttribute("stroke", "currentColor");
  glyphCircle.setAttribute("stroke-width", "1.25");
  const glyphLine = document.createElementNS("http://www.w3.org/2000/svg", "path");
  glyphLine.setAttribute("d", "m10 10 3.25 3.25");
  glyphLine.setAttribute("stroke", "currentColor");
  glyphLine.setAttribute("stroke-width", "1.25");
  glyphLine.setAttribute("stroke-linecap", "round");
  glyph.append(glyphCircle, glyphLine);
  const input = create("input");
  input.id = "fluxion-palette-input";
  input.type = "search";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("aria-controls", "fluxion-palette-results");
  input.setAttribute("aria-autocomplete", "list");
  const results = create("div");
  results.id = "fluxion-palette-results";
  results.setAttribute("role", "listbox");
  inputRow.append(glyph, input);
  palette.append(inputRow, results);
  layer.appendChild(palette);
  document.body.appendChild(layer);

  function openUrl(url) {
    const tab = gBrowser.addTrustedTab(url);
    tab.setAttribute("fluxion-workspace", ui.currentWorkspace());
    gBrowser.selectedTab = tab;
  }

  function commandItems() {
    const doCommand = id => document.getElementById(id)?.doCommand();
    return [
      {
        label: "New tab", detail: "Open a blank tab", kind: "Command", boost: 45,
        keywords: ["create page"], run: () => ui.newTab(),
      },
      {
        label: "New window", detail: "Open another Fluxion window", kind: "Command",
        keywords: ["browser window"], run: () => window.OpenBrowserWindow(),
      },
      {
        label: "New private window", detail: "Browse without saving local history", kind: "Command",
        keywords: ["incognito privacy"], run: () => window.OpenBrowserWindow({ private: true }),
      },
      {
        label: "Reopen closed tab", detail: "Restore the most recently closed tab", kind: "Command",
        keywords: ["undo close"], run: () => SessionStore.undoCloseTab(window, 0),
      },
      {
        label: "Duplicate current tab", detail: "Create a copy in this workspace", kind: "Command",
        keywords: ["copy page"], run: () => gBrowser.duplicateTab(gBrowser.selectedTab),
      },
      {
        label: "Close current tab", detail: "Close the selected tab", kind: "Command",
        keywords: ["remove page"], run: () => gBrowser.removeTab(gBrowser.selectedTab),
      },
      {
        label: "Toggle Flow sidebar", detail: "Cycle expanded, compact, and focus modes", kind: "Command",
        keywords: ["hide show collapse tabs"], run: () => ui.cycleSidebar(),
      },
      {
        label: "New workspace", detail: "Create a named space for a separate tab set", kind: "Command",
        keywords: ["add create workspace"], run: () => ui.addWorkspace(),
      },
      {
        label: "New tab group", detail: "Start a named group with the current tab", kind: "Command",
        keywords: ["add create organize tabs"], run: () => ui.createGroup(),
      },
      {
        label: "Open downloads", detail: "View current and completed downloads", kind: "Command",
        keywords: ["download manager files"], run: () => openUrl("about:downloads"),
      },
      {
        label: "Open settings", detail: "Change Fluxion and Gecko preferences", kind: "Command",
        keywords: ["preferences options"], run: () => openUrl("about:preferences"),
      },
      {
        label: "About Fluxion", detail: "Version, engine, privacy, and source information", kind: "Command",
        keywords: ["version gecko license"],
        run: () => openUrl(Services.prefs.getStringPref("fluxion.about.url", "about:support")),
      },
      {
        label: "Privacy settings", detail: "History, cookies, permissions, and browsing data", kind: "Command",
        keywords: ["clear browsing data delete history"], run: () => openUrl("about:preferences#privacy"),
      },
      {
        label: "Open bookmarks", detail: "Manage saved pages and folders", kind: "Command",
        keywords: ["library favourites favorites"],
        run: () => window.PlacesCommandHook?.showPlacesOrganizer("AllBookmarks"),
      },
      {
        label: "Open history", detail: "Review previously visited pages", kind: "Command",
        keywords: ["library recent pages"],
        run: () => window.PlacesCommandHook?.showPlacesOrganizer("History"),
      },
      {
        label: "Toggle fullscreen", detail: "Enter or leave fullscreen browsing", kind: "Command",
        keywords: ["full screen"], run: () => doCommand("View:FullScreen"),
      },
      {
        label: "Developer tools", detail: "Inspect the current page", kind: "Command",
        keywords: ["devtools inspector console"], run: () => doCommand("Tools:DevToolbox"),
      },
    ];
  }

  function tabItems() {
    return [...gBrowser.tabs].map(tab => ({
      label: tab.label || "New tab",
      detail: tab.linkedBrowser?.currentURI?.displaySpec || "",
      kind: "Tab",
      boost: tab === gBrowser.selectedTab ? 18 : 0,
      keywords: [ui.tabWorkspace(tab), tab.group?.label || ""],
      run: () => ui.selectTab(tab),
    }));
  }

  function workspaceItems() {
    const current = ui.currentWorkspace();
    const items = [];
    for (const workspace of ui.workspaces()) {
      items.push({
        label: `Switch to ${workspace.name}`,
        detail: workspace.id === current ? "Current workspace" : "Workspace",
        kind: "Workspace",
        boost: workspace.id === current ? 8 : 0,
        keywords: [workspace.name, workspace.id, "workspace"],
        run: () => ui.switchWorkspace(workspace.id),
      });
      if (workspace.id !== current) {
        items.push({
          label: `Move current tab to ${workspace.name}`,
          detail: "Keep the page open in another workspace",
          kind: "Workspace",
          keywords: [workspace.name, "move tab"],
          run: () => ui.moveTabToWorkspace(gBrowser.selectedTab, workspace.id),
        });
      }
    }
    return items;
  }

  function placeItems(search, onlyBookmarked) {
    if (search.length < 2) return [];
    if (!onlyBookmarked && PrivateBrowsingUtils.isWindowPrivate(window)) return [];
    try {
      const query = PlacesUtils.history.getNewQuery();
      query.searchTerms = search;
      query.onlyBookmarked = onlyBookmarked;
      const options = PlacesUtils.history.getNewQueryOptions();
      options.maxResults = 8;
      options.resultType = Ci.nsINavHistoryQueryOptions.RESULTS_AS_URI;
      options.sortingMode = Ci.nsINavHistoryQueryOptions.SORT_BY_FRECENCY_DESCENDING;
      const result = PlacesUtils.history.executeQuery(query, options);
      const root = result.root;
      const items = [];
      root.containerOpen = true;
      try {
        for (let index = 0; index < root.childCount; index += 1) {
          const node = root.getChild(index);
          if (!node.uri) continue;
          items.push({
            label: node.title || node.uri,
            detail: node.uri,
            kind: onlyBookmarked ? "Bookmark" : "History",
            boost: onlyBookmarked ? 5 : 0,
            keywords: [node.uri],
            run: () => openUrl(node.uri),
          });
        }
      } finally {
        root.containerOpen = false;
      }
      return items;
    } catch (error) {
      Cu.reportError(error);
      return [];
    }
  }

  function allItems(search, includePlaces) {
    if (mode === "tabs") return tabItems();
    const items = [...commandItems(), ...tabItems(), ...workspaceItems()];
    if (includePlaces) {
      const seen = new Set();
      for (const item of [...placeItems(search, true), ...placeItems(search, false)]) {
        if (seen.has(item.detail)) continue;
        seen.add(item.detail);
        items.push(item);
      }
    }
    if (search) {
      const destination = FluxionUrl.resolveNavigation(search);
      const isSearch = destination.startsWith("https://duckduckgo.com/?q=");
      items.push({
        label: isSearch ? `Search the web for “${search}”` : `Open ${search}`,
        detail: destination,
        kind: isSearch ? "Search" : "Address",
        boost: -40,
        keywords: [search],
        run: () => openUrl(destination),
      });
    }
    return items;
  }

  function choose(index = activeIndex) {
    const item = visibleItems[index];
    if (!item) return;
    close();
    try {
      item.run();
    } catch (error) {
      Cu.reportError(error);
    }
  }

  function setActive(index) {
    if (!visibleItems.length) {
      activeIndex = 0;
      return;
    }
    activeIndex = (index + visibleItems.length) % visibleItems.length;
    [...results.children].forEach((element, resultIndex) => {
      const selected = resultIndex === activeIndex;
      element.setAttribute("aria-selected", String(selected));
      if (selected) {
        input.setAttribute("aria-activedescendant", element.id);
        element.scrollIntoView({ block: "nearest" });
      }
    });
  }

  function render(includePlaces = false) {
    const search = input.value.trim();
    visibleItems = FluxionSearch.rankSearchItems(search, allItems(search, includePlaces), 12);
    activeIndex = Math.min(activeIndex, Math.max(visibleItems.length - 1, 0));
    results.replaceChildren();
    if (!visibleItems.length) {
      const empty = create("div", "fluxion-palette-empty");
      empty.textContent = mode === "tabs" ? "No matching open tabs" : "No matching command or page";
      results.appendChild(empty);
      input.removeAttribute("aria-activedescendant");
      return;
    }
    visibleItems.forEach((item, index) => {
      const button = create("button", "fluxion-palette-result");
      button.type = "button";
      button.id = `fluxion-palette-result-${index}`;
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", String(index === activeIndex));
      const main = create("span", "fluxion-palette-result-main");
      const label = create("span", "fluxion-palette-result-label");
      label.textContent = item.label;
      const detail = create("span", "fluxion-palette-result-detail");
      detail.textContent = item.detail || "";
      const kind = create("span", "fluxion-palette-result-kind");
      kind.textContent = item.kind || "";
      main.append(label, detail);
      button.append(main, kind);
      button.addEventListener("pointermove", () => setActive(index));
      button.addEventListener("click", () => choose(index));
      results.appendChild(button);
    });
    setActive(activeIndex);
  }

  function queuePlaces() {
    window.clearTimeout(placesTimer);
    render(false);
    if (mode === "all" && input.value.trim().length >= 2) {
      placesTimer = window.setTimeout(() => render(true), 80);
    }
  }

  function open(nextMode = "all") {
    mode = nextMode;
    lastFocus = document.activeElement;
    layer.hidden = false;
    input.value = "";
    input.placeholder = mode === "tabs" ? "Search open tabs" : "Search commands, tabs, history, and bookmarks";
    activeIndex = 0;
    render(false);
    window.requestAnimationFrame(() => input.focus());
  }

  function close() {
    window.clearTimeout(placesTimer);
    layer.hidden = true;
    input.value = "";
    if (lastFocus?.isConnected) lastFocus.focus();
    lastFocus = null;
  }

  on(input, "input", queuePlaces);
  on(input, "keydown", event => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActive(activeIndex + (event.key === "ArrowDown" ? 1 : -1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose();
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  });
  on(layer, "mousedown", event => {
    if (event.target === layer) close();
  });
  on(window, "keydown", event => {
    const accelerator = window.navigator.platform.includes("Mac") ? event.metaKey : event.ctrlKey;
    if (!accelerator || event.altKey) return;
    if (event.code === "KeyK" && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      layer.hidden ? open("all") : close();
    } else if (event.code === "KeyA" && event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      open("tabs");
    } else if (!layer.hidden && event.key === "Escape") {
      event.preventDefault();
      close();
    }
  }, true);
  on(window, "unload", () => {
    window.clearTimeout(placesTimer);
    while (cleanup.length) cleanup.pop()();
    layer.remove();
    style.remove();
  }, { once: true });
  Services.prefs.setStringPref("fluxion.palette.health", "command-palette-loaded");
  Services.prefs.savePrefFile(null);
})(window);
