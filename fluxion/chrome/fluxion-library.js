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
      min-width: 0; flex: 1; display: flex; flex-direction: column;
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
    .fluxion-library-open:focus-visible, .fluxion-library-action:focus-visible {
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
    .fluxion-library-summary { color: var(--fluxion-muted); font-size: 11px; }
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
  const summary = create("span", "fluxion-library-summary");
  sectionHead.append(heading, summary);
  const listNode = create("div", "fluxion-library-list");
  listNode.setAttribute("role", "list");
  const note = create("div", "fluxion-library-note");
  note.setAttribute("role", "status");
  content.append(sectionHead, listNode, note);
  body.append(nav, content);
  root.append(header, body);
  browserBox.appendChild(root);

  const data = { history: [], bookmarks: [], downloads: [] };
  const navButtons = new Map();
  let currentSection = "history";
  let refreshToken = 0;
  let downloadList = null;
  let downloadView = null;

  function selectedLibraryTab() {
    const browser = gBrowser.selectedBrowser;
    return browser?.currentURI?.spec.startsWith("about:downloads") ? gBrowser.selectedTab : null;
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
             b.dateAdded / 1000 AS added, COALESCE(parent.title, 'Bookmarks') AS folder
      FROM moz_bookmarks b JOIN moz_places p ON p.id = b.fk
      LEFT JOIN moz_bookmarks parent ON parent.id = b.parent
      WHERE b.type = 1 ORDER BY b.dateAdded DESC LIMIT 500
    `);
    return rows.map(row => FluxionLibraryData.normalise({
      guid: row.getResultByName("guid"),
      url: row.getResultByName("url"),
      title: row.getResultByName("title"),
      detail: `${row.getResultByName("folder")} · Saved ${formatWhen(row.getResultByName("added"))}`,
      timestamp: row.getResultByName("added"),
    }, "bookmarks"));
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
    const [history, bookmarks, downloads] = await Promise.all([
      queryHistory(), queryBookmarks(), queryDownloads(),
    ]);
    if (token !== refreshToken) return;
    data.history = history;
    data.bookmarks = bookmarks;
    data.downloads = downloads;
    render();
  }

  let refreshTimer = 0;
  function scheduleRefresh() {
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => refreshAll().catch(Cu.reportError), 100);
  }

  function openURL(url) {
    if (!url) return;
    const tab = gBrowser.addTrustedTab(FluxionUrl.resolveNavigation(url));
    tab.setAttribute("fluxion-workspace", window.FluxionUI.currentWorkspace());
    gBrowser.selectedTab = tab;
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

  function renderRow(item) {
    const row = create("div", "fluxion-library-row");
    row.setAttribute("role", "listitem");
    const primary = create("button", "fluxion-library-open");
    primary.type = "button";
    const title = create("div", "fluxion-library-row-title", item.title);
    const detail = create("div", "fluxion-library-row-detail", item.kind === "downloads"
      ? `${item.detail}${item.url ? ` · ${item.url}` : ""}`
      : `${item.detail} · ${item.url}`);
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
    } else {
      primary.addEventListener("click", () => openURL(item.url));
      actions.append(action("Open", () => openURL(item.url)));
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
    const labels = { history: "History", bookmarks: "Bookmarks", downloads: "Downloads" };
    heading.textContent = labels[currentSection];
    search.placeholder = `Search ${labels[currentSection].toLocaleLowerCase()}`;
    const items = FluxionLibraryData.filter(data[currentSection], search.value, 300);
    summary.textContent = `${items.length}${items.length !== data[currentSection].length ? ` of ${data[currentSection].length}` : ""} items`;
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
    search.value = "";
    note.textContent = "";
    render();
  }

  for (const [id, label] of [["history", "History"], ["bookmarks", "Bookmarks"], ["downloads", "Downloads"]]) {
    const button = create("button", "", label);
    button.type = "button";
    button.addEventListener("click", () => selectSection(id));
    navButtons.set(id, button);
    nav.appendChild(button);
  }
  const manage = create("button", "", "Manage bookmark folders…");
  manage.type = "button";
  manage.addEventListener("click", () => window.PlacesCommandHook?.showPlacesOrganizer("AllBookmarks"));
  nav.appendChild(manage);

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

  function open(section = "history") {
    const id = FluxionLibraryData.section(section);
    let tab = [...gBrowser.tabs].find(candidate => candidate.linkedBrowser?.currentURI?.spec.startsWith("about:downloads"));
    if (!tab) {
      tab = gBrowser.addTrustedTab(`about:downloads#${id}`);
      tab.setAttribute("fluxion-workspace", window.FluxionUI.currentWorkspace());
    }
    tab.setAttribute("fluxion-library-section", id);
    window.FluxionUI.selectTab(tab);
    syncVisibility();
  }

  gBrowser.tabContainer.addEventListener("TabSelect", syncVisibility);
  const progressListener = { onLocationChange: syncVisibility };
  gBrowser.addTabsProgressListener(progressListener);
  search.addEventListener("input", render);
  window.addEventListener("unload", () => {
    window.clearTimeout(refreshTimer);
    gBrowser.tabContainer.removeEventListener("TabSelect", syncVisibility);
    gBrowser.removeTabsProgressListener(progressListener);
    if (downloadList && downloadView) downloadList.removeView(downloadView);
    root.remove();
    style.remove();
  }, { once: true });
  try { SessionStore.persistTabAttribute("fluxion-library-section"); } catch (_) {}
  window.FluxionLibrary = Object.freeze({ open, refresh: refreshAll });
  Services.prefs.setStringPref("fluxion.library.health", "places-downloads-library-loaded");
  Services.prefs.savePrefFile(null);
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
        await refreshAll();
        if (data.history.some(item => item.url === url) &&
            data.bookmarks.some(item => item.url === url) &&
            data.downloads.some(item => item.title === "Fluxion-Library-Preview.pdf")) {
          Services.prefs.setStringPref("fluxion.library.visual.health", "history-bookmarks-downloads-rendered");
          Services.prefs.savePrefFile(null);
        }
      } catch (error) {
        Services.prefs.setStringPref("fluxion.library.visual.error", String(error));
        Services.prefs.savePrefFile(null);
        Cu.reportError(error);
      }
    }, 12500);
  }
})(window);
