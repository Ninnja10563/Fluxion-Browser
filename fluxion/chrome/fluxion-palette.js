/* global gBrowser, Services, FluxionSearch, FluxionTabOrganisation, FluxionUrl, ChromeUtils, Ci, Cu */
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
  let splitSource = null;
  let pendingSplitOrientation = window.FluxionSplitViews.SIDE_BY_SIDE;
  let askBrowser = null;
  let compareBrowsers = [];
  let askController = null;
  let aiRequest = 0;
  let placesTimer = 0;
  let memoryRequest = 0;

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
      width: min(590px, calc(100vw - 36px)); max-height: min(540px, calc(100vh - 96px));
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
    #fluxion-palette-status {
      min-height: 25px; display: flex; align-items: center; padding: 4px 12px;
      border-bottom: 1px solid var(--fluxion-line); color: var(--fluxion-muted);
      font-size: 10.5px; letter-spacing: .01em;
    }
    #fluxion-palette-status[hidden] { display: none !important; }
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
    .fluxion-palette-result-evidence {
      display: -webkit-box; overflow: hidden; margin-top: 2px;
      color: color-mix(in srgb, var(--fluxion-ink) 72%, transparent); font-size: 11px;
      line-height: 1.35; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
    }
    .fluxion-palette-result-kind {
      color: var(--fluxion-muted); font-size: 10px; letter-spacing: .035em;
      text-transform: uppercase;
    }
    .fluxion-palette-empty { padding: 24px 14px; color: var(--fluxion-muted); text-align: center; }
    .fluxion-memory-answer {
      padding: 11px 12px 10px; border-bottom: 1px solid var(--fluxion-line);
      color: var(--fluxion-ink); line-height: 1.4;
    }
    .fluxion-memory-answer-label {
      display: block; margin-bottom: 3px; color: var(--fluxion-muted);
      font-size: 9.5px; font-weight: 600; letter-spacing: .07em; text-transform: uppercase;
    }
    .fluxion-memory-answer-text { font-size: 12.5px; }
    .fluxion-memory-answer-note { margin-top: 4px; color: var(--fluxion-muted); font-size: 10.5px; }
    .fluxion-ai-answer-text { white-space: pre-wrap; font-size: 12.5px; line-height: 1.5; }
    .fluxion-ai-source {
      margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--fluxion-line);
      color: var(--fluxion-muted); font-size: 10.5px; line-height: 1.4; white-space: pre-wrap;
    }
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
  const status = create("div");
  status.id = "fluxion-palette-status";
  status.hidden = true;
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  inputRow.append(glyph, input);
  palette.append(inputRow, status, results);
  layer.appendChild(palette);
  document.body.appendChild(layer);

  function openUrl(url) {
    const tab = gBrowser.addTrustedTab(url);
    ui.setTabWorkspace(tab, ui.currentWorkspace());
    gBrowser.selectedTab = tab;
  }

  function organisationSuggestion() {
    const records = [...gBrowser.tabs]
      .filter(tab => ui.tabWorkspace(tab) === ui.currentWorkspace())
      .map(tab => {
        const url = tab.linkedBrowser?.currentURI?.spec || "";
        let hostname = "";
        try { hostname = new URL(url).hostname; } catch (_) {}
        return {
          tab,
          title: tab.label || tab.getAttribute("label") || "",
          hostname,
          url,
          pinned: tab.pinned,
          grouped: Boolean(tab.group),
          split: Boolean(tab.splitview),
        };
      });
    return FluxionTabOrganisation.suggestGroup(records);
  }

  function applyOrganisationSuggestion(suggestion) {
    if (!suggestion?.records?.length) return;
    const tabs = suggestion.records.map(record => record.tab).filter(tab => tab?.parentNode);
    if (tabs.length < 3) return;
    const preview = tabs.map(tab => `• ${tab.label || "Untitled page"}`).join("\n");
    const accepted = Services.prompt.confirm(
      window,
      "Group Related Tabs",
      `Group these ${tabs.length} tabs as “${suggestion.name}”?\n\n${preview}`,
    );
    if (accepted) ui.createSuggestedGroup(tabs, suggestion.name);
  }

  function commandItems() {
    const items = [
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
        label: "Open downloads", detail: "View current and completed downloads in Fluxion Library", kind: "Command",
        keywords: ["download manager files library"], run: () => window.FluxionLibrary?.open("downloads"),
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
        keywords: ["privacy permissions history cookies"], run: () => openUrl("about:preferences#privacy"),
      },
      {
        label: "Clear browsing data…", detail: "Choose data and time range in Gecko’s native privacy dialog", kind: "Command",
        keywords: ["delete history cookies cache downloads form logins site data"],
        run: () => window.FluxionDataClearing.open(),
      },
      {
        label: "Site permissions", detail: "Review saved camera, microphone, location, and notification decisions", kind: "Command",
        keywords: ["permissions allow block reset sites"], run: () => openUrl("about:preferences?fluxion=permissions"),
      },
      {
        label: "Open bookmarks", detail: "Search and manage saved pages in Fluxion Library", kind: "Command",
        keywords: ["library favourites favorites"],
        run: () => window.FluxionLibrary?.open("bookmarks"),
      },
      {
        label: "Open history", detail: "Review visited pages in Fluxion Library", kind: "Command",
        keywords: ["library recent pages"],
        run: () => window.FluxionLibrary?.open("history"),
      },
    ];
    const settingsDestinations = [
      ["Appearance settings", "Theme, Flow sidebar, density, and interface motion", "appearance", ["dark light system compact focus"]],
      ["Tab settings", "Sleeping, close confirmation, and new-tab focus", "tabs", ["sleep inactive background quit"]],
      ["Workspace settings", "Create, rename, reorder, and style workspaces", "workspaces", ["spaces flow symbol accent delete"]],
      ["Search & Memory settings", "Semantic history, ranking, and excluded domains", "search", ["browser memory embeddings exclusions"]],
      ["AI settings", "Optional local or OpenAI-compatible page tools", "ai", ["ollama lm studio endpoint model"]],
      ["Keyboard settings", "View and edit Fluxion shortcuts", "keyboard", ["hotkeys commands keys"]],
    ];
    for (const [label, detail, route, keywords] of settingsDestinations) {
      items.push({
        label, detail, kind: "Setting", keywords, boost: -12,
        run: () => openUrl(`about:preferences?fluxion=${encodeURIComponent(route)}`),
      });
    }
    const currentTheme = window.FluxionTheme?.current();
    for (const [choice, label] of [["system", "Follow System Appearance"], ["light", "Use Light Appearance"], ["dark", "Use Dark Appearance"]]) {
      if (!window.FluxionTheme || choice === currentTheme) continue;
      items.push({
        label,
        detail: "Switch Fluxion and native Gecko chrome immediately",
        kind: "Appearance",
        keywords: ["theme colour color mode"],
        boost: -12,
        run: () => window.FluxionTheme.set(choice),
      });
    }
    const nativePageCommands = [
      ["Find in Page", "Search text in the current page", "cmd_find", ["find search text"]],
      ["Bookmark This Page", "Save the current page to Gecko bookmarks", "Browser:AddBookmarkAs", ["save favorite favourite"]],
      ["Save Page As", "Save the current page with Gecko's file dialog", "Browser:SavePage", ["download page file"]],
      ["Print", "Print the current page with Gecko's native dialog", "cmd_print", ["printer pdf"]],
      ["Zoom Out", "Reduce the current page zoom", "cmd_fullZoomReduce", ["smaller page"]],
      ["Actual Size", "Reset the current page to 100%", "cmd_fullZoomReset", ["zoom reset 100"]],
      ["Zoom In", "Increase the current page zoom", "cmd_fullZoomEnlarge", ["larger page"]],
      ["Toggle Full Screen", "Enter or leave fullscreen browsing", "View:FullScreen", ["fullscreen"]],
      ["Extensions & Themes", "Manage Firefox-compatible WebExtensions", "Tools:Addons", ["addons add-ons themes"]],
    ];
    for (const [label, detail, command, keywords] of nativePageCommands) {
      if (!ui.nativeCommandAvailable(command)) continue;
      items.push({
        label, detail, kind: "Page", keywords,
        run: () => ui.runNativeCommand(command),
      });
    }
    if (ui.developerToolsAvailable()) {
      items.push({
        label: "Developer Tools", detail: "Inspect the current page with Gecko DevTools", kind: "Page",
        keywords: ["devtools inspector console"], run: () => ui.openDeveloperTools(),
      });
    }
    const recoverableTabs = ui.closedTabs();
    if (recoverableTabs.length) {
      items.splice(3, 0, {
        label: "Reopen Last Closed Tab",
        detail: recoverableTabs[0].title,
        kind: "Recovery",
        keywords: ["undo close restore"],
        run: () => ui.reopenClosedTab(recoverableTabs[0].sourceIndex),
      });
      for (const row of recoverableTabs.slice(0, 10)) {
        items.push({
          label: `Reopen ${row.title}`,
          detail: row.url,
          kind: "Closed Tab",
          keywords: ["undo close restore", row.title, row.url],
          run: () => ui.reopenClosedTab(row.sourceIndex),
        });
      }
    }
    const selectedTab = gBrowser.selectedTab;
    const privateWindow = PrivateBrowsingUtils.isWindowPrivate(window);
    const aiConfig = window.FluxionAI?.config();
    const suggestion = organisationSuggestion();
    if (suggestion) {
      items.splice(9, 0, {
        label: "Suggest tab group",
        detail: `Group ${suggestion.records.length} related tabs as “${suggestion.name}”`,
        kind: "Tabs",
        boost: 8,
        keywords: ["organise organize cluster related tabs", suggestion.name],
        run: () => applyOrganisationSuggestion(suggestion),
      });
    }
    items.splice(9, 0, {
      label: "Ask Current Page",
      detail: aiConfig?.provider === "disabled"
        ? "Configure an optional AI provider first"
        : `Use ${aiConfig.provider} with extracted page text`,
      kind: "AI",
      keywords: ["question summarize explain current page local ollama"],
      run: () => aiConfig?.provider === "disabled"
        ? openUrl("about:preferences?fluxion=ai")
        : open("ask", gBrowser.selectedBrowser),
    });
    if (gBrowser.selectedTabs.length >= 2) {
      const comparisonTabs = [...gBrowser.selectedTabs]
        .filter(tab => tab.linkedBrowser)
        .slice(0, 4);
      items.splice(10, 0, {
        label: "Compare Selected Pages",
        detail: aiConfig?.provider === "disabled"
          ? "Configure an optional AI provider first"
          : `Compare ${comparisonTabs.length} explicitly selected tabs`,
        kind: "AI",
        keywords: ["compare pages tabs selected differences similarities"],
        run: () => aiConfig?.provider === "disabled"
          ? openUrl("about:preferences?fluxion=ai")
          : open("compare", comparisonTabs),
      });
    }
    if (!privateWindow && window.FluxionMemory.enabled()) {
      items.splice(9, 0,
        {
          label: "Search Browser Memory", detail: "Rediscover pages with local hybrid search", kind: "Memory",
          boost: 12, keywords: ["semantic history remember visited page"], run: () => open("memory"),
        },
        {
          label: "Exclude this site from Browser Memory", detail: "Remove this domain from local semantic results", kind: "Privacy",
          keywords: ["semantic history domain private"], run: async () => {
            const url = gBrowser.selectedBrowser?.currentURI?.spec;
            if (!url || !/^https?:/i.test(url)) return;
            const domain = new URL(url).hostname;
            if (Services.prompt.confirm(window, "Exclude from Browser Memory", `Exclude ${domain} and its subdomains from Browser Memory?`)) {
              await window.FluxionMemory.excludeDomain(domain);
            }
          },
        },
        {
          label: "Clear Browser Memory", detail: "Delete local vectors and turn memory off", kind: "Privacy",
          keywords: ["semantic history erase delete disable"], run: async () => {
            if (Services.prompt.confirm(window, "Clear Browser Memory", "Delete Fluxion’s local semantic index and turn Browser Memory off? Browsing history itself will not be deleted.")) {
              await window.FluxionMemory.clearAndDisable();
            }
          },
        },
      );
    } else if (!privateWindow) {
      items.splice(9, 0, {
        label: "Enable Browser Memory", detail: "Build a private semantic index on this Mac", kind: "Memory",
        keywords: ["semantic history local embeddings remember"], run: async () => {
          const accepted = Services.prompt.confirm(
            window,
            "Enable Browser Memory",
            "Fluxion will download a local embedding model and build an index from non-private browsing history. Page addresses and history are not sent to an AI provider. Continue?",
          );
          if (accepted && await window.FluxionMemory.enable()) open("memory");
        },
      });
    }
    if (selectedTab?.splitview) {
      const stacked = ui.splitOrientation(selectedTab) === window.FluxionSplitViews.STACKED;
      items.splice(9, 0,
        {
          label: stacked ? "Swap top and bottom" : "Swap left and right",
          detail: "Reverse the two pages", kind: "Command",
          keywords: ["split view reverse panes"], run: () => ui.reverseSplitView(selectedTab),
        },
        {
          label: stacked ? "Place split side by side" : "Stack split vertically",
          detail: stacked ? "Arrange the pages in two columns" : "Arrange the pages in two rows",
          kind: "Command", keywords: ["split view orientation horizontal vertical stacked"],
          run: () => ui.toggleSplitOrientation(selectedTab),
        },
        {
          label: "Separate split view", detail: "Return both pages to ordinary tabs", kind: "Command",
          keywords: ["split view exit unsplit panes"], run: () => ui.separateSplitView(selectedTab),
        },
      );
    } else if (selectedTab && !selectedTab.pinned) {
      items.splice(9, 0,
        {
          label: "Open split side by side", detail: "Choose an open tab for the right pane", kind: "Command",
          keywords: ["split view columns two panes"],
          run: () => openSplitPicker(selectedTab, window.FluxionSplitViews.SIDE_BY_SIDE),
        },
        {
          label: "Open stacked split", detail: "Choose an open tab for the bottom pane", kind: "Command",
          keywords: ["split view rows vertical two panes"],
          run: () => openSplitPicker(selectedTab, window.FluxionSplitViews.STACKED),
        },
        {
          label: "New page side by side", detail: "Open a blank page in the right pane", kind: "Command",
          keywords: ["split view columns two panes"],
          run: () => ui.openNewSplit(selectedTab, window.FluxionSplitViews.SIDE_BY_SIDE),
        },
        {
          label: "New page stacked", detail: "Open a blank page in the bottom pane", kind: "Command",
          keywords: ["split view rows vertical two panes"],
          run: () => ui.openNewSplit(selectedTab, window.FluxionSplitViews.STACKED),
        },
      );
    }
    return items;
  }

  function tabItems() {
    const source = splitSource;
    const tabs = mode === "split"
      ? [...gBrowser.tabs].filter(tab =>
          ui.tabWorkspace(tab) === ui.currentWorkspace() &&
          window.FluxionSplitViews.canSplit(splitSource, tab)
        )
      : [...gBrowser.tabs];
    return tabs.map(tab => ({
      label: tab.label || "New tab",
      detail: tab.linkedBrowser?.currentURI?.displaySpec || "",
      kind: mode === "split" ? "Split" : "Tab",
      boost: tab === gBrowser.selectedTab ? 18 : 0,
      keywords: [ui.tabWorkspace(tab), tab.group?.label || ""],
      run: () => source
        ? ui.createSplitView(source, tab, { orientation: pendingSplitOrientation })
        : ui.selectTab(tab),
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
    if (mode === "tabs" || mode === "split") return tabItems();
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
      const route = FluxionUrl.classifyNavigation(search);
      if (route.kind === "search") {
        const engine = window.FluxionWebSearch.currentName();
        items.push({
          label: `Search ${engine} for “${search}”`,
          detail: "Uses the current Gecko search engine",
          kind: "Search",
          boost: -40,
          fallback: true,
          keywords: [search],
          run: () => window.FluxionWebSearch.open(route.value),
        });
      } else {
        items.push({
          label: `Open ${search}`,
          detail: route.value,
          kind: "Address",
          boost: -40,
          fallback: true,
          keywords: [search],
          run: () => openUrl(route.value),
        });
      }
    }
    return items;
  }

  function choose(index = activeIndex) {
    const item = visibleItems[index];
    if (!item) return;
    close();
    try { Promise.resolve(item.run()).catch(Cu.reportError); }
    catch (error) { Cu.reportError(error); }
  }

  function setActive(index) {
    if (!visibleItems.length) {
      activeIndex = 0;
      return;
    }
    activeIndex = (index + visibleItems.length) % visibleItems.length;
    [...results.querySelectorAll(".fluxion-palette-result")].forEach((element, resultIndex) => {
      const selected = resultIndex === activeIndex;
      element.setAttribute("aria-selected", String(selected));
      if (selected) {
        input.setAttribute("aria-activedescendant", element.id);
        element.scrollIntoView({ block: "nearest" });
      }
    });
  }

  function renderItems(items, emptyText, lead = null) {
    visibleItems = items;
    activeIndex = Math.min(activeIndex, Math.max(visibleItems.length - 1, 0));
    results.replaceChildren();
    if (lead) results.appendChild(lead);
    if (!visibleItems.length) {
      const empty = create("div", "fluxion-palette-empty");
      empty.textContent = emptyText;
      results.appendChild(empty);
      input.removeAttribute("aria-activedescendant");
      return;
    }
    visibleItems.forEach((item, index) => {
      const button = create("button", "fluxion-palette-result");
      button.type = "button";
      button.tabIndex = -1;
      button.id = `fluxion-palette-result-${index}`;
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", String(index === activeIndex));
      const main = create("span", "fluxion-palette-result-main");
      const label = create("span", "fluxion-palette-result-label");
      label.textContent = item.label;
      const detail = create("span", "fluxion-palette-result-detail");
      detail.textContent = item.detail || "";
      const evidence = create("span", "fluxion-palette-result-evidence");
      evidence.textContent = item.evidence || "";
      const kind = create("span", "fluxion-palette-result-kind");
      kind.textContent = item.kind || "";
      main.append(label, detail);
      if (item.evidence) main.appendChild(evidence);
      button.append(main, kind);
      button.addEventListener("pointermove", () => setActive(index));
      button.addEventListener("click", () => choose(index));
      results.appendChild(button);
    });
    setActive(activeIndex);
  }

  async function renderMemory() {
    const request = ++memoryRequest;
    const search = input.value.trim();
    status.hidden = false;
    status.textContent = window.FluxionMemory.enabled()
      ? "Local on this Mac · Private windows are never indexed"
      : "Browser Memory is off";
    if (search.length < 2) {
      renderItems([], "Describe a page you remember");
      return;
    }
    results.replaceChildren();
    const pending = create("div", "fluxion-palette-empty");
    pending.textContent = "Searching local Browser Memory…";
    results.appendChild(pending);
    const response = await window.FluxionMemory.search(search, ui.currentWorkspace());
    if (request !== memoryRequest || mode !== "memory" || input.value.trim() !== search) return;
    const stateLabels = {
      building: "Local index is building · Exact history matches are available now",
      lexical: "Local semantic model unavailable · Showing exact history matches",
      ready: "Hybrid match · Exact text, semantic similarity, recency, and workspace",
      disabled: "Browser Memory is off",
      private: "Browser Memory is unavailable in private windows",
    };
    status.textContent = stateLabels[response.state] || stateLabels.ready;
    const answer = create("div", "fluxion-memory-answer");
    answer.setAttribute("role", "status");
    const answerLabel = create("span", "fluxion-memory-answer-label");
    answerLabel.textContent = response.answer?.state === "grounded" ? "From your browsing evidence" : "Browser Memory";
    const answerText = create("div", "fluxion-memory-answer-text");
    answerText.textContent = response.answer?.text || "Nothing relevant was found in Browser Memory.";
    answer.append(answerLabel, answerText);
    if (response.answer?.state === "grounded") {
      const note = create("div", "fluxion-memory-answer-note");
      note.textContent = "Generated only from the local source records below";
      answer.appendChild(note);
    }
    const evidenceByUrl = new Map((response.answer?.evidence || []).map(item => [item.url, item]));
    const items = response.results.map(row => {
      const evidence = evidenceByUrl.get(row.url);
      return {
      label: row.title || row.url,
      detail: evidence
        ? `${evidence.domain} · ${evidence.visitLabel}${evidence.workspaceName ? ` · ${evidence.workspaceName}` : ""}`
        : row.url,
      evidence: evidence?.excerpt || "",
      kind: evidence?.reasons?.[0] || "Memory",
      run: () => openUrl(row.url),
      };
    });
    renderItems(items, "No source records support this memory", answer);
    if (
      Services.env.get("FLUXION_VISUAL_GROUNDING_TEST") === "1" &&
      response.answer?.state === "grounded" &&
      response.answer.evidence.some(item => item.excerpt)
    ) {
      Services.prefs.setStringPref("fluxion.memory.grounding.health", "grounded-evidence-visible");
      Services.prefs.savePrefFile(null);
      window.dispatchEvent(new window.CustomEvent("FluxionGroundingVisualReady"));
    }
  }

  function renderAskPrompt() {
    status.hidden = false;
    const current = window.FluxionAI?.config();
    status.textContent = current?.provider === "disabled"
      ? "AI is disabled · Configure a provider in Fluxion Settings"
      : `${current.provider} · Page text is shared only when you press Return`;
    renderItems([], mode === "compare"
      ? `Type what to compare across ${compareBrowsers.length} selected pages, then press Return`
      : "Type a question about the current page, then press Return");
  }

  async function runAsk() {
    const question = input.value.trim();
    if (question.length < 2) { renderAskPrompt(); return; }
    const request = ++aiRequest;
    askController?.abort();
    askController = new window.AbortController();
    visibleItems = [];
    results.replaceChildren();
    const pending = create("div", "fluxion-palette-empty");
    pending.textContent = mode === "compare"
      ? "Reading the selected pages and asking the configured provider…"
      : "Reading this page and asking the configured provider…";
    results.appendChild(pending);
    status.hidden = false;
    status.textContent = "Treating page content as untrusted data · Escape cancels";
    try {
      const answer = mode === "compare"
        ? await window.FluxionAI.comparePages(question, compareBrowsers, { signal: askController.signal })
        : await window.FluxionAI.askCurrentPage(question, askBrowser, { signal: askController.signal });
      if (request !== aiRequest || !["ask", "compare"].includes(mode)) return;
      const panel = create("div", "fluxion-memory-answer");
      const label = create("span", "fluxion-memory-answer-label");
      label.textContent = `Answer from ${answer.provider} · ${answer.model}`;
      const text = create("div", "fluxion-ai-answer-text");
      text.textContent = answer.text;
      const source = create("div", "fluxion-ai-source");
      const sources = answer.sources || [answer.source];
      source.textContent = sources.map((item, index) =>
        `${sources.length > 1 ? `Source ${index + 1}` : "Source"}: ${item.title} · ${item.url}\n${item.excerpt}`
      ).join("\n\n");
      panel.append(label, text, source);
      results.replaceChildren(panel);
      status.textContent = mode === "compare"
        ? "Selected-page comparison · Verify against each quoted source"
        : "Current-page answer · Verify against the quoted local source";
      if (Services.env.get("FLUXION_VISUAL_AI_TEST") === "1" && answer.source?.excerpt) {
        Services.prefs.setStringPref("fluxion.ai.visual.health", "current-page-answer-visible");
        Services.prefs.savePrefFile(null);
        window.dispatchEvent(new window.CustomEvent("FluxionAIVisualReady"));
      }
      if (
        Services.env.get("FLUXION_VISUAL_AI_COMPARE_TEST") === "1" &&
        sources.length >= 2 && sources.every(item => item.excerpt)
      ) {
        Services.prefs.setStringPref("fluxion.ai.compare.visual.health", "selected-pages-compared");
        Services.prefs.savePrefFile(null);
      }
    } catch (error) {
      if (request !== aiRequest || !["ask", "compare"].includes(mode)) return;
      renderItems([], error.message || "The AI provider could not answer");
      status.textContent = "No page content was retained by the provider layer";
      if (Services.env.get("FLUXION_VISUAL_AI_TEST") === "1") {
        Services.prefs.setStringPref("fluxion.ai.visual.error", String(error));
        Services.prefs.savePrefFile(null);
      }
    }
  }

  function render(includePlaces = false) {
    if (mode === "ask" || mode === "compare") {
      renderAskPrompt();
      return;
    }
    if (mode === "memory") {
      renderMemory().catch(error => {
        Cu.reportError(error);
        if (mode === "memory") renderItems([], "Browser Memory could not be searched");
      });
      return;
    }
    status.hidden = true;
    const search = input.value.trim();
    const items = FluxionSearch.rankSearchItems(search, allItems(search, includePlaces), 12);
    const emptyText = mode === "split"
      ? "No tabs are available for split view"
      : mode === "tabs" ? "No matching open tabs" : "No matching command or page";
    renderItems(items, emptyText);
  }

  function queuePlaces() {
    window.clearTimeout(placesTimer);
    if (mode === "ask" || mode === "compare") { renderAskPrompt(); return; }
    if (mode === "memory") {
      memoryRequest += 1;
      placesTimer = window.setTimeout(() => render(false), 140);
      return;
    }
    render(false);
    if (mode === "all" && input.value.trim().length >= 2) {
      placesTimer = window.setTimeout(() => render(true), 80);
    }
  }

  function open(nextMode = "all", sourceTab = null) {
    mode = nextMode;
    splitSource = nextMode === "split" ? sourceTab : null;
    askBrowser = nextMode === "ask"
      ? (sourceTab?.linkedBrowser || sourceTab || gBrowser.selectedBrowser)
      : null;
    compareBrowsers = nextMode === "compare"
      ? (Array.isArray(sourceTab) ? sourceTab : []).map(item => item?.linkedBrowser || item).filter(Boolean).slice(0, 4)
      : [];
    lastFocus = document.activeElement;
    layer.hidden = false;
    input.value = "";
    input.placeholder = mode === "split"
      ? pendingSplitOrientation === window.FluxionSplitViews.STACKED
        ? "Choose a tab for the bottom pane"
        : "Choose a tab for the right pane"
      : mode === "tabs" ? "Search open tabs"
        : mode === "memory" ? "What do you remember about the page?"
          : mode === "ask" ? "Ask a question about this page"
            : mode === "compare" ? "Compare the selected pages"
          : "Search commands, tabs, history, and bookmarks";
    activeIndex = 0;
    render(false);
    window.requestAnimationFrame(() => input.focus());
  }

  function openSplitPicker(sourceTab, orientation) {
    pendingSplitOrientation = window.FluxionSplitViews.normaliseOrientation(orientation);
    open("split", sourceTab);
  }

  function close() {
    window.clearTimeout(placesTimer);
    memoryRequest += 1;
    aiRequest += 1;
    askController?.abort();
    askController = null;
    layer.hidden = true;
    input.value = "";
    splitSource = null;
    pendingSplitOrientation = window.FluxionSplitViews.SIDE_BY_SIDE;
    askBrowser = null;
    compareBrowsers = [];
    if (lastFocus?.isConnected) lastFocus.focus();
    lastFocus = null;
  }

  on(input, "input", queuePlaces);
  on(input, "keydown", event => {
    if (event.key === "Tab") {
      event.preventDefault();
      input.focus();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActive(activeIndex + (event.key === "ArrowDown" ? 1 : -1));
    } else if (event.key === "Enter" && (mode === "ask" || mode === "compare")) {
      event.preventDefault();
      runAsk().catch(Cu.reportError);
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
    if (window.FluxionShortcuts?.matches(event, "palette")) {
      event.preventDefault();
      event.stopPropagation();
      layer.hidden ? open("all") : close();
    } else if (window.FluxionShortcuts?.matches(event, "tabSearch")) {
      event.preventDefault();
      event.stopPropagation();
      open("tabs");
    } else if (!layer.hidden && event.key === "Escape") {
      event.preventDefault();
      close();
    }
  }, true);
  on(window, "FluxionSearchEngineChanged", () => {
    if (!layer.hidden && !["ask", "compare", "memory"].includes(mode)) render(false);
  });
  on(window, "unload", () => {
    window.clearTimeout(placesTimer);
    while (cleanup.length) cleanup.pop()();
    layer.remove();
    style.remove();
  }, { once: true });
  window.FluxionPalette = Object.freeze({ close, open });
  if (Services.env.get("FLUXION_VISUAL_PALETTE_COMMAND_TEST") === "1") {
    window.setTimeout(() => {
      const previousTab = gBrowser.selectedTab;
      const ordinaryTab = [...gBrowser.tabs].find(tab =>
        /^https:\/\/example\.com\//.test(tab.linkedBrowser?.currentURI?.spec || "")
      );
      if (ordinaryTab) ui.selectTab(ordinaryTab);
      const runPaletteCommandGate = (attempt = 0) => {
        if (!ui.nativeCommandAvailable("cmd_find") && attempt < 40) {
          window.setTimeout(() => runPaletteCommandGate(attempt + 1), 250);
          return;
        }
        const labels = new Set(commandItems().map(item => item.label));
        const required = [
          "Find in Page", "Bookmark This Page", "Save Page As", "Print", "Zoom In",
          "Toggle Full Screen", "Extensions & Themes", "Developer Tools",
        ];
        open("all");
        input.value = "zoom in";
        render(false);
        const zoomInIndex = visibleItems.findIndex(item => item.label === "Zoom In");
        const selectedDefault = zoomInIndex === 0;
        const before = window.ZoomManager.zoom;
        if (selectedDefault) {
          input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        }
        window.requestAnimationFrame(() => {
          const enlarged = window.ZoomManager.zoom > before && layer.hidden;
          open("all");
          input.value = "actual size";
          render(false);
          const resetIndex = visibleItems.findIndex(item => item.label === "Actual Size");
          if (resetIndex >= 0) {
            setActive(resetIndex);
            input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
          }
          window.requestAnimationFrame(() => {
            const reset = Math.abs(window.ZoomManager.zoom - 1) < 0.001 && layer.hidden;
            const complete = required.every(label => labels.has(label));
            if (previousTab?.parentNode) ui.selectTab(previousTab);
            open("all");
            input.value = "zoom";
            render(false);
            if (
              complete && selectedDefault && enlarged && reset &&
              visibleItems[0]?.label === "Zoom In"
            ) {
              Services.prefs.setStringPref(
                "fluxion.paletteCommands.health",
                "native-page-commands-listed-and-keyboard-zoom-round-tripped",
              );
              window.dispatchEvent(new window.CustomEvent("FluxionPaletteCommandsVisualReady"));
            } else {
              Services.prefs.setStringPref(
                "fluxion.paletteCommands.visual.error",
                `complete=${complete} selected=${selectedDefault} enlarged=${enlarged} reset=${reset} ` +
                  `missing=${required.filter(label => !labels.has(label)).join("|")}`,
              );
            }
            Services.prefs.savePrefFile(null);
          });
        });
      };
      runPaletteCommandGate();
    }, 32000);
  }
  if (Services.env.get("FLUXION_VISUAL_CLOSED_TABS_TEST") === "1") {
    const runClosedTabsGate = () => {
      const workspace = ui.currentWorkspace();
      const fixtureURL = "https://example.net/?fluxion-closed-tabs=1";
      const fixture = gBrowser.addTrustedTab(fixtureURL, { skipAnimation: true });
      ui.setTabWorkspace(fixture, workspace);
      ui.selectTab(fixture);
      window.setTimeout(() => {
        fixture.setAttribute("label", "Recoverable Reference");
        gBrowser.removeTab(fixture, { animate: false });
        const waitForClosed = (attempt = 0) => {
          const row = ui.closedTabs().find(item => item.url === fixtureURL);
          if (!row && attempt < 40) {
            window.setTimeout(() => waitForClosed(attempt + 1), 100);
            return;
          }
          const popup = document.getElementById("fluxion-toolbar-recently-closed-popup");
          popup?.dispatchEvent(new window.Event("popupshowing", { bubbles: true }));
          const nativeItem = popup?.querySelector(
            `[data-fluxion-closed-index="${row?.sourceIndex ?? -1}"]`,
          );
          open("all");
          input.value = "reopen Recoverable Reference";
          render(false);
          const recoveryIndex = visibleItems.findIndex(item =>
            item.kind === "Closed Tab" && item.detail === fixtureURL
          );
          const selectedDefault = recoveryIndex === 0;
          if (selectedDefault) {
            input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
          }
          const waitForRestored = (restoreAttempt = 0) => {
            const restored = [...gBrowser.tabs].find(tab =>
              tab.linkedBrowser?.currentURI?.spec === fixtureURL
            );
            if (!restored && restoreAttempt < 40) {
              window.setTimeout(() => waitForRestored(restoreAttempt + 1), 100);
              return;
            }
            const workspaceRestored = restored && ui.tabWorkspace(restored) === workspace;
            const fixtureConsumed = !ui.closedTabs().some(item => item.url === fixtureURL);
            const nativeListed = nativeItem?.getAttribute("label") === "Recoverable Reference";
            if (restored) gBrowser.removeTab(restored, { animate: false });
            window.setTimeout(() => {
              open("all");
              input.value = "reopen";
              render(false);
              const recoveryVisible = visibleItems.some(item => item.kind === "Closed Tab");
              const recoveryFocused = visibleItems.every(item =>
                ["Closed Tab", "Recovery", "Search"].includes(item.kind)
              );
              if (
                row && nativeListed && selectedDefault && restored &&
                workspaceRestored && fixtureConsumed && recoveryVisible && recoveryFocused
              ) {
                Services.prefs.setStringPref(
                  "fluxion.closedTabs.health",
                  "native-list-and-keyboard-restore-preserved-workspace",
                );
                window.dispatchEvent(new window.CustomEvent("FluxionClosedTabsVisualReady"));
              } else {
                Services.prefs.setStringPref(
                  "fluxion.closedTabs.visual.error",
                  `row=${Boolean(row)} native=${nativeListed} selected=${selectedDefault} ` +
                    `restored=${Boolean(restored)} workspace=${workspaceRestored} ` +
                    `consumed=${fixtureConsumed} visible=${recoveryVisible} focused=${recoveryFocused}`,
                );
              }
              Services.prefs.savePrefFile(null);
            }, 200);
          };
          waitForRestored();
        };
        waitForClosed();
      }, 900);
    };
    if (Services.env.get("FLUXION_VISUAL_PALETTE_COMMAND_TEST") === "1") {
      on(window, "FluxionPaletteCommandsVisualReady", runClosedTabsGate, { once: true });
    } else {
      window.setTimeout(runClosedTabsGate, 34000);
    }
  }
  if (Services.env.get("FLUXION_VISUAL_SEARCH_ENGINE_TEST") === "1") {
    const runSearchEngineGate = async () => {
      const { SearchService } = ChromeUtils.importESModule(
        "moz-src:///toolkit/components/search/SearchService.sys.mjs",
      );
      await SearchService.init();
      const original = SearchService.defaultEngine;
      const engines = await SearchService.getVisibleEngines();
      const alternate = engines.find(engine => engine !== original && engine.getSubmission("fluxion", null)?.uri);
      if (!alternate) {
        Services.prefs.setStringPref(
          "fluxion.webSearch.visual.error",
          "No alternate visible Gecko search engine was available",
        );
        Services.prefs.savePrefFile(null);
        return;
      }
      let openedTab = null;
      const captureTab = event => { openedTab = event.target; };
      try {
        await SearchService.setDefault(alternate, SearchService.CHANGE_REASON.USER);
        await window.FluxionWebSearch.refresh();
        const query = "fluxion-engine-route-9137";
        const submission = await window.FluxionWebSearch.resolve(query);
        open("all");
        input.value = query;
        render(false);
        const fallback = visibleItems[0];
        const selectedDefault = fallback?.kind === "Search" &&
          fallback.label.includes(alternate.name);
        gBrowser.tabContainer.addEventListener("TabOpen", captureTab, { once: true });
        if (selectedDefault) {
          input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        }
        const waitForOpen = async (attempt = 0) => {
          if (!openedTab && attempt < 40) {
            window.setTimeout(() => waitForOpen(attempt + 1).catch(Cu.reportError), 100);
            return;
          }
          gBrowser.tabContainer.removeEventListener("TabOpen", captureTab);
          const workspace = openedTab && ui.tabWorkspace(openedTab) === ui.currentWorkspace();
          const engineResolved = submission.engineId === (alternate.id || alternate.name) &&
            submission.engineName === alternate.name;
          if (openedTab) gBrowser.removeTab(openedTab, { animate: false });
          await SearchService.setDefault(original, SearchService.CHANGE_REASON.USER);
          await window.FluxionWebSearch.refresh();
          open("all");
          input.value = query;
          render(false);
          const originalVisible = visibleItems[0]?.kind === "Search" &&
            visibleItems[0].label.includes(original.name);
          if (selectedDefault && openedTab && workspace && engineResolved && originalVisible) {
            Services.prefs.setStringPref(
              "fluxion.webSearch.health",
              "gecko-default-engine-switched-opened-and-restored",
            );
            window.dispatchEvent(new window.CustomEvent("FluxionWebSearchVisualReady"));
          } else {
            Services.prefs.setStringPref(
              "fluxion.webSearch.visual.error",
              `selected=${selectedDefault} opened=${Boolean(openedTab)} workspace=${workspace} ` +
                `engine=${engineResolved} original=${originalVisible}`,
            );
          }
          Services.prefs.savePrefFile(null);
        };
        await waitForOpen();
      } catch (error) {
        gBrowser.tabContainer.removeEventListener("TabOpen", captureTab);
        await SearchService.setDefault(original, SearchService.CHANGE_REASON.USER).catch(Cu.reportError);
        await window.FluxionWebSearch.refresh().catch(Cu.reportError);
        Services.prefs.setStringPref("fluxion.webSearch.visual.error", String(error));
        Services.prefs.savePrefFile(null);
      }
    };
    if (Services.env.get("FLUXION_VISUAL_CLOSED_TABS_TEST") === "1") {
      on(window, "FluxionClosedTabsVisualReady", () => runSearchEngineGate().catch(Cu.reportError), {
        once: true,
      });
    } else {
      window.setTimeout(() => runSearchEngineGate().catch(Cu.reportError), 36000);
    }
  }
  if (Services.env.get("FLUXION_VISUAL_CLEAR_DATA_TEST") === "1") {
    let ranClearDataGate = false;
    const runClearDataGate = () => {
      if (ranClearDataGate) return;
      ranClearDataGate = true;
      open("all");
      input.value = "clear browsing data";
      render(false);
      const index = visibleItems.findIndex(item => item.label === "Clear browsing data…");
      if (index < 0) {
        Services.prefs.setStringPref(
          "fluxion.dataClearing.visual.error",
          "The command palette did not expose Clear browsing data",
        );
        Services.prefs.savePrefFile(null);
        return;
      }
      setActive(index);
      input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      const verifyDialog = (attempt = 0) => {
        const frameWindow = window.gDialogBox?.dialog?.frameContentWindow;
        const dialogDocument = frameWindow?.document;
        const dialog = dialogDocument?.querySelector("dialog");
        const categoryGroup = dialogDocument?.getElementById("clearPrivateDataGroupbox");
        const categories = categoryGroup?.querySelectorAll("checkbox");
        const duration = dialogDocument?.getElementById("sanitizeDurationChoice");
        const cancel = dialog?.getButton("cancel");
        const accept = dialog?.getButton("accept");
        if (!window.gDialogBox?.isOpen || !dialog || !duration || categories?.length < 5 || !cancel || !accept) {
          if (attempt < 50) {
            window.setTimeout(() => verifyDialog(attempt + 1), 100);
            return;
          }
          Services.prefs.setStringPref(
            "fluxion.dataClearing.visual.error",
            `Native dialog did not settle (open=${window.gDialogBox?.isOpen} categories=${categories?.length || 0})`,
          );
          Services.prefs.savePrefFile(null);
          return;
        }
        Services.prefs.setStringPref(
          "fluxion.dataClearing.surface.health",
          "time-range-categories-and-actions-visible",
        );
        Services.prefs.savePrefFile(null);
        on(window, "FluxionDataClearingDialogClosed", event => {
          if (event.detail?.result !== "cancel") {
            Services.prefs.setStringPref(
              "fluxion.dataClearing.visual.error",
              `Native dialog closed with ${event.detail?.result || "no result"}`,
            );
          } else {
            Services.prefs.setStringPref(
              "fluxion.dataClearing.cancel.health",
              "native-dialog-cancelled-without-clearing",
            );
            window.dispatchEvent(new window.CustomEvent("FluxionDataClearingVisualReady"));
          }
          Services.prefs.savePrefFile(null);
        }, { once: true });
        cancel.click();
      };
      window.setTimeout(() => verifyDialog(), 100);
    };
    if (Services.env.get("FLUXION_VISUAL_THEME_TEST") === "1") {
      on(window, "FluxionThemeVisualReady", runClearDataGate, { once: true });
    } else if (Services.env.get("FLUXION_VISUAL_SEARCH_ENGINE_TEST") === "1") {
      on(window, "FluxionWebSearchVisualReady", runClearDataGate, { once: true });
    } else {
      window.setTimeout(runClearDataGate, 70000);
    }
  }
  if (
    Services.env.get("FLUXION_VISUAL_MEMORY_TEST") === "1" &&
    Services.env.get("FLUXION_VISUAL_SETTINGS_TEST") !== "1"
  ) {
    window.setTimeout(() => {
      open("memory");
      input.value = "example.com";
      render(false);
    }, 1200);
  }
  if (Services.env.get("FLUXION_VISUAL_GROUNDING_TEST") === "1") {
    on(window, "FluxionMemoryVisualReady", () => {
      open("memory");
      input.value = "example";
      renderMemory().catch(error => {
        Services.prefs.setStringPref("fluxion.memory.grounding.error", String(error));
        Services.prefs.savePrefFile(null);
        Cu.reportError(error);
      });
    }, { once: true });
  }
  if (Services.env.get("FLUXION_VISUAL_AI_TEST") === "1") {
    window.setTimeout(() => {
      const tab = [...gBrowser.tabs].find(candidate =>
        candidate.linkedBrowser?.currentURI?.spec === "https://example.com/?fluxion-memory-test=1"
      );
      if (!tab) {
        Services.prefs.setStringPref("fluxion.ai.visual.error", "Dedicated page-evidence tab was not found");
        Services.prefs.savePrefFile(null);
        return;
      }
      Services.prefs.setStringPref("fluxion.ai.visual.stage", "dedicated-page-found");
      Services.prefs.savePrefFile(null);
      open("ask", tab.linkedBrowser);
      input.value = "What is this page for?";
      runAsk().catch(Cu.reportError);
    }, 7200);
  }
  if (Services.env.get("FLUXION_VISUAL_AI_COMPARE_TEST") === "1") {
    const runCompareVisualGate = () => {
      const tabs = [
        [...gBrowser.tabs].find(candidate =>
          candidate.linkedBrowser?.currentURI?.spec === "https://example.com/?fluxion-memory-test=1"
        ),
        [...gBrowser.tabs].find(candidate =>
          candidate.linkedBrowser?.currentURI?.spec === "https://example.org/?fluxion-split=right"
        ),
      ].filter(Boolean);
      if (tabs.length !== 2) {
        Services.prefs.setStringPref("fluxion.ai.compare.visual.error", "Dedicated comparison pages were not found");
        Services.prefs.savePrefFile(null);
        return;
      }
      open("compare", tabs);
      input.value = "How do these pages differ in purpose?";
      runAsk().catch(Cu.reportError);
    };
    if (Services.env.get("FLUXION_VISUAL_AI_TEST") === "1") {
      on(window, "FluxionAIVisualReady", runCompareVisualGate, { once: true });
    } else {
      window.setTimeout(runCompareVisualGate, 9400);
    }
  }
  function runOrganisationVisualGate(attempt = 0) {
    const suggestion = organisationSuggestion();
    const item = commandItems().find(candidate => candidate.label === "Suggest tab group");
    if (!suggestion || suggestion.records.length < 3 || !item || !/React/.test(item.detail)) {
      if (attempt < 24) {
        window.setTimeout(() => runOrganisationVisualGate(attempt + 1), 250);
        return;
      }
      const fixtures = [...gBrowser.tabs]
        .filter(tab => /fluxion-organise=/.test(tab.linkedBrowser?.currentURI?.spec || ""))
        .map(tab => `${tab.label}:${tab.linkedBrowser.currentURI.spec}`);
      Services.prefs.setStringPref(
        "fluxion.organisation.visual.error",
        `A local evidence-backed tab-group proposal was not available (${fixtures.join(" | ")})`,
      );
      Services.prefs.savePrefFile(null);
      return;
    }
    open("all");
    input.value = "suggest tab group";
    render(false);
    if (visibleItems.some(candidate => candidate.label === "Suggest tab group")) {
      Services.prefs.setStringPref(
        "fluxion.organisation.health",
        "local-proposal-visible-and-confirmation-required",
      );
      Services.prefs.savePrefFile(null);
    }
  }
  if (Services.env.get("FLUXION_VISUAL_ORGANISATION_TEST") === "1") {
    if (Services.env.get("FLUXION_VISUAL_GROUNDING_TEST") === "1") {
      on(window, "FluxionGroundingVisualReady", () => runOrganisationVisualGate(), { once: true });
    } else {
      window.setTimeout(() => runOrganisationVisualGate(), 3200);
    }
  }
  Services.prefs.setStringPref("fluxion.palette.health", "command-palette-loaded");
  Services.prefs.savePrefFile(null);
})(window);
