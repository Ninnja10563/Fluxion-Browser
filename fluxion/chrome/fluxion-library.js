/* global gBrowser, Services, SessionStore, ChromeUtils, FluxionLibraryData, FluxionLibraryDownloads, FluxionLibraryQuery, FluxionLibraryChanges, FluxionLibraryNavigation, FluxionUrl, Ci, Cu */
(function initialiseFluxionLibrary(window) {
  "use strict";

  if (!window.FluxionUI || window.FluxionLibrary) return;
  const { document } = window;
  const HTML = "http://www.w3.org/1999/xhtml";
  const browserBox = document.getElementById("browser");
  const contentDeck = document.getElementById("tabbrowser-tabbox");
  if (!browserBox || !contentDeck) return;

  const { PlacesUtils } = ChromeUtils.importESModule("resource://gre/modules/PlacesUtils.sys.mjs");
  const { Downloads } = ChromeUtils.importESModule("resource://gre/modules/Downloads.sys.mjs");
  const { PrivateBrowsingUtils } = ChromeUtils.importESModule(
    "resource://gre/modules/PrivateBrowsingUtils.sys.mjs"
  );
  const ROOT_FOLDER_GUIDS = Object.freeze([
    PlacesUtils.bookmarks.toolbarGuid,
    PlacesUtils.bookmarks.menuGuid,
    PlacesUtils.bookmarks.unfiledGuid,
    PlacesUtils.bookmarks.mobileGuid,
  ]);
  const PROTECTED_FOLDER_GUIDS = new Set([
    PlacesUtils.bookmarks.rootGuid,
    PlacesUtils.bookmarks.toolbarGuid,
    PlacesUtils.bookmarks.menuGuid,
    PlacesUtils.bookmarks.unfiledGuid,
    PlacesUtils.bookmarks.mobileGuid,
    PlacesUtils.bookmarks.tagsGuid,
  ]);
  const create = (tag, className, text) => {
    const node = document.createElementNS(HTML, tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const style = create("style");
  style.id = "fluxion-library-style";
  style.textContent = `
    #fluxion-library[hidden] { display: none !important; }
    :root[data-fluxion-library-visible] #identity-icon-box { display: none !important; }
    #fluxion-library {
      position: absolute; inset-block: 0; inset-inline-start: var(--fluxion-flow-layout-width);
      inset-inline-end: 0; z-index: 3; min-width: 0; display: flex; flex-direction: column;
      color: var(--fluxion-ink); background: var(--fluxion-bg-raised); font: menu; font-size: 13px;
    }
    .fluxion-library-header {
      min-height: 62px; display: grid; grid-template-columns: auto minmax(180px, 420px) auto;
      align-items: center; gap: 24px; padding: 10px 28px; border-bottom: 1px solid var(--fluxion-line);
    }
    .fluxion-library-title { font-size: 17px; font-weight: 650; letter-spacing: -.02em; }
    .fluxion-library-search {
      box-sizing: border-box; width: 100%; height: 32px; border: 1px solid var(--fluxion-line);
      border-radius: 4px; padding: 0 10px; color: var(--fluxion-ink); background: var(--fluxion-bg); font: inherit;
    }
    .fluxion-library-search:focus-visible, .fluxion-library-nav button:focus-visible,
    .fluxion-library-open:focus-visible, .fluxion-library-action:focus-visible, .fluxion-library-more:focus-visible,
    .fluxion-library-folder-select:focus-visible, .fluxion-library-row:focus-visible,
    .fluxion-library-list:focus-visible {
      outline: 2px solid var(--fluxion-accent); outline-offset: 1px;
    }
    .fluxion-library-private { color: var(--fluxion-muted); font-size: 11px; }
    .fluxion-library-body { min-height: 0; flex: 1; display: flex; overflow: hidden; }
    .fluxion-library-nav {
      box-sizing: border-box; flex: 0 0 164px; min-width: 164px; padding: 24px 12px;
      border-inline-end: 1px solid var(--fluxion-line); background: var(--fluxion-bg); overflow: auto;
    }
    .fluxion-library-nav button {
      width: 100%; height: 32px; border: 0; border-radius: 4px; padding: 0 10px;
      color: var(--fluxion-muted); background: transparent; text-align: start; font: inherit;
    }
    .fluxion-library-nav button:hover { color: var(--fluxion-ink); background: var(--fluxion-hover); }
    .fluxion-library-nav button[aria-current="true"] { color: var(--fluxion-ink); background: var(--fluxion-selected); font-weight: 600; }
    .fluxion-library-content {
      box-sizing: border-box; flex: 0 1 820px; min-width: 420px;
      padding: 0 30px 70px; overflow: auto;
    }
    .fluxion-library-content:has(> .fluxion-library-pagination:not([hidden])) { scroll-padding-block-start: 56px; }
    .fluxion-library-section-head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 12px; padding-top: 26px; margin-bottom: 16px; }
    .fluxion-library-section-head h2 { margin: 0; font-size: 22px; letter-spacing: -.025em; }
    .fluxion-library-section-tools { display: flex; flex-wrap: wrap; min-width: 0; align-items: center; gap: 6px; }
    .fluxion-library-summary { margin-inline-end: 4px; color: var(--fluxion-muted); font-size: 11px; }
    .fluxion-library-folder-select {
      max-width: 190px; height: 28px; border: 1px solid var(--fluxion-line); border-radius: 4px;
      padding: 2px 24px 2px 7px; color: var(--fluxion-ink); background: var(--fluxion-bg); font: inherit; font-size: 11px;
    }
    .fluxion-library-list { border-top: 1px solid var(--fluxion-line); }
    .fluxion-library-row {
      min-height: 50px; display: grid; grid-template-columns: minmax(0, 1fr) auto;
      align-items: center; gap: 14px; border-bottom: 1px solid var(--fluxion-line); padding: 7px 2px;
    }
    .fluxion-library-instructions { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
    .fluxion-library-open { min-width: 0; border: 0; padding: 0; color: inherit; background: transparent; text-align: start; font: inherit; }
    .fluxion-library-open:hover .fluxion-library-row-title { text-decoration: underline; text-decoration-thickness: 1px; }
    .fluxion-library-row-title, .fluxion-library-row-detail { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .fluxion-library-row-title { font-weight: 550; }
    .fluxion-library-row-detail { margin-top: 3px; color: var(--fluxion-muted); font-size: 11px; }
    .fluxion-library-actions { display: flex; gap: 5px; }
    .fluxion-library-more { display: grid; place-items: center; width: 28px; height: 28px; border: 0; border-radius: 3px; color: var(--fluxion-muted); background: transparent; }
    .fluxion-library-more:hover, .fluxion-library-more[aria-expanded="true"] { background: var(--fluxion-hover); color: var(--fluxion-ink); }
    .fluxion-library-more svg { width: 16px; height: 16px; fill: currentColor; }
    .fluxion-library-action {
      min-height: 27px; border: 1px solid var(--fluxion-line); border-radius: 4px; padding: 3px 8px;
      color: var(--fluxion-muted); background: var(--fluxion-bg); font: inherit; font-size: 11px;
    }
    .fluxion-library-action:hover:not(:disabled) { color: var(--fluxion-ink); background: var(--fluxion-hover); }
    .fluxion-library-action:disabled { opacity: .45; }
    .fluxion-library-action[hidden] { display: none !important; }
    .fluxion-library-pagination { position: sticky; top: 0; z-index: 1; display: flex; align-items: center; gap: 12px; padding: 12px 0; background: var(--fluxion-bg-raised); border-bottom: 1px solid var(--fluxion-line); }
    .fluxion-library-page-label { color: var(--fluxion-muted); font-size: 11px; }
    .fluxion-library-empty { padding: 48px 8px; color: var(--fluxion-muted); text-align: center; }
    .fluxion-library-note { min-height: 18px; margin-top: 12px; color: var(--fluxion-muted); font-size: 11px; }
    @media (max-width: 820px) {
      .fluxion-library-header { grid-template-columns: 1fr; gap: 8px; padding: 12px 18px; }
      .fluxion-library-nav { flex-basis: 130px; min-width: 130px; }
      .fluxion-library-content { min-width: 360px; padding-inline: 20px; }
    }
  `;
  document.documentElement.appendChild(style);

  const root = create("section");
  root.id = "fluxion-library";
  root.hidden = true;
  root.setAttribute("aria-label", "Fluxion Library");
  const header = create("header", "fluxion-library-header");
  header.appendChild(create("div", "fluxion-library-title", "Fluxion Library"));
  const search = create("input", "fluxion-library-search");
  search.type = "search";
  search.maxLength = 500;
  search.placeholder = "Search history, bookmarks, or downloads";
  search.setAttribute("aria-label", "Search current Library section");
  header.appendChild(search);
  const privacy = create("div", "fluxion-library-private");
  header.appendChild(privacy);
  const body = create("div", "fluxion-library-body");
  const nav = create("nav", "fluxion-library-nav");
  nav.setAttribute("aria-label", "Library sections");
  const content = create("main", "fluxion-library-content");
  const sectionHead = create("div", "fluxion-library-section-head");
  const heading = create("h2");
  const sectionTools = create("div", "fluxion-library-section-tools");
  const summary = create("span", "fluxion-library-summary");
  const folderSelect = create("select", "fluxion-library-folder-select");
  folderSelect.setAttribute("aria-label", "Filter bookmarks by folder");
  const addPageButton = create("button", "fluxion-library-action", "Save current page");
  addPageButton.type = "button";
  const newFolderButton = create("button", "fluxion-library-action", "New folder");
  newFolderButton.type = "button";
  sectionTools.append(summary, folderSelect, addPageButton, newFolderButton);
  sectionHead.append(heading, sectionTools);
  const listNode = create("div", "fluxion-library-list");
  listNode.setAttribute("role", "list");
  const navigationHelp = create("span", "fluxion-library-instructions",
    "Use Up and Down to move between items, Home and End for the first and last item. Press Right for actions, Left to return, or Shift F10 to open the item menu. Tab leaves the list.");
  navigationHelp.id = "fluxion-library-navigation-help";
  listNode.setAttribute("aria-describedby", navigationHelp.id);
  const note = create("div", "fluxion-library-note");
  note.setAttribute("role", "status");
  const pagination = create("div", "fluxion-library-pagination");
  const previousPage = create("button", "fluxion-library-action", "Previous");
  previousPage.type = "button";
  previousPage.setAttribute("aria-label", "Previous Library page");
  const nextPage = create("button", "fluxion-library-action", "Next");
  nextPage.type = "button";
  nextPage.setAttribute("aria-label", "Next Library page");
  const pageLabel = create("span", "fluxion-library-page-label");
  pageLabel.setAttribute("role", "status");
  pagination.append(previousPage, pageLabel, nextPage);
  content.append(sectionHead, pagination, navigationHelp, listNode, note);
  body.append(nav, content);
  root.append(header, body);
  browserBox.appendChild(root);

  const data = { history: [], bookmarks: [], folders: [], downloads: [] };
  let folderPage = [];
  const navButtons = new Map();
  let currentSection = "history";
  let currentBookmarkFolder = "all";
  let lastWebPage = null;
  let refreshToken = 0;
  let downloadList = null;
  let downloadView = null;
  let downloadsReady = null;
  let destroyed = false;
  let downloadRefreshToken = 0;
  const downloadRows = new Map();
  const PAGE_SIZE = FluxionLibraryQuery.PAGE_SIZE;
  let pageCursor = null;
  const previousCursors = [];
  let nextCursor = null;
  let hasMore = false;
  let loading = false;
  let queryError = "";
  let retainedPlaces = false;
  let queryTimer = 0;
  let visibleTab = null;
  const itemMenu = document.createXULElement("menupopup");
  itemMenu.id = "fluxion-library-item-menu";
  document.getElementById("mainPopupSet").appendChild(itemMenu);
  let menuTarget = null;
  let menuRevision = 0;
  const libraryNavigation = FluxionLibraryNavigation.attach(listNode, {
    enabled: () => currentSection !== "downloads",
    canAct: () => !loading && !root.hidden,
    onMenu: (row, anchor, event) => openRowMenu(row, anchor, event),
  });

  function validRowTarget(target) {
    return target && !destroyed && !root.hidden && !loading && selectedLibraryTab() &&
      target.section === currentSection && target.generation === refreshToken &&
      [...listNode.children].includes(target.row) && target.row._fluxionLibraryItem === target.item &&
      (currentSection === "folders" ? folderPage : data[currentSection]).includes(target.item);
  }

  function dismissItemMenu() {
    menuRevision += 1;
    const previous = menuTarget;
    menuTarget = null;
    previous?.row.querySelector(".fluxion-library-more")?.setAttribute("aria-expanded", "false");
    itemMenu.hidePopup();
  }

  itemMenu.addEventListener("popuphidden", () => {
    const target = menuTarget;
    menuTarget = null;
    target?.row.querySelector(".fluxion-library-more")?.setAttribute("aria-expanded", "false");
    const focused = document.activeElement;
    if (validRowTarget(target) && (focused === target.focusOrigin || focused === document.body ||
        focused === document.documentElement || itemMenu.contains(focused))) {
      target.anchor.focus({ preventScroll: true });
    }
  });

  function openRowMenu(row, anchor, event) {
    const target = { row, anchor, item: row._fluxionLibraryItem, section: currentSection,
      generation: refreshToken, focusOrigin: document.activeElement };
    if (!validRowTarget(target) || target.item.kind === "downloads") return;
    event?.preventDefault();
    dismissItemMenu();
    const revision = menuRevision;
    const show = () => {
      if (revision !== menuRevision || !validRowTarget(target)) return;
      showRowMenu(target, event);
    };
    if (itemMenu.state === "hiding") itemMenu.addEventListener("popuphidden", show, { once: true });
    else show();
  }

  function showRowMenu(target, event) {
    const { row, anchor } = target;
    menuTarget = target;
    itemMenu.replaceChildren();
    for (const [label, execute] of row._fluxionLibraryCommands) {
      const command = document.createXULElement("menuitem");
      command.setAttribute("label", label);
      command.setAttribute("aria-label", `${label} ${target.item.title}`);
      if (!execute) command.setAttribute("disabled", "true");
      command.addEventListener("command", () => {
        if (!execute || !validRowTarget(target)) return;
        dismissItemMenu();
        Promise.resolve().then(() => {
          if (validRowTarget(target)) return execute(() => validRowTarget(target));
        }).catch(error => { if (!destroyed && !root.hidden) note.textContent = error.message; Cu.reportError(error); });
      });
      itemMenu.appendChild(command);
    }
    row.querySelector(".fluxion-library-more").setAttribute("aria-expanded", "true");
    if (event?.type === "contextmenu" && event.button === 2) itemMenu.openPopupAtScreen(event.screenX, event.screenY, true);
    else itemMenu.openPopup(anchor, "after_start", 0, 0, false, false, event);
  }

  const pendingSections = new WeakMap();
  function isLibraryTab(tab) {
    const url = tab?.linkedBrowser?.currentURI?.spec || "";
    return /^about:downloads(?:[?#]|$)/.test(url) ||
      (url === "about:blank" && tab?.hasAttribute("fluxion-library-section"));
  }

  function selectedLibraryTab() {
    return isLibraryTab(gBrowser.selectedTab) ? gBrowser.selectedTab : null;
  }

  function tabSection(tab) {
    if (!tab) return "history";
    const browser = tab.linkedBrowser;
    const url = browser?.currentURI?.spec || "";
    const pending = pendingSections.get(browser);
    if (pending && url === pending.from) return pending.section;
    // Only an owned, not-yet-committed tab needs the persisted attribute. Once
    // Gecko has a URL, its fragment must win over stale restored chrome state.
    if (url === "about:blank") return FluxionLibraryData.section(tab.getAttribute("fluxion-library-section"));
    const hash = url.split("#")[1];
    return hash ? FluxionLibraryData.section(hash) : "downloads";
  }

  function formatWhen(timestamp) {
    if (!timestamp) return "Unknown time";
    const elapsed = Date.now() - timestamp;
    if (elapsed < 60000) return "Just now";
    if (elapsed < 3600000) return `${Math.max(1, Math.round(elapsed / 60000))} min ago`;
    if (elapsed < 86400000) return `${Math.round(elapsed / 3600000)} hr ago`;
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(timestamp));
  }

  function downloadStatus(download) {
    return FluxionLibraryDownloads.describe(download).status;
  }

  async function queryHistory(context) {
    const db = await PlacesUtils.promiseDBConnection();
    const query = FluxionLibraryQuery.history(context);
    const page = FluxionLibraryQuery.pageFromRows(await db.execute(query.sql, query.params), query.pageSize);
    return { ...page, items: page.rows.map(row => FluxionLibraryData.normalise({
      id: row.getResultByName("url"),
      url: row.getResultByName("url"),
      title: row.getResultByName("title"),
      detail: `${row.getResultByName("visits")} visits · ${formatWhen(row.getResultByName("visited"))}`,
      timestamp: row.getResultByName("visited"),
    }, "history")) };
  }

  async function queryBookmarks(context) {
    const db = await PlacesUtils.promiseDBConnection();
    const query = FluxionLibraryQuery.bookmarks({ ...context, roots: {
      toolbarGuid: PlacesUtils.bookmarks.toolbarGuid,
      menuGuid: PlacesUtils.bookmarks.menuGuid,
      unfiledGuid: PlacesUtils.bookmarks.unfiledGuid,
      mobileGuid: PlacesUtils.bookmarks.mobileGuid,
    } });
    const page = FluxionLibraryQuery.pageFromRows(await db.execute(query.sql, query.params), query.pageSize);
    return { ...page, items: page.rows.map(row => FluxionLibraryData.normalise({
      guid: row.getResultByName("guid"),
      url: row.getResultByName("url"),
      title: row.getResultByName("title"),
      detail: `${row.getResultByName("folder")} · Saved ${formatWhen(row.getResultByName("added"))}`,
      parentGuid: row.getResultByName("parentGuid"),
      timestamp: row.getResultByName("added"),
    }, "bookmarks")) };
  }

  function rootFolderTitle(guid, title) {
    if (title) return title;
    if (guid === PlacesUtils.bookmarks.toolbarGuid) return "Bookmarks Toolbar";
    if (guid === PlacesUtils.bookmarks.menuGuid) return "Bookmarks Menu";
    if (guid === PlacesUtils.bookmarks.unfiledGuid) return "Other Bookmarks";
    if (guid === PlacesUtils.bookmarks.mobileGuid) return "Mobile Bookmarks";
    return "Untitled Folder";
  }

  async function queryFolders() {
    const db = await PlacesUtils.promiseDBConnection();
    const rows = await db.execute(`
      SELECT b.guid, b.title, parent.guid AS parentGuid,
             COALESCE(parent.title, 'Bookmarks') AS parentTitle,
             b.dateAdded / 1000 AS added, COUNT(children.id) AS childCount
      FROM moz_bookmarks b
      LEFT JOIN moz_bookmarks parent ON parent.id = b.parent
      LEFT JOIN moz_bookmarks children ON children.parent = b.id
      WHERE b.type = 2 AND b.guid != :rootGuid AND b.guid != :tagsGuid
        AND (parent.guid IS NULL OR parent.guid != :tagsGuid)
      GROUP BY b.id ORDER BY b.position
    `, {
      rootGuid: PlacesUtils.bookmarks.rootGuid,
      tagsGuid: PlacesUtils.bookmarks.tagsGuid,
    });
    return FluxionLibraryData.folderTree(rows.map(row => {
      const guid = row.getResultByName("guid");
      const title = rootFolderTitle(guid, row.getResultByName("title"));
      const childCount = row.getResultByName("childCount");
      return FluxionLibraryData.normalise({
        id: guid,
        title,
        parentGuid: row.getResultByName("parentGuid"),
        childCount,
        detail: `${row.getResultByName("parentTitle") || "Bookmarks"} · ${childCount} items`,
        timestamp: row.getResultByName("added"),
      }, "folders");
    }), ROOT_FOLDER_GUIDS);
  }

  async function initialiseDownloads() {
    if (!downloadsReady) downloadsReady = (async () => {
      const type = PrivateBrowsingUtils.isWindowPrivate(window) ? Downloads.PRIVATE : Downloads.PUBLIC;
      downloadList = await Downloads.getList(type);
      if (destroyed) return;
      downloadView = {
        onDownloadAdded: downloadRefresh.schedule,
        onDownloadChanged: downloadRefresh.schedule,
        onDownloadRemoved: downloadRefresh.schedule,
      };
      await downloadList.addView(downloadView);
      if (destroyed) downloadList.removeView(downloadView);
    })().catch(error => { downloadsReady = null; throw error; });
    return downloadsReady;
  }

  function pageItems(items, context) {
    const offset = context.cursor?.offset || 0;
    const filtered = items.filter(item => FluxionLibraryData.matches(item, context.search));
    const page = filtered.slice(offset, offset + PAGE_SIZE);
    const more = offset + page.length < filtered.length;
    return { items: page, hasMore: more, cursor: more ? { offset: offset + PAGE_SIZE } : null };
  }

  async function queryDownloads(context) {
    await initialiseDownloads();
    const downloads = await downloadList.getAll();
    const items = downloads.sort((a, b) => (b.startTime?.getTime() || 0) - (a.startTime?.getTime() || 0) ||
      String(a.target?.path || "").localeCompare(String(b.target?.path || "")))
      .map((download, index) => {
        const path = download.target?.path || "";
        const filename = path.split(/[\\/]/).pop() || download.source?.url || "Download";
        return FluxionLibraryData.normalise({
          id: `${path}:${download.startTime?.getTime() || index}`,
          title: filename,
          url: download.source?.url || "",
          detail: `${downloadStatus(download)} · ${formatWhen(download.startTime?.getTime())}`,
          state: downloadStatus(download),
          timestamp: download.startTime?.getTime() || 0,
          raw: download,
        }, "downloads");
      });
    return pageItems(items, context);
  }

  async function refreshAll() {
    window.clearTimeout(queryTimer);
    queryTimer = 0;
    if (destroyed || root.hidden) return;
    const token = ++refreshToken;
    const downloadsToken = ++downloadRefreshToken;
    const section = currentSection;
    const context = { search: search.value, cursor: pageCursor, pageSize: PAGE_SIZE,
      folderGuid: currentBookmarkFolder === "all" ? "" : currentBookmarkFolder };
    loading = true;
    queryError = "";
    renderPageState();
    try {
      let page;
      if (section === "history") page = await queryHistory(context);
      else if (section === "downloads") page = await queryDownloads(context);
      else {
        const folders = await queryFolders();
        if (destroyed || token !== refreshToken) return;
        data.folders = folders;
        refreshFolderSelect();
        if (section === "bookmarks" && context.folderGuid !== (currentBookmarkFolder === "all" ? "" : currentBookmarkFolder)) {
          resetPaging();
          return refreshAll();
        }
        page = section === "bookmarks" ? await queryBookmarks(context) : pageItems(folders, context);
      }
      if (destroyed || token !== refreshToken || (section === "downloads" && downloadsToken !== downloadRefreshToken)) return;
      if (section !== "folders") data[section] = page.items;
      // Folder metadata feeds the picker; preserve it separately from its page.
      if (section === "folders") folderPage = page.items;
      hasMore = page.hasMore;
      nextCursor = page.cursor;
      loading = false;
      render();
    } catch (error) {
      if (destroyed || token !== refreshToken || (section === "downloads" && downloadsToken !== downloadRefreshToken)) return;
      loading = false;
      queryError = error.message || "The Library could not be read.";
      if (section !== "folders") data[section] = [];
      if (section === "folders") folderPage = [];
      hasMore = false;
      nextCursor = null;
      render();
      Cu.reportError(error);
    }
  }

  const downloadRefresh = FluxionLibraryDownloads.createRefreshQueue({
    setTimer: (callback, delay) => window.setTimeout(callback, delay),
    clearTimer: timer => window.clearTimeout(timer),
    reportError: Cu.reportError,
    refresh: async () => {
      if (root.hidden || currentSection !== "downloads") return;
      const token = ++downloadRefreshToken;
      const request = refreshToken;
      try {
        const downloads = await queryDownloads({ search: search.value, cursor: pageCursor });
        if (destroyed || token !== downloadRefreshToken || request !== refreshToken) return;
        data.downloads = downloads.items;
        hasMore = downloads.hasMore;
        nextCursor = downloads.cursor;
        loading = false;
        queryError = "";
        if (!root.hidden && currentSection === "downloads") render();
      } catch (error) {
        if (destroyed || token !== downloadRefreshToken || request !== refreshToken) return;
        loading = false;
        queryError = error.message || "Downloads could not be read.";
        data.downloads = [];
        hasMore = false;
        nextCursor = null;
        render();
        Cu.reportError(error);
      }
    },
  });

  async function openURL(url) {
    if (!url) return;
    const route = FluxionUrl.classifyNavigation(url);
    if (route.kind === "search") return window.FluxionWebSearch.open(route.value);
    const tab = gBrowser.addTrustedTab(route.value);
    window.FluxionUI.setTabWorkspace(tab, window.FluxionUI.currentWorkspace());
    gBrowser.selectedTab = tab;
    return tab;
  }

  function action(label, handler) {
    const button = create("button", "fluxion-library-action", label);
    button.type = "button";
    button.addEventListener("click", event => {
      event.stopPropagation();
      Promise.resolve().then(handler).catch(error => {
        note.textContent = error.message || String(error);
        Cu.reportError(error);
      });
    });
    return button;
  }

  function promptText(title, message, initial = "") {
    const value = { value: initial };
    const accepted = Services.prompt.prompt(window, title, message, value, null, {});
    if (!accepted) return null;
    const cleaned = FluxionLibraryData.clean(value.value, 200);
    return cleaned || null;
  }

  function chooseFolder(title, message, excluded = new Set()) {
    const folders = data.folders.filter(folder => !excluded.has(folder.id));
    if (!folders.length) return null;
    const labels = folders.map(folder => `${"  ".repeat(folder.depth || 0)}${folder.title}`);
    const selected = { value: Math.max(0, folders.findIndex(folder => folder.id === currentBookmarkFolder)) };
    if (!Services.prompt.select(window, title, message, labels.length, labels, selected)) return null;
    return folders[selected.value] || null;
  }

  async function createFolder(parentGuid = null) {
    const parent = parentGuid || (currentSection === "bookmarks" && currentBookmarkFolder !== "all"
      ? currentBookmarkFolder : PlacesUtils.bookmarks.unfiledGuid);
    const name = promptText("New Bookmark Folder", "Folder name:", "New Folder");
    if (!name) return;
    const folder = await PlacesUtils.bookmarks.insert({
      parentGuid: parent,
      type: PlacesUtils.bookmarks.TYPE_FOLDER,
      title: name,
      index: PlacesUtils.bookmarks.DEFAULT_INDEX,
    });
    currentBookmarkFolder = folder.guid;
    note.textContent = `Created “${name}”.`;
    await refreshAll();
  }

  async function renameFolder(item) {
    if (PROTECTED_FOLDER_GUIDS.has(item.id)) return;
    const name = promptText("Rename Bookmark Folder", "Folder name:", item.title);
    if (!name || name === item.title) return;
    await PlacesUtils.bookmarks.update({ guid: item.id, title: name });
    note.textContent = `Renamed folder to “${name}”.`;
    await refreshAll();
  }

  async function deleteFolder(item) {
    if (PROTECTED_FOLDER_GUIDS.has(item.id)) return;
    if (item.childCount > 0) {
      note.textContent = `“${item.title}” is not empty. Move or remove its contents first.`;
      return;
    }
    if (!Services.prompt.confirm(
      window,
      "Delete Empty Folder?",
      `Delete “${item.title}”? Fluxion will refuse if it contains bookmarks or subfolders.`,
    )) return;
    try {
      await PlacesUtils.bookmarks.remove(item.id, { preventRemovalOfNonEmptyFolders: true });
      if (currentBookmarkFolder === item.id) currentBookmarkFolder = "all";
      note.textContent = `Deleted “${item.title}”.`;
      await refreshAll();
    } catch (_) {
      note.textContent = `Fluxion could not delete “${item.title}” safely. Its contents may have changed.`;
    }
  }

  async function renameBookmark(item) {
    const title = promptText("Rename Bookmark", "Bookmark title:", item.title);
    if (!title || title === item.title) return;
    await PlacesUtils.bookmarks.update({ guid: item.id, title });
    note.textContent = `Renamed bookmark to “${title}”.`;
    await refreshAll();
  }

  async function moveBookmark(item) {
    const folder = chooseFolder("Move Bookmark", `Move “${item.title}” to:`);
    if (!folder || folder.id === item.parentGuid) return;
    await PlacesUtils.bookmarks.update({
      guid: item.id,
      parentGuid: folder.id,
      index: PlacesUtils.bookmarks.DEFAULT_INDEX,
    });
    note.textContent = `Moved “${item.title}” to ${folder.title}.`;
    await refreshAll();
  }

  async function saveLastWebPage() {
    if (!lastWebPage) throw new Error("Open an ordinary webpage before saving a bookmark.");
    const { url, title } = lastWebPage;
    const parentGuid = currentBookmarkFolder !== "all"
      ? currentBookmarkFolder : PlacesUtils.bookmarks.unfiledGuid;
    const existing = [];
    await PlacesUtils.bookmarks.fetch({ url }, item => existing.push(item));
    if (existing.some(item => item.parentGuid === parentGuid)) {
      note.textContent = `“${title || url}” is already saved in the requested folder.`;
      return;
    }
    await PlacesUtils.bookmarks.insert({
      parentGuid,
      title: title || url,
      url,
      index: PlacesUtils.bookmarks.DEFAULT_INDEX,
    });
    note.textContent = `Saved “${title || url}”.`;
    await refreshAll();
  }

  function renderRow(item) {
    const row = create("div", "fluxion-library-row");
    row._fluxionLibraryId = item.id;
    row._fluxionLibraryItem = item;
    row.setAttribute("role", "listitem");
    const primary = create("button", "fluxion-library-open");
    primary.type = "button";
    const title = create("div", "fluxion-library-row-title", item.title);
    const detail = create("div", "fluxion-library-row-detail",
      `${item.detail}${item.url ? ` · ${item.url}` : ""}`);
    primary.append(title, detail);
    const actions = create("div", "fluxion-library-actions");
    if (item.kind === "downloads") {
      const download = item.raw;
      row.tabIndex = -1;
      row._fluxionDownload = download;
      const openFile = () => download.launch();
      primary.addEventListener("click", () => Promise.resolve().then(openFile).catch(error => {
        note.textContent = error.message || String(error); Cu.reportError(error);
      }));
      const controls = {
        open: action("Open", openFile),
        reveal: action("Reveal", () => download.showContainingDirectory()),
        cancel: action("Cancel", () => download.cancel()),
        retry: action("Retry", () => download.start()),
        review: action("Review", async () => {
          const { DownloadsCommon } = ChromeUtils.importESModule("resource:///modules/DownloadsCommon.sys.mjs");
          const result = await FluxionLibraryDownloads.review(download, {
            confirm: options => DownloadsCommon.confirmUnblockDownload({ ...options, window }),
          });
          if (result === "stale" || result === "unavailable") note.textContent = "This download changed while being reviewed. No decision was applied.";
        }),
        remove: action("Remove", async () => {
          await FluxionLibraryDownloads.remove(download, downloadList);
          note.textContent = download.succeeded
            ? "Removed from the list. The downloaded file is unchanged."
            : "Removed from the list and cleared unfinished download data.";
        }),
      };
      actions.append(...Object.values(controls));
      row._fluxionParts = { primary, title, detail, controls };
      updateDownloadRow(row, item);
    } else {
      const open = item.kind === "folders" ? () => {
        currentBookmarkFolder = item.id;
        return selectSection("bookmarks");
      } : () => openURL(item.url);
      const commands = [[item.kind === "folders" ? "View" : "Open", open]];
      if (item.kind === "folders") {
        commands.push(["New inside", () => createFolder(item.id)]);
        commands.push(["Rename", PROTECTED_FOLDER_GUIDS.has(item.id) ? null : () => renameFolder(item)]);
        commands.push(["Delete", PROTECTED_FOLDER_GUIDS.has(item.id) ? null : () => deleteFolder(item)]);
      } else {
        if (item.kind === "bookmarks") commands.push(["Rename", () => renameBookmark(item)], ["Move", () => moveBookmark(item)]);
        commands.push(["Remove", async stillValid => {
          const name = item.kind === "bookmarks" ? "bookmark" : "history entry";
          if (!Services.prompt.confirm(window, `Remove ${name}?`, `Remove “${item.title}” from ${item.kind}?`) || !stillValid()) return;
          if (item.kind === "bookmarks") await PlacesUtils.bookmarks.remove(item.id);
          else await PlacesUtils.history.remove(item.url);
          note.textContent = `${item.title} removed.`;
          await refreshAll();
        }]);
      }
      row._fluxionLibraryCommands = commands;
      primary.setAttribute("aria-label", `${item.kind === "folders" ? "View folder" : "Open"} ${item.title}`);
      primary.addEventListener("click", () => {
        const target = { row, item, section: item.kind, generation: refreshToken };
        if (validRowTarget(target)) Promise.resolve().then(() => validRowTarget(target) && open()).catch(Cu.reportError);
      });
      const more = create("button", "fluxion-library-more");
      more.type = "button";
      more.tabIndex = -1;
      more.setAttribute("aria-label", `Actions for ${item.title}`);
      more.setAttribute("aria-haspopup", "menu");
      more.setAttribute("aria-expanded", "false");
      more.title = `Actions for ${item.title}`;
      const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      icon.setAttribute("viewBox", "0 0 16 16");
      icon.setAttribute("aria-hidden", "true");
      for (const x of [3, 8, 13]) {
        const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        dot.setAttribute("cx", x); dot.setAttribute("cy", "8"); dot.setAttribute("r", "1.2"); icon.appendChild(dot);
      }
      more.appendChild(icon);
      more.addEventListener("click", event => openRowMenu(row, more, event));
      row.addEventListener("contextmenu", event => openRowMenu(row, primary, event));
      actions.appendChild(more);
    }
    row.append(primary, actions);
    return row;
  }

  function updateDownloadRow(row, item) {
    const { primary, title, detail, controls } = row._fluxionParts;
    const state = FluxionLibraryDownloads.describe(item.raw);
    const text = `${item.detail}${item.url ? ` · ${item.url}` : ""}`;
    if (title.textContent !== item.title) title.textContent = item.title;
    if (detail.textContent !== text) detail.textContent = text;
    if (!state.open && document.activeElement === primary) row.focus({ preventScroll: true });
    if (primary.disabled !== !state.open) primary.disabled = !state.open;
    const accessibleName = `${item.title}, ${state.status}`;
    if (row.getAttribute("aria-label") !== accessibleName) row.setAttribute("aria-label", accessibleName);
    const visible = { open: state.open, reveal: state.open, cancel: state.cancel,
      retry: state.retry, review: state.review, remove: true };
    for (const [name, button] of Object.entries(controls)) {
      if (!visible[name] && document.activeElement === button) row.focus({ preventScroll: true });
      if (button.hidden !== !visible[name]) button.hidden = !visible[name];
    }
    if (controls.retry.textContent !== state.retryLabel) controls.retry.textContent = state.retryLabel;
  }

  function renderDownloads(items) {
    const activeElement = document.activeElement;
    const activeDownload = activeElement?.closest?.(".fluxion-library-row")?._fluxionDownload;
    const activeIndex = [...listNode.children].findIndex(row => row._fluxionDownload === activeDownload);
    const retained = new Set(items.map(item => item.raw));
    for (const [download, row] of downloadRows) {
      if (!retained.has(download)) { row.remove(); downloadRows.delete(download); }
    }
    // Empty-state or other-section nodes are not part of the retained list.
    for (const child of [...listNode.children]) if (!child._fluxionDownload) child.remove();
    let previous = null;
    for (const item of items) {
      let row = downloadRows.get(item.raw);
      if (!row) { row = renderRow(item); downloadRows.set(item.raw, row); }
      else updateDownloadRow(row, item);
      const expected = previous ? previous.nextSibling : listNode.firstChild;
      if (row !== expected) listNode.insertBefore(row, expected);
      previous = row;
    }
    if (activeDownload && !retained.has(activeDownload)) {
      const next = items[Math.max(0, Math.min(activeIndex, items.length - 1))];
      if (next) downloadRows.get(next.raw)?.focus({ preventScroll: true });
      else search.focus({ preventScroll: true });
    } else if (activeDownload && activeElement?.isConnected &&
        !activeElement.hidden && !activeElement.disabled && document.activeElement !== activeElement) {
      // Restart changes Gecko's startTime and can reorder a connected row.
      // insertBefore preserves identity but does not preserve DOM focus.
      activeElement.focus({ preventScroll: true });
    }
  }

  function render() {
    dismissItemMenu();
    if (root.hidden) return;
    const restoreReading = retainedPlaces;
    const focused = document.activeElement;
    const focusedRow = focused?.closest?.(".fluxion-library-row");
    const focusedId = focusedRow?._fluxionLibraryId;
    const focusedPrimary = focusedRow?.firstChild === focused;
    const focusedLabel = focused?.textContent;
    const scrollPosition = content.scrollTop;
    retainedPlaces = false;
    currentSection = tabSection(selectedLibraryTab());
    for (const [id, button] of navButtons) button.setAttribute("aria-current", String(id === currentSection));
    const labels = { history: "History", bookmarks: "Bookmarks", folders: "Bookmark Folders", downloads: "Downloads" };
    heading.textContent = labels[currentSection];
    search.placeholder = `Search ${labels[currentSection].toLocaleLowerCase()}`;
    folderSelect.hidden = currentSection !== "bookmarks";
    addPageButton.hidden = currentSection !== "bookmarks";
    addPageButton.disabled = !lastWebPage;
    newFolderButton.hidden = !["bookmarks", "folders"].includes(currentSection);
    const items = currentSection === "folders" ? folderPage : data[currentSection];
    summary.textContent = `${items.length} items${hasMore ? " · More available" : ""}`;
    renderPageState();
    if (currentSection === "downloads") renderDownloads(items);
    else { downloadRows.clear(); listNode.replaceChildren(); }
    if (!items.length) {
      listNode.appendChild(create("div", "fluxion-library-empty", queryError
        ? "Could not load this page. Try again."
        : loading ? (search.value ? "Searching Library…" : "Loading Library…")
          : previousCursors.length ? "No items on this page"
            : search.value ? "No matching items" : `No ${labels[currentSection].toLocaleLowerCase()} yet`));
      if (queryError) listNode.appendChild(action("Try again", () => refreshAll()));
    } else if (currentSection !== "downloads") {
      const fragment = document.createDocumentFragment();
      for (const item of items) fragment.appendChild(renderRow(item));
      listNode.appendChild(fragment);
    }
    if (restoreReading) {
      if (focusedId) {
        const row = [...listNode.children].find(node => node._fluxionLibraryId === focusedId);
        const control = focusedPrimary ? row?.firstChild
          : [...(row?.children[1]?.children || [])].find(node => node.textContent === focusedLabel);
        (control || search).focus({ preventScroll: true });
      }
      content.scrollTop = scrollPosition;
    }
    libraryNavigation.sync({ restoreFocus: Boolean(focusedRow) });
  }

  function renderPageState() {
    if (currentSection === "downloads") listNode.removeAttribute("aria-describedby");
    else listNode.setAttribute("aria-describedby", navigationHelp.id);
    listNode.setAttribute("aria-busy", String(loading));
    root.dataset.queryState = loading ? "loading" : queryError ? "error" : "ready";
    previousPage.disabled = loading || !previousCursors.length;
    nextPage.disabled = loading || !hasMore;
    pageLabel.textContent = `Page ${previousCursors.length + 1}`;
    if (queryError) note.textContent = queryError;
  }

  function resetPaging() {
    libraryNavigation.reset();
    pageCursor = null;
    previousCursors.length = 0;
    nextCursor = null;
    hasMore = false;
  }

  function invalidateQuery({ reset = true, keepTimer = false, retain = false } = {}) {
    dismissItemMenu();
    refreshToken += 1;
    downloadRefreshToken += 1;
    if (!keepTimer) {
      window.clearTimeout(queryTimer);
      queryTimer = 0;
    }
    if (reset) resetPaging();
    retainedPlaces = retain;
    if (retain) {
      loading = true;
      queryError = "";
      renderPageState();
      return;
    }
    if (currentSection === "folders") folderPage = [];
    else data[currentSection] = [];
    loading = true;
    queryError = "";
    note.textContent = "";
    render();
  }

  function selectSection(id, { preserveSearch = false, navigate = true } = {}) {
    currentSection = FluxionLibraryData.section(id);
    const tab = selectedLibraryTab();
    tab?.setAttribute("fluxion-library-section", currentSection);
    if (tab) tab.label = `Library · ${currentSection[0].toUpperCase()}${currentSection.slice(1)}`;
    if (tab && navigate) {
      const browser = tab.linkedBrowser;
      const target = `about:downloads#${currentSection}`;
      if (browser.currentURI.spec !== target || pendingSections.has(browser)) {
        pendingSections.set(browser, { from: browser.currentURI.spec, section: currentSection });
        try {
          browser.loadURI(Services.io.newURI(target), {
            triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
          });
        } catch (error) {
          pendingSections.delete(browser);
          Cu.reportError(error);
          currentSection = tabSection(tab);
          tab.setAttribute("fluxion-library-section", currentSection);
          tab.label = `Library · ${currentSection[0].toUpperCase()}${currentSection.slice(1)}`;
        }
      }
    }
    window.FluxionUI.refresh();
    if (!preserveSearch) search.value = "";
    invalidateQuery();
    return refreshAll();
  }

  function refreshFolderSelect() {
    const selected = data.folders.some(folder => folder.id === currentBookmarkFolder)
      ? currentBookmarkFolder : "all";
    if (selected !== currentBookmarkFolder) currentBookmarkFolder = selected;
    folderSelect.replaceChildren();
    const all = create("option", "", "All folders");
    all.value = "all";
    folderSelect.appendChild(all);
    for (const folder of data.folders) {
      const option = create("option", "", `${"  ".repeat(folder.depth || 0)}${folder.title}`);
      option.value = folder.id;
      folderSelect.appendChild(option);
    }
    folderSelect.value = currentBookmarkFolder;
  }

  for (const [id, label] of [["history", "History"], ["bookmarks", "Bookmarks"], ["folders", "Folders"], ["downloads", "Downloads"]]) {
    const button = create("button", "", label);
    button.type = "button";
    button.addEventListener("click", () => selectSection(id));
    navButtons.set(id, button);
    nav.appendChild(button);
  }
  const manage = create("button", "", "Advanced organizer…");
  manage.type = "button";
  manage.addEventListener("click", () => window.PlacesCommandHook?.showPlacesOrganizer("AllBookmarks"));
  nav.appendChild(manage);
  folderSelect.addEventListener("change", () => {
    currentBookmarkFolder = folderSelect.value;
    invalidateQuery();
    refreshAll();
  });
  const advancePage = async direction => {
    if (loading || (direction > 0 ? !hasMore : !previousCursors.length)) return;
    const clicked = direction > 0 ? nextPage : previousPage;
    const ownedFocus = document.activeElement === clicked;
    if (direction > 0) {
      previousCursors.push(pageCursor);
      pageCursor = nextCursor;
    } else pageCursor = previousCursors.pop();
    libraryNavigation.reset();
    invalidateQuery({ reset: false });
    // Page controls remain stable during requests. If the clicked control
    // becomes disabled on the first/last page, focus the results deliberately.
    const pagingToken = refreshToken + 1;
    await refreshAll();
    const neutralFocus = document.activeElement === document.body ||
      document.activeElement === document.documentElement;
    if (destroyed || root.hidden || pagingToken !== refreshToken ||
        (document.activeElement !== clicked && !(ownedFocus && neutralFocus))) return;
    if (clicked.disabled) {
      listNode.tabIndex = -1;
      listNode.focus({ preventScroll: true });
    } else clicked.focus({ preventScroll: true });
    content.scrollTop = 0;
  };
  previousPage.addEventListener("click", () => advancePage(-1));
  nextPage.addEventListener("click", () => advancePage(1));
  addPageButton.addEventListener("click", () => saveLastWebPage().catch(error => {
    note.textContent = error.message; Cu.reportError(error);
  }));
  newFolderButton.addEventListener("click", () => createFolder().catch(error => {
    note.textContent = error.message; Cu.reportError(error);
  }));

  function syncVisibility() {
    const tab = selectedLibraryTab();
    const visible = Boolean(tab);
    const wasVisible = !root.hidden;
    if (!visible) dismissItemMenu();
    root.hidden = !visible;
    if (visible) contentDeck.hidden = true;
    else if (!document.documentElement.hasAttribute("data-fluxion-settings-visible")) contentDeck.hidden = false;
    document.documentElement.toggleAttribute("data-fluxion-library-visible", visible);
    if (visible) {
      privacy.textContent = PrivateBrowsingUtils.isWindowPrivate(window) ? "Private downloads only" : "Stored in this Fluxion profile";
      // A newly opened owned tab starts at about:blank before Gecko commits
      // about:downloads. Its section has not changed: retain live rows/focus.
      const changed = tab !== visibleTab || tabSection(tab) !== currentSection;
      visibleTab = tab;
      if (changed) selectSection(tabSection(tab), { navigate: false });
      else if (!wasVisible) refreshAll();
    } else {
      refreshToken += 1;
      downloadRefreshToken += 1;
      window.clearTimeout(queryTimer);
      retainedPlaces = false;
      loading = false;
    }
  }

  function rememberSelectedPage() {
    const url = gBrowser.selectedBrowser?.currentURI?.spec || "";
    if (/^https?:\/\//i.test(url)) {
      lastWebPage = { url, title: gBrowser.selectedTab?.label || url };
    }
  }

  function handleTabSelect() {
    rememberSelectedPage();
    syncVisibility();
  }

  function open(section = "history") {
    rememberSelectedPage();
    const id = FluxionLibraryData.section(section);
    let tab = [...gBrowser.tabs].find(isLibraryTab);
    const created = !tab;
    if (!tab) {
      tab = gBrowser.addTrustedTab(`about:downloads#${id}`);
      window.FluxionUI.setTabWorkspace(tab, window.FluxionUI.currentWorkspace());
    }
    tab.setAttribute("fluxion-library-section", id);
    window.FluxionUI.selectTab(tab);
    if (created) syncVisibility();
    else selectSection(id);
  }

  gBrowser.tabContainer.addEventListener("TabSelect", handleTabSelect);
  const progressListener = {
    onLocationChange(browser) {
      pendingSections.delete(browser);
      if (browser === gBrowser.selectedBrowser) handleTabSelect();
    },
  };
  gBrowser.addTabsProgressListener(progressListener);
  search.addEventListener("input", () => {
    invalidateQuery();
    queryTimer = window.setTimeout(() => refreshAll(), 140);
  });
  // Keep reading geometry during background updates, but never permit actions
  // against a stale Places snapshot. Do not use inert: it discards row focus.
  for (const eventType of ["click", "auxclick", "keydown"]) {
    listNode.addEventListener(eventType, event => {
      if (!retainedPlaces || !loading) return;
      if (eventType === "keydown" && !["Enter", " "].includes(event.key)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
  }
  const onPlacesChanged = events => {
    if (destroyed || root.hidden) return;
    const affected = FluxionLibraryChanges.affected(events);
    if (!affected[currentSection]) return;
    // Keep a first-event deadline: continuous visits must not starve updates.
    // Keyset cursors stay valid when new entries arrive ahead of this page.
    const removesEvidence = events.some(event => /removed|cleared|purge/.test(event.type));
    invalidateQuery({ reset: false, keepTimer: true, retain: !removesEvidence });
    if (!queryTimer) queryTimer = window.setTimeout(() => refreshAll(), 100);
  };
  PlacesUtils.observers.addListener(FluxionLibraryChanges.TYPES, onPlacesChanged);
  window.addEventListener("unload", () => {
    destroyed = true;
    dismissItemMenu();
    libraryNavigation.destroy();
    itemMenu.remove();
    retainedPlaces = false;
    refreshToken += 1;
    downloadRefreshToken += 1;
    window.clearTimeout(queryTimer);
    PlacesUtils.observers.removeListener(FluxionLibraryChanges.TYPES, onPlacesChanged);
    downloadRefresh.close();
    gBrowser.tabContainer.removeEventListener("TabSelect", handleTabSelect);
    gBrowser.removeTabsProgressListener(progressListener);
    if (downloadList && downloadView) downloadList.removeView(downloadView);
    root.remove();
    style.remove();
  }, { once: true });
  try { SessionStore.persistTabAttribute("fluxion-library-section"); } catch (_) {}
  window.FluxionLibrary = Object.freeze({ open, refresh: refreshAll });
  Services.prefs.setStringPref("fluxion.library.health", "places-downloads-library-loaded");
  Services.prefs.savePrefFile(null);
  rememberSelectedPage();
  syncVisibility();

  if (Services.env.get("FLUXION_VISUAL_LIBRARY_TEST") === "1") {
    window.setTimeout(async () => {
      try {
        window.FluxionPalette?.close();
        const url = "https://example.edu/fluxion-library";
        await PlacesUtils.history.insert({
          url, title: "Fluxion Library Reference",
          visits: [{ date: new Date(), transition: PlacesUtils.history.TRANSITION_TYPED }],
        });
        if (!(await PlacesUtils.bookmarks.fetch({ url }))) {
          await PlacesUtils.bookmarks.insert({
            parentGuid: PlacesUtils.bookmarks.unfiledGuid,
            title: "Fluxion Library Reference", url,
          });
        }
        if (!downloadList) await initialiseDownloads();
        const target = Services.dirsvc.get("TmpD", Ci.nsIFile);
        target.append("Fluxion-Library-Preview.pdf");
        const download = await Downloads.createDownload({
          source: "https://example.edu/Fluxion-Library-Preview.pdf",
          target: target.path,
        });
        await downloadList.add(download);
        open("history");
        await refreshAll();
        const hasHistory = data.history.some(item => item.url === url) && listNode.textContent.includes("Fluxion Library Reference");
        open("bookmarks");
        await refreshAll();
        const hasBookmark = data.bookmarks.some(item => item.url === url) && listNode.textContent.includes("Fluxion Library Reference");
        open("downloads");
        const flowRect = document.getElementById("fluxion-flow")?.getBoundingClientRect();
        const rootRect = root.getBoundingClientRect();
        const navRect = nav.getBoundingClientRect();
        const contentRect = content.getBoundingClientRect();
        await refreshAll();
        const hasDownload = data.downloads.some(item => item.title === "Fluxion-Library-Preview.pdf");
        if (hasHistory && hasBookmark && hasDownload &&
            rootRect.left >= flowRect?.right - 1 && navRect.left >= rootRect.left - 1 &&
            navRect.width >= 130 && contentRect.left >= navRect.right - 1 &&
            contentRect.width >= 360) {
          Services.prefs.setStringPref("fluxion.library.visual.health", "history-bookmarks-downloads-rendered");
          Services.prefs.setStringPref(
            "fluxion.library.geometry.visual.health",
            "library-nav-and-content-clear-flow",
          );
          Services.prefs.savePrefFile(null);
        } else {
          Services.prefs.setStringPref(
            "fluxion.library.visual.error",
            `history=${hasHistory} bookmark=${hasBookmark} download=${hasDownload} ` +
              `flow=${flowRect?.left},${flowRect?.right} root=${rootRect.left},${rootRect.right} ` +
              `nav=${navRect.left},${navRect.right} content=${contentRect.left},${contentRect.right}`,
          );
          Services.prefs.savePrefFile(null);
        }
      } catch (error) {
        Services.prefs.setStringPref("fluxion.library.visual.error", String(error));
        Services.prefs.savePrefFile(null);
        Cu.reportError(error);
      }
    }, 12500);
  }
  if (Services.env.get("FLUXION_VISUAL_BOOKMARK_FOLDER_TEST") === "1") {
    window.setTimeout(async () => {
      try {
        const url = "https://example.edu/fluxion-library";
        open("folders");
        await refreshAll();
        let folder = data.folders.find(item => item.title === "Fluxion Research");
        if (!folder) {
          const inserted = await PlacesUtils.bookmarks.insert({
            parentGuid: PlacesUtils.bookmarks.unfiledGuid,
            type: PlacesUtils.bookmarks.TYPE_FOLDER,
            title: "Fluxion Research",
            index: PlacesUtils.bookmarks.DEFAULT_INDEX,
          });
          folder = { id: inserted.guid, title: inserted.title };
        }
        const bookmark = await PlacesUtils.bookmarks.fetch({ url });
        if (!bookmark) throw new Error("Library folder gate could not find its bookmark");
        await PlacesUtils.bookmarks.update({
          guid: bookmark.guid,
          title: "Fluxion Library Reference — Filed",
          parentGuid: folder.id,
          index: PlacesUtils.bookmarks.DEFAULT_INDEX,
        });
        currentBookmarkFolder = folder.id;
        open("bookmarks");
        await refreshAll();
        const filed = data.bookmarks.find(item => item.id === bookmark.guid);
        if (filed?.parentGuid === folder.id &&
            data.folders.some(item => item.id === folder.id) &&
            listNode.textContent.includes("Fluxion Library Reference — Filed")) {
          Services.prefs.setStringPref("fluxion.library.folders.visual.health", "folder-created-and-bookmark-moved");
          Services.prefs.savePrefFile(null);
        }
      } catch (error) {
        Services.prefs.setStringPref("fluxion.library.folders.visual.error", String(error));
        Services.prefs.savePrefFile(null);
        Cu.reportError(error);
      }
    }, 15500);
  }
})(window);
