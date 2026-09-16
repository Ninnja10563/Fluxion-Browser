/* global Services, ChromeUtils, Ci, Cc, Cu, IOUtils, PathUtils */
(function verifyLastWindow(window) {
  "use strict";
  const mode = Services.env.get("FLUXION_LAST_WINDOW_TEST");
  if (!["seed", "restore", "choice0", "choice1"].includes(mode)) return;
  const hidden = Services.appShell.hiddenDOMWindow;
  if (window !== hidden) {
    if (!hidden.__fluxionLastWindowVerification) {
      hidden.__fluxionLastWindowVerification = true;
      // The hidden chrome window survives closing the final visible window.
      Services.scriptloader.loadSubScript("resource://fluxion/chrome/fluxion-last-window-verification.js", hidden);
    }
    return;
  }
  const { SessionStore } = ChromeUtils.importESModule("resource:///modules/sessionstore/SessionStore.sys.mjs");
  const { SessionSaver } = ChromeUtils.importESModule("resource:///modules/sessionstore/SessionSaver.sys.mjs");
  const { BrowserWindowTracker } = ChromeUtils.importESModule("resource:///modules/BrowserWindowTracker.sys.mjs");
  const { PrivateBrowsingUtils } = ChromeUtils.importESModule("resource://gre/modules/PrivateBrowsingUtils.sys.mjs");
  const { setTimeout } = ChromeUtils.importESModule("resource://gre/modules/Timer.sys.mjs");
  const root = Services.env.get("FLUXION_LAST_WINDOW_DRIVER_DIR");
  const prefix = `fluxion.lastWindow.${mode}`;
  const marker = kind => `data:text/html,${encodeURIComponent(`<title>Fluxion last window ${kind}</title><p>${kind}</p>`)}`;
  const urls = [marker("pinned"), marker("normal-a"), marker("normal-b")];
  const privateURL = marker("private-never-persist"), externalURL = marker("external-request");
  const evidence = { mode, checks: [], lifecycle: [] };
  let closeNumber = 0;
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const ensure = (condition, message) => { if (!condition) throw new Error(message); };
  function write(name, value) {
    Services.prefs.setStringPref(`${prefix}.${name}`, String(value));
    Services.prefs.savePrefFile(null);
  }
  async function until(check, message, timeout = 25000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) { const result = check(); if (result) return result; await wait(80); }
    throw new Error(message);
  }
  const windows = () => [...Services.wm.getEnumerator("navigator:browser")].filter(win => !win.closed);
  const stateOf = win => SessionStore.getWindowState(win).windows[0];
  const stateURLs = state => state.tabs.map(tab => tab.entries?.[(tab.index || 1) - 1]?.url || "");
  function stateSummary(state) {
    return {
      closedId: state.closedId, closedAt: state.closedAt, shouldRestore: state._shouldRestore,
      private: state.isPrivate, popup: state.isPopup, selected: state.selected,
      metadata: state.extData?.["fluxion-last-window-fixture"],
      tabs: (state.tabs || []).slice(0, 20).map(tab => ({
        entries: (tab.entries || []).slice(0, 6).map(entry => entry.url?.slice(0, 700)),
        index: tab.index, pinned: tab.pinned, hidden: tab.hidden, attributes: tab.attributes,
        metadata: tab.extData?.["fluxion-last-window-tab"],
      })),
    };
  }
  function recordLifecycle(stage, win = null) {
    const entry = { stage, at: Date.now() };
    try {
      if (win && !win.closed) {
        entry.windowState = stateSummary(stateOf(win));
        entry.nativeTabs = [...win.gBrowser.tabs].slice(0, 20).map(tab => ({
          uri: tab.linkedBrowser.currentURI?.spec?.slice(0, 700), pending: tab.hasAttribute("pending"),
          busy: tab.hasAttribute("busy"), closing: !!tab.closing, pinned: !!tab.pinned,
          selected: tab === win.gBrowser.selectedTab,
        }));
      }
      entry.closedRecords = SessionStore.getClosedWindowData().slice(0, 10).map(stateSummary);
      entry.openWindowCount = windows().length;
    } catch (error) { entry.diagnosticError = String(error); }
    if (evidence.lifecycle.length < 30) evidence.lifecycle.push(entry);
  }
  function verifyTabs(win, label, external = false) {
    const state = stateOf(win), actual = stateURLs(state);
    const nativeSelectedURL = win.gBrowser.selectedBrowser.currentURI.spec;
    ensure(nativeSelectedURL === actual[(state.selected || 1) - 1], `${label}: native selected page diverged from its restored session: ${nativeSelectedURL}`);
    for (const url of urls) ensure(actual.filter(item => item === url).length === 1, `${label}: missing/duplicate ${url}`);
    ensure(!actual.includes(privateURL), `${label}: private tab escaped`);
    ensure(state.tabs.find(tab => tab.entries?.some(entry => entry.url === urls[0]))?.pinned, `${label}: pinned state lost`);
    ensure(state.extData?.["fluxion-last-window-fixture"] === "retained", `${label}: window metadata lost`);
    ensure(state.tabs.find(tab => tab.entries?.some(entry => entry.url === urls[1]))?.extData?.["fluxion-last-window-tab"] === "retained", `${label}: tab metadata lost`);
    if (external) ensure(actual.includes(externalURL), `${label}: external request was overwritten`);
    evidence.checks.push({ label, urls: actual, nativeSelectedURL, pinned: true, metadata: true });
  }
  async function ready(win) {
    await until(() => win.gBrowser && win.FluxionUI && win.gBrowserInit?.delayedStartupFinished, "new native window failed startup");
    await wait(350);
    return win;
  }
  async function open(options = {}) { return ready(BrowserWindowTracker.openWindow(options)); }
  async function flush(win) {
    await Promise.all([...win.gBrowser.tabs].map(tab => Promise.race([
      Promise.resolve(tab.linkedBrowser.frameLoader?.requestTabStateFlush?.()), wait(3000),
    ])));
    stateOf(win); await wait(250);
  }
  async function close(win) {
    const ordinal = ++closeNumber;
    recordLifecycle(`close-${ordinal}-before-flush`, win);
    await flush(win);
    recordLifecycle(`close-${ordinal}-after-flush`, win);
    win.BrowserCommands.tryToCloseWindow();
    await until(() => win.closed, "native close-window command failed");
    recordLifecycle(`close-${ordinal}-closed`);
    await wait(450);
    recordLifecycle(`close-${ordinal}-settled`);
  }
  async function closedNormal() {
    try {
      return await until(() => SessionStore.getClosedWindowData().find(item => urls.slice(1).every(url => stateURLs(item).includes(url))), `normal tabs missing from native closed-window record after close ${closeNumber}`);
    } catch (error) {
      recordLifecycle(`close-${closeNumber}-record-timeout`);
      throw error;
    }
  }
  async function seed(win) {
    const original = [...win.gBrowser.tabs];
    const tabs = urls.map(url => win.gBrowser.addTrustedTab(url));
    win.gBrowser.pinTab(tabs[0]);
    win.gBrowser.selectedTab = tabs[2];
    for (const tab of original) win.gBrowser.removeTab(tab, { animate: false });
    SessionStore.setCustomWindowValue(win, "fluxion-last-window-fixture", "retained");
    SessionStore.setCustomTabValue(tabs[1], "fluxion-last-window-tab", "retained");
    await until(() => urls.every(url => stateURLs(stateOf(win)).includes(url)), "seed pages did not load");
    await flush(win);
    verifyTabs(win, "seed");
  }
  async function run() {
    ensure(/\/fluxion-last-window-check\.[^/]+\/(profile|choice0|choice1)\/?$/.test(PathUtils.profileDir) &&
      PathUtils.parent(PathUtils.profileDir) === root, "last-window gate requires its isolated profile and driver directory");
    Services.prefs.setBoolPref("browser.tabs.warnOnClose", false);
    Services.prefs.setBoolPref("browser.warnOnQuit", false);
    const first = await until(() => windows().find(win => win.FluxionUI && !PrivateBrowsingUtils.isWindowPrivate(win)), "initial normal window missing");
    await ready(first);
    await SessionStore.promiseAllWindowsRestored;
    if (mode === "restore") {
      await until(() => urls.every(url => stateURLs(stateOf(first)).includes(url)), "closed-last-window session did not restore on relaunch");
      verifyTabs(first, "actual-relaunch");
      ensure(Services.prefs.getIntPref("browser.startup.page") === 3 && !Services.prefs.prefHasUserValue("browser.startup.page"), "restore relied on a forced startup preference");
    } else {
      if (mode.startsWith("choice")) Services.prefs.setIntPref("browser.startup.page", Number(mode.slice(-1)));
      else ensure(Services.prefs.getIntPref("browser.startup.page") === 3 && !Services.prefs.prefHasUserValue("browser.startup.page"), "fresh default does not restore sessions");
      await seed(first);
      await close(first);
      await closedNormal();
      ensure(windows().length === 0, "last-window close left a visible window");
      if (mode.startsWith("choice")) {
        const fresh = await open();
        const actual = stateURLs(stateOf(fresh));
        ensure(!actual.includes(urls[1]) && !actual.includes(urls[2]), "explicit fresh-start preference ignored");
        const retained = await closedNormal();
        ensure(stateURLs(retained).includes(urls[1]), "opt-out deleted native closed-window recovery");
        evidence.checks.push({ label: mode, urls: actual, nativeUndoRetained: true });
      } else {
        let reopened = await open();
        await until(() => urls.every(url => stateURLs(stateOf(reopened)).includes(url)), "same-process reopen failed");
        verifyTabs(reopened, "same-process-reopen");
        await close(reopened);
        await closedNormal();
        const privateWindow = await open({ private: true });
        ensure(PrivateBrowsingUtils.isWindowPrivate(privateWindow), "private fixture did not open privately");
        ensure(!urls.some(url => stateURLs(stateOf(privateWindow)).includes(url)), "normal session restored into private window");
        privateWindow.gBrowser.selectedTab = privateWindow.gBrowser.addTrustedTab(privateURL);
        await until(() => stateURLs(stateOf(privateWindow)).includes(privateURL), "private marker did not load");
        await close(privateWindow);
        ensure(!JSON.stringify(SessionStore.getClosedWindowData()).includes("private-never-persist"), "private marker entered native closed records");
        const args = Cc["@mozilla.org/supports-string;1"].createInstance(Ci.nsISupportsString);
        args.data = externalURL;
        reopened = await open({ args });
        await until(() => [...urls, externalURL].every(url => stateURLs(stateOf(reopened)).includes(url)), "external reopen dropped session or request");
        verifyTabs(reopened, "private-then-external-reopen", true);
        for (const tab of reopened.gBrowser.tabs) {
          if (tab.linkedBrowser.currentURI.spec === externalURL) reopened.gBrowser.removeTab(tab, { animate: false });
        }
        await close(reopened);
        const closed = await closedNormal();
        ensure(closed._shouldRestore === true, "last regular window was not marked for next launch");
        await SessionSaver.run();
        await SessionSaver.run();
        ensure((await closedNormal())._shouldRestore === true, "saving consumed the live undo-close record");
        const disk = await IOUtils.readJSON(PathUtils.join(PathUtils.profileDir, "sessionstore-backups", "recovery.jsonlz4"), { decompress: true });
        ensure(disk.windows.some(item => urls.every(url => stateURLs(item).includes(url))), "disk checkpoint did not project the closed last window");
        ensure(!JSON.stringify(disk).includes("private-never-persist"), "private marker entered disk checkpoint");
        evidence.checks.push({ label: "zero-window-disk-checkpoint", windowCount: disk.windows.length, nativeUndoRetained: true, privateExcluded: true });
      }
    }
    write("health", "native-last-window-policy-verified");
    await IOUtils.writeUTF8(PathUtils.join(root, `${mode}.json`), JSON.stringify(evidence, null, 2));
    await wait(200);
    Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit);
  }
  run().catch(async error => {
    recordLifecycle("terminal-error");
    write("error", `${error.message}\n${error.stack}`);
    evidence.error = `${error.message}\n${error.stack}`;
    try { await IOUtils.writeUTF8(PathUtils.join(root, `${mode}.json`), JSON.stringify(evidence, null, 2)); } catch (_) {}
    Cu.reportError(error);
    Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit);
  });
})(window);
