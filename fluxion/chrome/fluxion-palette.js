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
  let splitSource = null;
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
  inputRow.append(glyph, input);
  palette.append(inputRow, status, results);
  layer.appendChild(palette);
  document.body.appendChild(layer);

  function openUrl(url) {
    const tab = gBrowser.addTrustedTab(url);
    tab.setAttribute("fluxion-workspace", ui.currentWorkspace());
    gBrowser.selectedTab = tab;
  }

  function commandItems() {
    const doCommand = id => document.getElementById(id)?.doCommand();
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
    const selectedTab = gBrowser.selectedTab;
    const privateWindow = PrivateBrowsingUtils.isWindowPrivate(window);
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
      items.splice(9, 0,
        {
          label: "Swap split sides", detail: "Reverse the two pages", kind: "Command",
          keywords: ["split view reverse panes"], run: () => ui.reverseSplitView(selectedTab),
        },
        {
          label: "Separate split view", detail: "Return both pages to ordinary tabs", kind: "Command",
          keywords: ["split view exit unsplit panes"], run: () => ui.separateSplitView(selectedTab),
        },
      );
    } else if (selectedTab && !selectedTab.pinned) {
      items.splice(9, 0,
        {
          label: "Open split view", detail: "Choose an open tab to place beside this page", kind: "Command",
          keywords: ["side by side two panes"], run: () => open("split", selectedTab),
        },
        {
          label: "New page in split view", detail: "Open a blank page beside this one", kind: "Command",
          keywords: ["side by side two panes"], run: () => ui.openNewSplit(selectedTab),
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
      run: () => source ? ui.createSplitView(source, tab) : ui.selectTab(tab),
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
    }
  }

  function render(includePlaces = false) {
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
    lastFocus = document.activeElement;
    layer.hidden = false;
    input.value = "";
    input.placeholder = mode === "split"
      ? "Choose a tab to place beside this page"
      : mode === "tabs" ? "Search open tabs"
        : mode === "memory" ? "What do you remember about the page?"
          : "Search commands, tabs, history, and bookmarks";
    activeIndex = 0;
    render(false);
    window.requestAnimationFrame(() => input.focus());
  }

  function close() {
    window.clearTimeout(placesTimer);
    memoryRequest += 1;
    layer.hidden = true;
    input.value = "";
    splitSource = null;
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
  on(window, "unload", () => {
    window.clearTimeout(placesTimer);
    while (cleanup.length) cleanup.pop()();
    layer.remove();
    style.remove();
  }, { once: true });
  window.FluxionPalette = Object.freeze({ open });
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
    window.setTimeout(() => {
      open("memory");
      input.value = "example";
      render(false);
    }, 5200);
  }
  Services.prefs.setStringPref("fluxion.palette.health", "command-palette-loaded");
  Services.prefs.savePrefFile(null);
})(window);
