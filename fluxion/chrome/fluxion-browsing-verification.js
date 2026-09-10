/* global Services, SessionStore, ChromeUtils, IOUtils, PathUtils, Cu */
(function verifyPackagedBrowsing(window) {
  "use strict";
  if (Services.env.get("FLUXION_VISUAL_BROWSING_TEST") !== "1") return;
  const origin = Services.env.get("FLUXION_BROWSING_ORIGIN");
  const expectedHash = Services.env.get("FLUXION_BROWSING_DOWNLOAD_SHA256");
  const expectedSize = Number(Services.env.get("FLUXION_BROWSING_DOWNLOAD_SIZE"));
  const prefix = "fluxion.browsing";
  const { gBrowser, document } = window;
  const { Downloads } = ChromeUtils.importESModule("resource://gre/modules/Downloads.sys.mjs");
  const { PrivateBrowsingUtils } = ChromeUtils.importESModule("resource://gre/modules/PrivateBrowsingUtils.sys.mjs");
  const report = { nativeFileDialogAutomated: false, checks: {} };
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const waitFor = async (check, message, timeout = 20000) => {
    const deadline = Date.now() + timeout;
    do {
      const value = await check();
      if (value) return value;
      await new Promise(resolve => window.setTimeout(resolve, 100));
    } while (Date.now() < deadline);
    throw new Error(message);
  };
  let tab;
  const readPage = () => tab.linkedBrowser.browsingContext.currentWindowGlobal
    .getActor("FluxionBrowsingVerification").sendQuery("FluxionBrowsing:Read", { origin });
  const pageAt = async (url, title, previousGlobal = null) => waitFor(async () => {
    if (tab.linkedBrowser.currentURI?.spec !== url || tab.hasAttribute("busy")) return null;
    if (previousGlobal && tab.linkedBrowser.browsingContext.currentWindowGlobal === previousGlobal) return null;
    const page = await readPage();
    return page.url === url && (!title || page.title === title) ? page : null;
  }, `Page did not render: ${url}`);
  const navigate = async (path, expectedPath = path, title = null) => {
    const previousGlobal = tab.linkedBrowser.browsingContext.currentWindowGlobal;
    tab.linkedBrowser.loadURI(Services.io.newURI(`${origin}${path}`), {
      triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
    });
    return pageAt(`${origin}${expectedPath}`, title, previousGlobal);
  };
  const command = (name, data = {}) => tab.linkedBrowser.browsingContext.currentWindowGlobal
    .getActor("FluxionBrowsingVerification").sendQuery(`FluxionBrowsing:${name}`, { origin, ...data });
  const libraryRow = filename => [...document.querySelectorAll("#fluxion-library .fluxion-library-row")]
    .find(row => row.querySelector(".fluxion-library-row-title")?.textContent === filename);
  const rowAction = (row, label) => [...row.querySelectorAll("button")]
    .find(button => !button.hidden && button.textContent === label);

  async function run() {
    assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(origin), "Missing exact loopback browsing fixture origin");
    assert(/^[a-f0-9]{64}$/.test(expectedHash) && expectedSize > 0, "Missing expected download evidence");
    assert(!PrivateBrowsingUtils.isWindowPrivate(window), "Browsing fixture requires its fresh normal profile");
    await SessionStore.promiseAllWindowsRestored;
    tab = gBrowser.addTrustedTab(`${origin}/`, { skipAnimation: true });
    window.FluxionUI.setTabWorkspace(tab, window.FluxionUI.currentWorkspace());
    gBrowser.selectedTab = tab;
    const root = await pageAt(`${origin}/`, "Fluxion browsing fixture");
    assert(root.script === "executed", "Controlled document JavaScript did not execute");
    report.checks.renderingAndJavaScript = true;

    const target = PathUtils.join(PathUtils.profileDir, "fluxion-download.txt");
    const download = await Downloads.createDownload({ source: `${origin}/download-slow`, target });
    const list = await Downloads.getList(Downloads.PUBLIC);
    await list.add(download);
    window.FluxionLibrary.open("downloads");
    await window.FluxionLibrary.refresh();
    const row = await waitFor(() => libraryRow("fluxion-download.txt"), "Fluxion Library omitted the native download");
    const removeButton = rowAction(row, "Remove");
    assert(removeButton && row._fluxionDownload === download, "Library row is not bound to its native download");
    removeButton.focus({ preventScroll: true });
    assert(document.activeElement === removeButton, "Could not focus the stable download Remove control");
    let initialTransferError = null;
    const initialTransfer = download.start().catch(error => { initialTransferError = error; });
    await waitFor(() => download.currentBytes > 0 && !download.stopped && rowAction(row, "Cancel"),
      "Native download did not expose live progress and Cancel");
    assert(libraryRow("fluxion-download.txt") === row && rowAction(row, "Remove") === removeButton,
      "Active progress replaced the download row or controls");
    assert(document.activeElement === removeButton, "Download progress displaced keyboard focus");
    rowAction(row, "Cancel").click();
    removeButton.focus({ preventScroll: true });
    await waitFor(() => download.canceled && download.stopped && (rowAction(row, "Retry") || rowAction(row, "Resume")),
      "Library Cancel did not stop the actual transfer");
    await initialTransfer;
    assert(initialTransferError && !download.succeeded, "Canceled transfer incorrectly reported success");
    assert(document.activeElement === removeButton, "Cancel state refresh displaced keyboard focus");
    (rowAction(row, "Retry") || rowAction(row, "Resume")).click();
    removeButton.focus({ preventScroll: true });
    await waitFor(() => download.succeeded, "Library retry did not complete the actual transfer");
    assert(download.succeeded && !download.error, "Gecko did not complete the HTTP download");
    const bytes = await IOUtils.read(target);
    const hash = [...new Uint8Array(await window.crypto.subtle.digest("SHA-256", bytes))]
      .map(value => value.toString(16).padStart(2, "0")).join("");
    assert(bytes.length === expectedSize && hash === expectedHash, "Downloaded bytes differ from the served fixture");
    assert((await list.getAll()).includes(download), "Completed transfer is absent from Gecko Downloads");
    report.checks.realDownload = { bytes: bytes.length, sha256: hash, nativeList: true, canceledAndRetried: true };
    await waitFor(() => rowAction(row, "Open") && rowAction(row, "Reveal"), "Completed download controls did not appear");
    assert(libraryRow("fluxion-download.txt") === row && rowAction(row, "Remove") === removeButton,
      "Transfer completion replaced the download row or controls");
    assert(document.activeElement === removeButton, "Retry or completion refresh displaced keyboard focus");
    report.checks.downloadFocusStable = true;
    assert(!document.getElementById("fluxion-library").hidden && !row.querySelector(".fluxion-library-open").disabled,
      "Completed download is not actionable in Fluxion Library");
    const controls = [...row.querySelectorAll("button")].filter(button => !button.hidden).map(button => button.textContent);
    assert(controls.includes("Open") && controls.includes("Reveal") && controls.includes("Remove"), "Download actions are missing");
    report.checks.downloadLibrary = true;
    removeButton.click();
    await waitFor(async () => !(await list.getAll()).includes(download) && !libraryRow("fluxion-download.txt"),
      "Remove did not remove the completed transfer from Gecko and Fluxion Library");
    assert(await IOUtils.exists(target), "Removing download history deleted the completed file");
    report.checks.removeRetainedCompletedFile = true;

    const unfinishedTarget = PathUtils.join(PathUtils.profileDir, "fluxion-unfinished.txt");
    const partialPath = `${unfinishedTarget}.part`;
    const unfinished = await Downloads.createDownload({
      source: `${origin}/download-partial`, target: { path: unfinishedTarget, partFilePath: partialPath },
    });
    unfinished.tryToKeepPartialData = true;
    await list.add(unfinished);
    await window.FluxionLibrary.refresh();
    const unfinishedRow = await waitFor(() => libraryRow("fluxion-unfinished.txt"), "Library omitted the unfinished transfer");
    const unfinishedTransfer = unfinished.start().catch(() => {});
    try {
      await waitFor(async () => {
        if (unfinished.stopped || unfinished.currentBytes <= 0 || !rowAction(unfinishedRow, "Cancel")) return false;
        const partial = await IOUtils.stat(partialPath).catch(() => null);
        return partial?.size > 0;
      }, "Unfinished transfer did not create real partial file bytes");
    } catch (error) {
      const partial = await IOUtils.stat(partialPath).catch(() => null);
      report.partialFailure = {
        stopped: unfinished.stopped, succeeded: unfinished.succeeded, canceled: unfinished.canceled,
        error: unfinished.error?.message || null, currentBytes: unfinished.currentBytes,
        totalBytes: unfinished.totalBytes, hasPartialData: unfinished.hasPartialData,
        partFileExists: Boolean(partial), partFileSize: partial?.size ?? null,
        targetExists: await IOUtils.exists(unfinishedTarget),
      };
      throw error;
    }
    rowAction(unfinishedRow, "Remove").click();
    await waitFor(async () => !(await list.getAll()).includes(unfinished) &&
      !libraryRow("fluxion-unfinished.txt") && !(await IOUtils.exists(partialPath)),
    "Removing an unfinished transfer retained its native record or partial bytes");
    await unfinishedTransfer;
    assert(unfinished.canceled && !unfinished.succeeded, "Removed unfinished transfer was not canceled");
    report.checks.removeErasedPartialFile = true;

    gBrowser.selectedTab = tab;
    await pageAt(`${origin}/`);
    const file = await window.File.createFromFileName(target);
    await command("Upload", { file });
    await pageAt(`${origin}/upload`, "Fluxion upload complete");
    report.checks.contentMultipartUpload = true;

    await navigate("/", "/", "Fluxion browsing fixture");
    await command("Login");
    const account = await pageAt(`${origin}/account`, "Fluxion fixture account");
    assert(!account.cookie.includes("fluxion_fixture_session"), "HttpOnly session leaked through document.cookie");
    await navigate("/account", "/account", "Fluxion fixture account");
    report.checks.contentLoginAndSessionCookie = true;
    await command("Logout");
    await pageAt(`${origin}/`, "Fluxion browsing fixture");
    const signedOut = await navigate("/account");
    assert(/unauthorized|not signed in|sign in|authentication required/i.test(signedOut.text), "Logout did not revoke account access");
    report.checks.logoutRevokedAccess = true;

    const response = await window.fetch(`${origin}/state`);
    assert(response.ok, "Fixture did not expose server-side browsing evidence");
    report.server = await response.json();
    assert(report.server.downloads >= 3 && report.server.slowDownloads >= 2 && report.server.partialDownloads >= 1,
      "Server did not observe initial, retried, and removed partial HTTP transfers");
    assert(report.server.uploads === 1 && report.server.upload?.verified &&
      report.server.upload.filename === "fluxion-download.txt" && report.server.upload.sha256 === expectedHash &&
      report.server.upload.bytes === expectedSize, "Server did not receive exact multipart file bytes");
    assert(report.server.logins === 1 && report.server.authenticatedVisits >= 2,
      "Server did not observe the content login and cookie-authenticated visits");
    Services.prefs.setStringPref(`${prefix}.report`, JSON.stringify(report));
    Services.prefs.setStringPref(`${prefix}.health`, "real-download-upload-and-session-navigation-verified");
  }
  run().catch(error => {
    Services.prefs.setStringPref(`${prefix}.report`, JSON.stringify(report));
    Services.prefs.setStringPref(`${prefix}.error`, `${error?.message || error}\n${error?.stack || ""}`);
    Cu.reportError(error);
  }).finally(() => Services.prefs.savePrefFile(null));
})(window);
