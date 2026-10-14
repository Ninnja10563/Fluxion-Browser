// User-initiated transfers only. No profile discovery, background reads, or
// copying of cookies, keys, extensions, or another browser's profile files.
export const IMPORT_FILE_LIMIT = 32 * 1024 * 1024;
export const IMPORT_TAB_LIMIT = 100;
export const IMPORT_SOURCES = Object.freeze([
  Object.freeze({ id: "zen", label: "Zen", help: "In Zen, export bookmarks as HTML from Manage Bookmarks and passwords as CSV from Passwords. Workspace layouts, extensions and signed-in sessions are not transferred." }),
  Object.freeze({ id: "firefox", label: "Firefox", help: "In Firefox, export bookmarks as HTML from Manage Bookmarks and passwords as CSV from Passwords. This adds data without replacing either browser’s profile." }),
  Object.freeze({ id: "chrome", label: "Chrome", help: "Use the browser import dialog to choose an available Chrome profile and the data to transfer. Your system may request access. HTML and CSV exports also work." }),
  Object.freeze({ id: "other", label: "Another browser", help: "Choose an available browser in the import dialog, or use exported bookmarks and passwords. Available data depends on the source browser and system permissions." }),
]);

export function parseTabURLs(text) {
  if (typeof text !== "string" || text.length > 256 * 1024) throw new Error("Paste at most 100 web addresses.");
  const urls = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let url;
    try { url = new URL(line.trim()); } catch (_) { throw new Error("Use one complete https:// or http:// address per line."); }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
      throw new Error("Only web addresses without embedded passwords can be imported.");
    }
    if (!urls.includes(url.href)) urls.push(url.href);
    if (urls.length > IMPORT_TAB_LIMIT) throw new Error("Import up to 100 tabs at a time.");
  }
  if (!urls.length) throw new Error("Paste at least one web address first.");
  return urls;
}

export function createBrowserImport({ allowed, chooseFile, stat, importBookmarks, importPasswords, openWizard,
  confirmPasswords = () => true, confirmTabs = () => true, openTabs }) {
  let busy = false;
  const check = () => { if (!allowed()) throw new Error("Import is unavailable in this window or is disabled by your administrator."); };
  return Object.freeze({
    async run(kind, source = "other") {
      if (!["browser", "bookmarks", "passwords"].includes(kind)) throw new Error("Unknown import type.");
      if (!IMPORT_SOURCES.some(item => item.id === source)) throw new Error("Choose an import source.");
      check();
      if (busy) return { state: "busy" };
      busy = true;
      try {
        if (kind === "browser") {
          if (!["chrome", "other"].includes(source)) throw new Error("Use an HTML or CSV export for this browser; full-profile copying is not supported.");
          await openWizard(source);
          return { state: "wizard" };
        }
        if (kind === "passwords" && !await confirmPasswords()) return { state: "cancelled" };
        check();
        const path = await chooseFile(kind);
        if (!path) return { state: "cancelled" };
        check();
        const extension = kind === "bookmarks" ? /\.html?$/i : /\.(csv|tsv)$/i;
        if (!extension.test(path)) throw new Error(kind === "bookmarks" ? "Choose a bookmarks HTML export, not a profile backup." : "Choose a password CSV or TSV export.");
        const info = await stat(path);
        if (info.type !== "regular" || !Number.isSafeInteger(info.size) || info.size <= 0 || info.size > IMPORT_FILE_LIMIT) {
          throw new Error("Choose a non-empty export file smaller than 32 MB.");
        }
        check();
        if (kind === "bookmarks") {
          const count = await importBookmarks(path);
          return { state: "done", kind, added: Number.isSafeInteger(count) ? count : 0 };
        }
        const entries = await importPasswords(path);
        return { state: "done", kind, added: entries.filter(item => item.result === "added").length,
          updated: entries.filter(item => item.result === "modified").length,
          errors: entries.filter(item => String(item.result).startsWith("error")).length };
      } finally { busy = false; }
    },
    async tabs(text) {
      check();
      if (busy) return { state: "busy" };
      const urls = parseTabURLs(text);
      busy = true;
      try {
        if (!await confirmTabs(urls.length)) return { state: "cancelled" };
        check();
        const added = await openTabs(urls);
        return { state: "done", kind: "tabs", added };
      } finally { busy = false; }
    },
  });
}

export function forWindow(window) {
  const allowed = () => !window.closed && Services.policies?.isAllowed("profileImport") !== false &&
    !ChromeUtils.importESModule("resource://gre/modules/PrivateBrowsingUtils.sys.mjs").PrivateBrowsingUtils.isWindowPrivate(window);
  return createBrowserImport({
    allowed,
    chooseFile: kind => {
      const picker = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
      picker.init(window.browsingContext, kind === "bookmarks" ? "Import bookmarks from HTML" : "Import passwords from CSV", Ci.nsIFilePicker.modeOpen);
      picker.appendFilter(kind === "bookmarks" ? "Bookmarks HTML" : "Passwords CSV / TSV", kind === "bookmarks" ? "*.html;*.htm" : "*.csv;*.tsv");
      return new Promise(resolve => picker.open(result => resolve(result === Ci.nsIFilePicker.returnOK ? picker.file?.path : null)));
    },
    stat: path => IOUtils.stat(path),
    importBookmarks: path => ChromeUtils.importESModule("resource://gre/modules/BookmarkHTMLUtils.sys.mjs")
      .BookmarkHTMLUtils.importFromFile(path, { replace: false }),
    importPasswords: path => ChromeUtils.importESModule("resource://gre/modules/LoginCSVImport.sys.mjs").LoginCSVImport.importFromCSV(path),
    confirmPasswords: () => Services.prompt.confirm(window, "Import passwords", "A password export contains readable passwords. Choose only your own export, then remove it securely after importing. Continue?"),
    confirmTabs: count => Services.prompt.confirm(window, "Import tabs", `Add ${count} tabs to the current workspace? They will load when selected. Accounts and cookies are not transferred.`),
    openTabs: urls => {
      const workspace = window.FluxionUI.currentWorkspace();
      let added = 0;
      for (const url of urls) {
        if (!allowed() || !window.FluxionUI.workspaces().some(item => item.id === workspace)) break;
        const tab = window.gBrowser.addTrustedTab(url, { createLazyBrowser: true, skipAnimation: true });
        window.FluxionUI.setTabWorkspace(tab, workspace);
        added++;
      }
      return added;
    },
    openWizard: source => {
      const { MigrationUtils } = ChromeUtils.importESModule("resource:///modules/MigrationUtils.sys.mjs");
      return MigrationUtils.showMigrationWizard(window, { entrypoint: MigrationUtils.MIGRATION_ENTRYPOINTS.PREFERENCES,
        ...(source === "chrome" ? { migratorKey: "chrome" } : {}) });
    },
  });
}
