/* global Services, ChromeUtils, Ci, Cc, Cu, IOUtils, PathUtils */
(function verifyLastWindow(window) {
  "use strict";
  const mode = Services.env.get("FLUXION_LAST_WINDOW_TEST");
  if (!["seed", "restore", "existing", "existing-restore", "choice0", "choice1"].includes(mode)) return;
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
    const workspaceState = JSON.parse(state.extData?.["fluxion-last-window-workspaces"] || "null");
    ensure(workspaceState?.first && workspaceState?.second && workspaceState.first !== workspaceState.second,
      `${label}: workspace fixture metadata lost`);
    for (const [index, expected] of [[1, workspaceState.first], [2, workspaceState.second]]) {
      const nativeTab = [...win.gBrowser.tabs].find(tab => tab.linkedBrowser.currentURI.spec === urls[index] ||
        SessionStore.getCustomTabValue(tab, "fluxion-last-window-tab") === (index === 1 ? "retained" : "second-workspace"));
      ensure(nativeTab && win.FluxionUI.tabWorkspace(nativeTab) === expected, `${label}: workspace tab mapping lost`);
    }
    if (external) ensure(actual.includes(externalURL), `${label}: external request was overwritten`);
    evidence.checks.push({ label, urls: actual, nativeSelectedURL, pinned: true, metadata: true });
  }
  async function ready(win) {
    await until(() => win.gBrowser && win.FluxionUI && win.gBrowserInit?.delayedStartupFinished, "new native window failed startup");
    await wait(350);
    return win;
  }
  async function open(options = {}) { return ready(BrowserWindowTracker.openWindow(options)); }
  async function close(win) {
    const ordinal = ++closeNumber;
    // Do not pre-flush or wait for a save: users close windows directly.
    // Gecko must collect its own final tab state through the normal close path.
    recordLifecycle(`close-${ordinal}-without-test-flush`, mode === "existing" ? null : win);
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
    const ui = win.FluxionUI, firstWorkspace = ui.workspaces()[0].id;
    ui.switchWorkspace(firstWorkspace);
    const tabs = [];
    const openPage = async url => {
      const tab = ui.newTab();
      tab.linkedBrowser.loadURI(Services.io.newURI(url), { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
      await until(() => !tab.hasAttribute("busy") && tab.linkedBrowser.currentURI.spec === url, "Flow-created page did not load");
      tabs.push(tab);
    };
    await openPage(urls[0]); await openPage(urls[1]);
    const secondWorkspace = ui.workspaces().find(item => item.id !== firstWorkspace)?.id || ui.createWorkspace("Reading").id;
    ui.switchWorkspace(secondWorkspace);
    await openPage(urls[2]);
    win.gBrowser.pinTab(tabs[0]);
    win.gBrowser.selectedTab = tabs[2];
    for (const tab of [...win.gBrowser.tabs]) if (!tabs.includes(tab)) win.gBrowser.removeTab(tab, { animate: false });
    SessionStore.setCustomWindowValue(win, "fluxion-last-window-fixture", "retained");
    SessionStore.setCustomWindowValue(win, "fluxion-last-window-workspaces", JSON.stringify({ first: firstWorkspace, second: secondWorkspace }));
    SessionStore.setCustomTabValue(tabs[1], "fluxion-last-window-tab", "retained");
    SessionStore.setCustomTabValue(tabs[2], "fluxion-last-window-tab", "second-workspace");
    await until(() => urls.every(url => stateURLs(stateOf(win)).includes(url)), "seed pages did not load");
    verifyTabs(win, "seed");
  }
  async function verifyLastWorkspaceTab(win) {
    const ui = win.FluxionUI;
    ui.setSidebarState("expanded");
    const retained = ui.newTab(), retainedWorkspace = ui.currentWorkspace();
    const retainedURL = marker("hidden-workspace-must-survive");
    retained.linkedBrowser.loadURI(Services.io.newURI(retainedURL), { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
    await until(() => !retained.hasAttribute("busy") && retained.linkedBrowser.currentURI.spec === retainedURL, "Hidden workspace fixture did not load");
    for (const tab of [...win.gBrowser.tabs]) if (tab !== retained) win.gBrowser.removeTab(tab, { animate: false });
    const other = ui.createWorkspace("Close fixture");
    ensure(other && retained.hidden, "Closing fixture did not create a real hidden workspace tab");
    const retainedGlobal = retained.linkedBrowser.browsingContext.currentWindowGlobal.innerWindowId;
    for (const input of ["native-cmd-w-handler", "flow-widget-close-button"]) {
      const closing = win.gBrowser.selectedTab;
      ensure(win.gBrowser.visibleTabs.length === 1 && ui.tabWorkspace(closing) === other.id,
        `${input}: fixture is not the workspace's final visible tab`);
      if (input === "native-cmd-w-handler") {
        win.BrowserCommands.closeTabOrWindow({ metaKey: true });
      } else {
        const button = await until(() => [...win.document.querySelectorAll("#fluxion-flow .fluxion-tab")]
          .find(row => row._fluxionTab === closing)?.querySelector(".fluxion-close"), "Flow last-tab close control missing");
        Services.focus.focusedWindow = win;
        const box = button.getBoundingClientRect();
        ensure(box.width >= 16 && box.height >= 16, "Flow close control has no clickable geometry");
        for (const type of ["mousemove", "mousedown", "mouseup"]) win.synthesizeMouseEvent(type,
          box.x + box.width / 2, box.y + box.height / 2, {
            identifier: win.windowUtils.DEFAULT_MOUSE_POINTER_ID, button: 0, buttons: type === "mousedown" ? 1 : 0,
            clickCount: type === "mousemove" ? 0 : 1, modifiers: 0, inputSource: win.MouseEvent.MOZ_SOURCE_MOUSE,
          }, { isDOMEventSynthesized: true, isWidgetEventSynthesized: false, isAsyncEnabled: false, toWindow: true });
      }
      await until(() => win.closed || !closing.parentNode, `${input}: final workspace tab did not close`);
      ensure(!win.closed, `${input}: closing one workspace destroyed the entire browser window`);
      await until(() => win.gBrowser.tabs.length === 2 && win.gBrowser.selectedTab !== closing, `${input}: native replacement tab did not settle`);
      ensure(retained.parentNode && retained.hidden && ui.tabWorkspace(retained) === retainedWorkspace &&
        retained.linkedBrowser.currentURI.spec === retainedURL && retained.linkedBrowser.browsingContext.currentWindowGlobal.innerWindowId === retainedGlobal,
      `${input}: another workspace tab was changed, lost or reloaded`);
      ensure(ui.currentWorkspace() === other.id && ui.tabWorkspace(win.gBrowser.selectedTab) === other.id,
        `${input}: closing the workspace jumped to another workspace`);
      evidence.checks.push({ label: input, windowRetained: true, hiddenPageRetained: true, workspaceRetained: true });
    }
  }
  async function verifyFinalCheckpoint() {
    if (mode === "existing") {
      // This scenario must rely solely on Gecko's normal close and quit writes.
      evidence.checks.push({ label: "zero-window-before-natural-quit", explicitStartupRestore: true,
        testTriggeredSave: false, nativeUndoRetained: true });
      return;
    }
    await SessionSaver.run();
    await SessionSaver.run();
    ensure((await closedNormal())._shouldRestore === true, "saving consumed the live undo-close record");
    const disk = await IOUtils.readJSON(PathUtils.join(PathUtils.profileDir, "sessionstore-backups", "recovery.jsonlz4"), { decompress: true });
    ensure(disk.windows.some(item => urls.every(url => stateURLs(item).includes(url))), "disk checkpoint did not project the closed last window");
    ensure(!JSON.stringify(disk).includes("private-never-persist"), "private marker entered disk checkpoint");
    evidence.checks.push({ label: "zero-window-disk-checkpoint", windowCount: disk.windows.length, nativeUndoRetained: true, privateExcluded: true });
  }
  async function run() {
    ensure(/\/fluxion-last-window-check\.[^/]+\/(profile|existing|choice0|choice1)\/?$/.test(PathUtils.profileDir) &&
      PathUtils.parent(PathUtils.profileDir) === root, "last-window gate requires its isolated profile and driver directory");
    Services.prefs.setBoolPref("browser.tabs.warnOnClose", false);
    Services.prefs.setBoolPref("browser.warnOnQuit", false);
    const first = await until(() => windows().find(win => win.FluxionUI && !PrivateBrowsingUtils.isWindowPrivate(win)), "initial normal window missing");
    await ready(first);
    await SessionStore.promiseAllWindowsRestored;
    if (mode === "restore" || mode === "existing-restore") {
      await until(() => urls.every(url => stateURLs(stateOf(first)).includes(url)), "closed-last-window session did not restore on relaunch");
      verifyTabs(first, "actual-relaunch");
      ensure(Services.prefs.getIntPref("browser.startup.page") === 3 &&
        Services.prefs.prefHasUserValue("browser.startup.page") === (mode === "existing-restore"), "startup choice did not retain its original default/user provenance");
    } else {
      if (mode.startsWith("choice")) Services.prefs.setIntPref("browser.startup.page", Number(mode.slice(-1)));
      else if (mode === "existing") Services.prefs.setIntPref("browser.startup.page", 3);
      else ensure(Services.prefs.getIntPref("browser.startup.page") === 3 && !Services.prefs.prefHasUserValue("browser.startup.page"), "fresh default does not restore sessions");
      await verifyLastWorkspaceTab(first);
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
        await verifyFinalCheckpoint();
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
