/* global gBrowser, Services, SessionStore, ChromeUtils, FluxionLibraryData, FluxionUrl, Ci, Cu */
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
    .fluxion-library-open:focus-visible, .fluxion-library-action:focus-visible,
    .fluxion-library-folder-select:focus-visible {
      outline: 2px solid var(--fluxion-accent); outline-offset: 1px;
    }
    .fluxion-library-private { color: var(--fluxion-muted); font-size: 11px; }
    .fluxion-library-body { min-height: 0; flex: 1; display: grid; grid-template-columns: 164px minmax(420px, 820px) 1fr; overflow: auto; }
    .fluxion-library-nav { padding: 24px 12px; border-inline-end: 1px solid var(--fluxion-line); background: var(--fluxion-bg); }
    .fluxion-library-nav button {
      width: 100%; height: 32px; border: 0; border-radius: 4px; padding: 0 10px;
      color: var(--fluxion-muted); background: transparent; text-align: start; font: inherit;
    }
    .fluxion-library-nav button:hover { color: var(--fluxion-ink); background: var(--fluxion-hover); }
    .fluxion-library-nav button[aria-current="true"] { color: var(--fluxion-ink); background: var(--fluxion-selected); font-weight: 600; }
    .fluxion-library-content { padding: 26px 30px 70px; }
    .fluxion-library-section-head { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
    .fluxion-library-section-head h2 { margin: 0; font-size: 22px; letter-spacing: -.025em; }
    .fluxion-library-section-tools { display: flex; align-items: center; justify-content: flex-end; gap: 6px; }
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
    .fluxion-library-open { min-width: 0; border: 0; padding: 0; color: inherit; background: transparent; text-align: start; font: inherit; }
    .fluxion-library-open:hover .fluxion-library-row-title { text-decoration: underline; text-decoration-thickness: 1px; }
    .fluxion-library-row-title, .fluxion-library-row-detail { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .fluxion-library-row-title { font-weight: 550; }
    .fluxion-library-row-detail { margin-top: 3px; color: var(--fluxion-muted); font-size: 11px; }
    .fluxion-library-actions { display: flex; gap: 5px; }
    .fluxion-library-action {
      min-height: 27px; border: 1px solid var(--fluxion-line); border-radius: 4px; padding: 3px 8px;
      color: var(--fluxion-muted); background: var(--fluxion-bg); font: inherit; font-size: 11px;
    }
    .fluxion-library-action:hover { color: var(--fluxion-ink); background: var(--fluxion-hover); }
    .fluxion-library-empty { padding: 48px 8px; color: var(--fluxion-muted); text-align: center; }
    .fluxion-library-note { min-height: 18px; margin-top: 12px; color: var(--fluxion-muted); font-size: 11px; }
    @media (max-width: 820px) {
      .fluxion-library-header { grid-template-columns: 1fr; gap: 8px; padding: 12px 18px; }
      .fluxion-library-body { grid-template-columns: 130px minmax(360px, 1fr); }
      .fluxion-library-content { padding-inline: 20px; }
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
  const note = create("div", "fluxion-library-note");
  note.setAttribute("role", "status");
  content.append(sectionHead, listNode, note);
  body.append(nav, content);
  root.append(header, body);
  browserBox.appendChild(root);

  const data = { history: [], bookmarks: [], folders: [], downloads: [] };
  const navButtons = new Map();
  let currentSection = "history";
  let currentBookmarkFolder = "all";
  let lastWebPage = null;
  let refreshToken = 0;
  let downloadList = null;
  let downloadView = null;

  function isLibraryTab(tab) {
    const url = tab?.linkedBrowser?.currentURI?.spec || "";
    return url.startsWith("about:downloads") ||
      (url === "about:blank" && tab?.hasAttribute("fluxion-library-section"));
  }

  function selectedLibraryTab() {
    return isLibraryTab(gBrowser.selectedTab) ? gBrowser.selectedTab : null;
  }

  function tabSection(tab) {
    if (!tab) return "history";
    const stored = tab.getAttribute("fluxion-library-section");
    if (stored) return FluxionLibraryData.section(stored);
    const hash = tab.linkedBrowser?.currentURI?.spec.split("#")[1];
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
    if (download.succeeded) return "Finished";
    if (download.error) return "Failed";
    if (download.canceled) return "Canceled";
    if (download.stopped) return download.hasPartialData ? "Paused" : "Stopped";
    if (download.hasProgress && download.totalBytes > 0) {
      return `${Math.round((download.currentBytes / download.totalBytes) * 100)}%`;
    }
    return "Downloading";
  }

  async function queryHistory() {
    const db = await PlacesUtils.promiseDBConnection();
    const rows = await db.execute(`
      SELECT p.url, COALESCE(NULLIF(p.title, ''), p.url) AS title,
             p.last_visit_date / 1000 AS visited, COUNT(v.id) AS visits
      FROM moz_places p JOIN moz_historyvisits v ON v.place_id = p.id
      WHERE p.hidden = 0 AND p.last_visit_date IS NOT NULL
      GROUP BY p.id ORDER BY p.last_visit_date DESC LIMIT 300
    `);
    return rows.map(row => FluxionLibraryData.normalise({
      id: row.getResultByName("url"),
      url: row.getResultByName("url"),
      title: row.getResultByName("title"),
      detail: `${row.getResultByName("visits")} visits · ${formatWhen(row.getResultByName("visited"))}`,
      timestamp: row.getResultByName("visited"),
    }, "history"));
  }

  async function queryBookmarks() {
    const db = await PlacesUtils.promiseDBConnection();
    const rows = await db.execute(`
      SELECT b.guid, COALESCE(NULLIF(b.title, ''), p.url) AS title, p.url,
             b.dateAdded / 1000 AS added, parent.guid AS parentGuid,
             CASE parent.guid
               WHEN :toolbarGuid THEN 'Bookmarks Toolbar'
               WHEN :menuGuid THEN 'Bookmarks Menu'
               WHEN :unfiledGuid THEN 'Other Bookmarks'
               WHEN :mobileGuid THEN 'Mobile Bookmarks'
               ELSE COALESCE(NULLIF(parent.title, ''), 'Bookmarks')
             END AS folder
      FROM moz_bookmarks b JOIN moz_places p ON p.id = b.fk
      LEFT JOIN moz_bookmarks parent ON parent.id = b.parent
      WHERE b.type = 1 ORDER BY b.dateAdded DESC LIMIT 500
    `, {
      toolbarGuid: PlacesUtils.bookmarks.toolbarGuid,
      menuGuid: PlacesUtils.bookmarks.menuGuid,
      unfiledGuid: PlacesUtils.bookmarks.unfiledGuid,
      mobileGuid: PlacesUtils.bookmarks.mobileGuid,
    });
    return rows.map(row => FluxionLibraryData.normalise({
      guid: row.getResultByName("guid"),
      url: row.getResultByName("url"),
      title: row.getResultByName("title"),
      detail: `${row.getResultByName("folder")} · Saved ${formatWhen(row.getResultByName("added"))}`,
      parentGuid: row.getResultByName("parentGuid"),
      timestamp: row.getResultByName("added"),
    }, "bookmarks"));
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
    const type = PrivateBrowsingUtils.isWindowPrivate(window) ? Downloads.PRIVATE : Downloads.PUBLIC;
    downloadList = await Downloads.getList(type);
    downloadView = {
      onDownloadAdded: scheduleRefresh,
      onDownloadChanged: scheduleRefresh,
      onDownloadRemoved: scheduleRefresh,
    };
    await downloadList.addView(downloadView);
  }

  async function queryDownloads() {
    if (!downloadList) await initialiseDownloads();
    const downloads = await downloadList.getAll();
    return downloads.sort((a, b) => (b.startTime?.getTime() || 0) - (a.startTime?.getTime() || 0))
      .slice(0, 300).map((download, index) => {
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
  }

  async function refreshAll() {
    const token = ++refreshToken;
    const [history, bookmarks, folders, downloads] = await Promise.all([
      queryHistory(), queryBookmarks(), queryFolders(), queryDownloads(),
    ]);
    if (token !== refreshToken) return;
    data.history = history;
    data.bookmarks = bookmarks;
    data.folders = folders;
    data.downloads = downloads;
    refreshFolderSelect();
    render();
  }

  let refreshTimer = 0;
  function scheduleRefresh() {
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => refreshAll().catch(Cu.reportError), 100);
  }

  async function openURL(url) {
    if (!url) return;
    const route = FluxionUrl.classifyNavigation(url);
    if (route.kind === "search") return window.FluxionWebSearch.open(route.value);
    const tab = gBrowser.addTrustedTab(route.value);
    tab.setAttribute("fluxion-workspace", window.FluxionUI.currentWorkspace());
    gBrowser.selectedTab = tab;
    return tab;
  }

  function action(label, handler) {
    const button = create("button", "fluxion-library-action", label);
    button.type = "button";
    button.addEventListener("click", event => {
      event.stopPropagation();
      Promise.resolve(handler()).catch(error => {
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
    const parentGuid = currentBookmarkFolder !== "all"
      ? currentBookmarkFolder : PlacesUtils.bookmarks.unfiledGuid;
    const existing = [];
    await PlacesUtils.bookmarks.fetch({ url: lastWebPage.url }, item => existing.push(item));
    if (existing.some(item => item.parentGuid === parentGuid)) {
      note.textContent = "This page is already saved in the selected folder.";
      return;
    }
    await PlacesUtils.bookmarks.insert({
      parentGuid,
      title: lastWebPage.title || lastWebPage.url,
      url: lastWebPage.url,
      index: PlacesUtils.bookmarks.DEFAULT_INDEX,
    });
    note.textContent = `Saved “${lastWebPage.title || lastWebPage.url}”.`;
    await refreshAll();
  }

  function renderRow(item) {
    const row = create("div", "fluxion-library-row");
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
      primary.disabled = !download?.succeeded;
      primary.addEventListener("click", () => download.launch());
      if (download?.succeeded) {
        actions.append(action("Open", () => download.launch()), action("Reveal", () => download.showContainingDirectory()));
      } else if (!download?.stopped) {
        actions.append(action("Cancel", () => download.cancel()));
      } else {
        actions.append(action("Retry", () => download.start()));
      }
      actions.append(action("Remove", async () => {
        if (!download.stopped) await download.cancel();
        await downloadList.remove(download);
      }));
    } else if (item.kind === "folders") {
      const viewFolder = () => {
        currentBookmarkFolder = item.id;
        selectSection("bookmarks");
      };
      primary.addEventListener("click", viewFolder);
      actions.append(action("View", viewFolder), action("New inside", () => createFolder(item.id)));
      if (!PROTECTED_FOLDER_GUIDS.has(item.id)) {
        actions.append(action("Rename", () => renameFolder(item)), action("Delete", () => deleteFolder(item)));
      }
    } else {
      primary.addEventListener("click", () => openURL(item.url));
      actions.append(action("Open", () => openURL(item.url)));
      if (item.kind === "bookmarks") {
        actions.append(action("Rename", () => renameBookmark(item)), action("Move", () => moveBookmark(item)));
      }
      actions.append(action("Remove", async () => {
        const name = item.kind === "bookmarks" ? "bookmark" : "history entry";
        if (!Services.prompt.confirm(window, `Remove ${name}?`, `Remove “${item.title}” from ${item.kind}?`)) return;
        if (item.kind === "bookmarks") await PlacesUtils.bookmarks.remove(item.id);
        else await PlacesUtils.history.remove(item.url);
        note.textContent = `${item.title} removed.`;
        await refreshAll();
      }));
    }
    row.append(primary, actions);
    return row;
  }

  function render() {
    if (root.hidden) return;
    currentSection = tabSection(selectedLibraryTab());
    for (const [id, button] of navButtons) button.setAttribute("aria-current", String(id === currentSection));
    const labels = { history: "History", bookmarks: "Bookmarks", folders: "Bookmark Folders", downloads: "Downloads" };
    heading.textContent = labels[currentSection];
    search.placeholder = `Search ${labels[currentSection].toLocaleLowerCase()}`;
    folderSelect.hidden = currentSection !== "bookmarks";
    addPageButton.hidden = currentSection !== "bookmarks";
    addPageButton.disabled = !lastWebPage;
    newFolderButton.hidden = !["bookmarks", "folders"].includes(currentSection);
    const sourceItems = currentSection === "bookmarks"
      ? FluxionLibraryData.bookmarksInFolder(data.bookmarks, currentBookmarkFolder)
      : data[currentSection];
    const items = FluxionLibraryData.filter(sourceItems, search.value, 300);
    summary.textContent = `${items.length}${items.length !== sourceItems.length ? ` of ${sourceItems.length}` : ""} items`;
    listNode.replaceChildren();
    if (!items.length) {
      listNode.appendChild(create("div", "fluxion-library-empty", search.value ? "No matching items" : `No ${labels[currentSection].toLocaleLowerCase()} yet`));
    } else {
      const fragment = document.createDocumentFragment();
      for (const item of items) fragment.appendChild(renderRow(item));
      listNode.appendChild(fragment);
    }
  }

  function selectSection(id) {
    currentSection = FluxionLibraryData.section(id);
    const tab = selectedLibraryTab();
    tab?.setAttribute("fluxion-library-section", currentSection);
    if (tab) tab.label = `Library · ${currentSection[0].toUpperCase()}${currentSection.slice(1)}`;
    window.FluxionUI.refresh();
    search.value = "";
    note.textContent = "";
    render();
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
    search.value = "";
    render();
  });
  addPageButton.addEventListener("click", () => saveLastWebPage().catch(error => {
    note.textContent = error.message; Cu.reportError(error);
  }));
  newFolderButton.addEventListener("click", () => createFolder().catch(error => {
    note.textContent = error.message; Cu.reportError(error);
  }));

  function syncVisibility() {
    const tab = selectedLibraryTab();
    const visible = Boolean(tab);
    root.hidden = !visible;
    if (visible) contentDeck.hidden = true;
    else if (!document.documentElement.hasAttribute("data-fluxion-settings-visible")) contentDeck.hidden = false;
    document.documentElement.toggleAttribute("data-fluxion-library-visible", visible);
    if (visible) {
      privacy.textContent = PrivateBrowsingUtils.isWindowPrivate(window) ? "Private downloads only" : "Stored in this Fluxion profile";
      selectSection(tabSection(tab));
      refreshAll().catch(error => { note.textContent = error.message; Cu.reportError(error); });
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
    if (!tab) {
      tab = gBrowser.addTrustedTab(`about:downloads#${id}`);
      tab.setAttribute("fluxion-workspace", window.FluxionUI.currentWorkspace());
    }
    tab.setAttribute("fluxion-library-section", id);
    window.FluxionUI.selectTab(tab);
    syncVisibility();
  }

  gBrowser.tabContainer.addEventListener("TabSelect", handleTabSelect);
  const progressListener = {
    onLocationChange(browser) {
      if (browser === gBrowser.selectedBrowser) handleTabSelect();
    },
  };
  gBrowser.addTabsProgressListener(progressListener);
  search.addEventListener("input", render);
  window.addEventListener("unload", () => {
    window.clearTimeout(refreshTimer);
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
        open("downloads");
        const flowRect = document.getElementById("fluxion-flow")?.getBoundingClientRect();
        const rootRect = root.getBoundingClientRect();
        const navRect = nav.getBoundingClientRect();
        const contentRect = content.getBoundingClientRect();
        await refreshAll();
        const hasHistory = data.history.some(item => item.url === url);
        const hasBookmark = data.bookmarks.some(item => item.url === url);
        const hasDownload = data.downloads.some(item => item.title === "Fluxion-Library-Preview.pdf");
        if (hasHistory && hasBookmark && hasDownload &&
            rootRect.left >= flowRect?.right - 1 && navRect.left >= rootRect.left - 1 &&
            contentRect.left >= navRect.right - 1) {
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
        selectSection("bookmarks");
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
