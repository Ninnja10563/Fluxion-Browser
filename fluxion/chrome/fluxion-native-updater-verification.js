/* global Services, ChromeUtils, SessionStore, IOUtils, PathUtils, Ci, Cu */
(async function verifyNativeUpdater(window) {
  "use strict";
  if (!Services.prefs.getBoolPref("fluxion.verification.nativeUpdater", false)) return;
  const resources = Services.dirsvc.get("GreD", Ci.nsIFile);
  const configPath = PathUtils.join(resources.path, "fluxion", "runtime", "updater-test-gate.json");
  if (!await IOUtils.exists(configPath)) return; // only copied into the test app, never the production bundle
  const hidden = Services.appShell.hiddenDOMWindow;
  if (hidden.__fluxionNativeUpdaterGate) return;
  hidden.__fluxionNativeUpdaterGate = true;
  const config = await IOUtils.readJSON(configPath);
  const ensure = (ok, message) => { if (!ok) throw Error(message); };
  const pause = ms => new Promise(resolve => window.setTimeout(resolve, ms));
  const until = async (predicate, message, timeout = 120000) => {
    const deadline = Date.now() + timeout;
    do { const value = await predicate(); if (value) return value; await pause(100); } while (Date.now() < deadline);
    throw Error(message);
  };
  const ownerFile = PathUtils.join(PathUtils.profileDir, ".fluxion-updater-gate-owner.json");
  const profileHome = Services.dirsvc.get("Home", Ci.nsIFile).path;
  ensure(config.schema === 1 && /^[a-f0-9]{48}$/.test(config.token) &&
    /^fluxion-updater-check\.[A-Za-z0-9]{6}$/.test(PathUtils.filename(config.root)) &&
    config.profile === PathUtils.profileDir && config.profile === PathUtils.join(profileHome, "Library", "Application Support", "Fluxion", "Profiles", "default") &&
    resources.parent.parent.path === config.app && config.app === PathUtils.join(config.root, "live", "Fluxion.app"),
  "Native updater gate requires its exact owned app and canonical default profile");
  const owner = await IOUtils.readJSON(ownerFile);
  ensure(owner.root === config.root && owner.token === config.token, "Native updater gate does not own this profile");
  const reportPath = PathUtils.join(config.root, "browser-report.json");
  let report = { schema: 1, checks: [], transitions: [], initialPID: Services.appinfo.processID };
  const record = async () => IOUtils.writeUTF8(reportPath, JSON.stringify(report, null, 2));
  const markerPath = PathUtils.join(resources.path, "fluxion", "runtime", "updater-payload-marker.json");
  const fixtureStatePath = PathUtils.join(config.root, "browser-state.json");
  const urls = ["pinned", "research", "other-workspace"].map(name => `data:text/html,${encodeURIComponent(`<title>Fluxion updater ${name}</title><p>${name}</p>`)}`);
  const stateURLs = state => state.tabs.map(tab => tab.entries?.[(tab.index || 1) - 1]?.url || "");
  async function snapshot(expected) {
    const state = SessionStore.getWindowState(window).windows[0], actual = stateURLs(state);
    ensure(actual.length === urls.length && urls.every(url => actual.filter(value => value === url).length === 1), "Update lost, duplicated or added session tabs");
    ensure(state.tabs.find(tab => tab.entries?.some(entry => entry.url === urls[0]))?.pinned, "Update lost the pinned page");
    ensure(window.gBrowser.selectedBrowser.currentURI.spec === urls[2], "Update changed the selected page");
    ensure(SessionStore.getCustomWindowValue(window, "fluxion-updater-fixture") === config.token, "Update lost window session metadata");
    for (const [index, workspace] of [[1, expected.firstWorkspace], [2, expected.secondWorkspace]]) {
      const tab = [...window.gBrowser.tabs].find(item => SessionStore.getCustomTabValue(item, "fluxion-updater-fixture-tab") === String(index));
      ensure(tab && window.FluxionUI.tabWorkspace(tab) === workspace, "Update lost workspace tab membership");
    }
    const { PlacesUtils } = ChromeUtils.importESModule("resource://gre/modules/PlacesUtils.sys.mjs");
    const bookmark = await PlacesUtils.bookmarks.fetch(expected.bookmarkGUID);
    ensure(bookmark?.url.href === "https://fluxion-updater-fixture.invalid/retained" && bookmark.title === "Preserved updater fixture",
      "Update changed or lost the existing bookmark");
    ensure(Services.prefs.getStringPref("fluxion.updaterGate.retained", "") === config.token, "Update lost the existing profile preference");
    return { urls: actual, selected: urls[2], pinned: true, workspaceMetadata: true, bookmarkGUID: bookmark.guid, preferenceRetained: true };
  }
  async function run() {
    const { PrivateBrowsingUtils } = ChromeUtils.importESModule("resource://gre/modules/PrivateBrowsingUtils.sys.mjs");
    ensure(!PrivateBrowsingUtils.isWindowPrivate(window), "Updater gate must not operate on a private profile");
    await SessionStore.promiseAllWindowsRestored;
    await until(() => window.FluxionUI && window.gBrowserInit?.delayedStartupFinished, "Updater fixture browser did not finish startup");
    Services.prefs.setBoolPref("fluxion.updates.automaticChecks", false);
    Services.prefs.setBoolPref("browser.tabs.warnOnClose", false);
    Services.prefs.setBoolPref("browser.warnOnQuit", false);
    const marker = await IOUtils.readJSON(markerPath);
    if (marker.version === config.newVersion) {
      const expected = await IOUtils.readJSON(fixtureStatePath);
      ensure(expected.phase === "awaiting-relaunch" && expected.token === config.token, "Replacement launched without a completed update attempt");
      report = await IOUtils.readJSON(reportPath);
      ensure(report.initialPID !== Services.appinfo.processID, "Updater did not create a new browser process");
      await until(() => stateURLs(SessionStore.getWindowState(window).windows[0]).includes(urls[2]) &&
        window.gBrowser.selectedBrowser.currentURI.spec === urls[2], "Updated browser did not restore its session");
      report.restored = await snapshot(expected);
      report.relaunchedPID = Services.appinfo.processID;
      report.installedVersion = marker.version;
      report.checks.push("real-sparkle-app-replacement-and-relaunch", "tabs-selection-pin-workspaces-bookmark-preference-preserved");
      report.health = "native-sparkle-install-and-preservation-verified";
      await record();
      return;
    }
    ensure(marker.version === config.oldVersion, "Unexpected updater fixture version");
    ensure(!await IOUtils.exists(fixtureStatePath), "Updater seed profile was already used");
    const { PlacesUtils } = ChromeUtils.importESModule("resource://gre/modules/PlacesUtils.sys.mjs");
    const { PlacesBrowserStartup } = ChromeUtils.importESModule("moz-src:///browser/components/places/PlacesBrowserStartup.sys.mjs");
    await until(() => PlacesBrowserStartup._placesBrowserInitComplete, "Bookmark startup did not settle");
    const ui = window.FluxionUI, firstWorkspace = ui.currentWorkspace(), tabs = [];
    for (let index = 0; index < urls.length; index++) {
      if (index === 2) ui.createWorkspace("Updater other");
      const tab = ui.newTab(); tabs.push(tab);
      tab.linkedBrowser.loadURI(Services.io.newURI(urls[index]), { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
      await until(() => tab.linkedBrowser.currentURI.spec === urls[index] && !tab.hasAttribute("busy"), "Updater seed page failed to load");
      SessionStore.setCustomTabValue(tab, "fluxion-updater-fixture-tab", String(index));
    }
    const secondWorkspace = ui.currentWorkspace();
    ensure(secondWorkspace !== firstWorkspace, "Updater fixture needs two separate workspaces");
    window.gBrowser.pinTab(tabs[0]); window.gBrowser.selectedTab = tabs[2];
    for (const tab of [...window.gBrowser.tabs]) if (!tabs.includes(tab)) window.gBrowser.removeTab(tab, { animate: false });
    SessionStore.setCustomWindowValue(window, "fluxion-updater-fixture", config.token);
    Services.prefs.setStringPref("fluxion.updaterGate.retained", config.token);
    const bookmark = await PlacesUtils.bookmarks.insert({ parentGuid: PlacesUtils.bookmarks.toolbarGuid,
      url: "https://fluxion-updater-fixture.invalid/retained", title: "Preserved updater fixture" });
    const expected = { token: config.token, phase: "seeded", firstWorkspace, secondWorkspace, bookmarkGUID: bookmark.guid };
    await IOUtils.writeUTF8(fixtureStatePath, JSON.stringify(expected));
    report.seed = await snapshot(expected); await record();
    const { FluxionNativeUpdater: native } = ChromeUtils.importESModule("resource://fluxion/modules/FluxionNativeUpdater.sys.mjs");
    await native.prepare();
    ensure(native.getState().available, "Real Sparkle bridge is unavailable in the owned default-profile app");
    const command = action => native.command({ action, version: config.release, channel: "preview", consent: true });
    let previous;
    const state = () => {
      const value = native.getState();
      if (value.state !== previous && report.transitions.length < 100) {
        previous = value.state;
        report.transitions.push({ stage: report.stage, state: value.state, received: value.received, total: value.total, error: value.error });
      }
      return value;
    };
    for (const stage of ["wrong-sign", "corrupt"]) {
      report.stage = stage;
      await IOUtils.writeUTF8(PathUtils.join(config.root, "stage"), stage);
      command("install");
      await until(() => { const value = state(); return value.state === "error" && !value.busy; }, `Sparkle did not reject ${stage} archive`, 180000);
      ensure(!window.closed && (await IOUtils.readJSON(markerPath)).version === config.oldVersion, "Rejected archive changed or quit the installed application");
      await snapshot(expected);
      report.checks.push(`${stage}-archive-rejected-with-live-session-unchanged`); await record();
      native.command({ action: "dismiss" });
    }
    report.stage = "valid";
    await IOUtils.writeUTF8(PathUtils.join(config.root, "stage"), "valid");
    let cancelled = 0;
    const cancelFirstQuit = { observe(subject) {
      subject.QueryInterface(Ci.nsISupportsPRBool).data = true;
      cancelled++;
      Services.obs.removeObserver(cancelFirstQuit, "quit-application-requested");
    } };
    Services.obs.addObserver(cancelFirstQuit, "quit-application-requested");
    command("install");
    await until(() => cancelled === 1 && state().canRetry, "Sparkle did not retain retry after native quit cancellation", 180000);
    ensure(!window.closed && (await IOUtils.readJSON(markerPath)).version === config.oldVersion, "Cancelled Quit replaced the app or closed its session");
    await snapshot(expected);
    report.checks.push("real-sparkle-apple-quit-cancelled-and-session-still-live");
    report.cancelledQuitCount = cancelled;
    await IOUtils.writeUTF8(fixtureStatePath, JSON.stringify({ ...expected, phase: "awaiting-relaunch" }));
    await record();
    command("retry");
    await pause(180000);
    throw Error("Sparkle retry did not terminate the old process and relaunch the new application");
  }
  await run().catch(async error => {
    report.error = `${error.message}\n${error.stack || ""}`;
    await record(); Cu.reportError(error);
  });
})(window).catch(error => Cu.reportError(error));
