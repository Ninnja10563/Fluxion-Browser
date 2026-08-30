/* global Ci, Cu, Services, SessionStore, FluxionSessionRecovery */
(function initialiseFluxionSessionRecovery(window) {
  "use strict";

  const mode = [
    ["seed", "FLUXION_SESSION_SEED_TEST"],
    ["restore", "FLUXION_SESSION_RESTORE_TEST"],
    ["private", "FLUXION_PRIVATE_ISOLATION_TEST"],
    ["absence", "FLUXION_PRIVATE_ABSENCE_TEST"],
  ].find(([, environment]) => Services.env.get(environment) === "1")?.[0];
  if (!mode || !window.FluxionUI || !window.FluxionMemory) return;

  const { PrivateBrowsingUtils } = ChromeUtils.importESModule(
    "resource://gre/modules/PrivateBrowsingUtils.sys.mjs",
  );
  const { PlacesUtils } = ChromeUtils.importESModule(
    "resource://gre/modules/PlacesUtils.sys.mjs",
  );
  const isPrivate = PrivateBrowsingUtils.isWindowPrivate(window);
  if ((mode === "private") !== isPrivate) return;

  const wait = milliseconds => new Promise(resolve => window.setTimeout(resolve, milliseconds));
  function write(name, value) {
    Services.prefs.setStringPref(name, String(value));
    Services.prefs.savePrefFile(null);
  }
  function fail(error) {
    write(`fluxion.recovery.${mode}.error`, `${error?.message || error}\n${error?.stack || ""}`);
    Cu.reportError(error);
  }
  async function quit() {
    Services.prefs.setBoolPref("browser.tabs.warnOnClose", false);
    Services.prefs.setBoolPref("browser.warnOnQuit", false);
    Services.prefs.savePrefFile(null);
    await wait(350);
    Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit);
  }
  function tabURL(tab) {
    return tab?.linkedBrowser?.currentURI?.spec || "";
  }
  function snapshot() {
    return {
      currentWorkspace: window.FluxionUI.currentWorkspace(),
      isPrivate,
      workspaces: window.FluxionUI.workspaces(),
      tabs: [...window.gBrowser.tabs].map(tab => {
        const split = tab.splitview?.tabs
          ?.map(member => tabURL(member)).sort().join("|") || "";
        return {
          url: tabURL(tab),
          workspace: window.FluxionUI.tabWorkspace(tab),
          pinned: tab.pinned,
          group: tab.group?.label || "",
          split,
          splitOrientation: tab.splitview ? window.FluxionUI.splitOrientation(tab) : "",
          active: window.FluxionUI.workspaceTabActive(tab),
          selected: tab === window.gBrowser.selectedTab,
        };
      }),
    };
  }
  async function waitFor(check, timeout = 24000) {
    const deadline = Date.now() + timeout;
    let latest;
    while (Date.now() < deadline) {
      latest = await check();
      if (latest?.ok) return latest;
      await wait(250);
    }
    return latest || { ok: false, reasons: ["timed out without a result"] };
  }
  async function withDeadline(promise, milliseconds = 1800) {
    return Promise.race([
      Promise.resolve(promise).catch(() => undefined),
      wait(milliseconds),
    ]);
  }
  async function flushTabs(tabs) {
    await Promise.all(tabs.map(tab => {
      try {
        return withDeadline(tab.linkedBrowser?.frameLoader?.requestTabStateFlush?.());
      } catch (_) {
        return Promise.resolve();
      }
    }));
    // Reading the native state after the content flush forces SessionStore to
    // project current tab, group, split, pin, and custom-attribute data.
    SessionStore.getWindowState(window);
    await wait(400);
  }

  async function seedNormalSession() {
    const urls = FluxionSessionRecovery.URLS;
    write("fluxion.recovery.seed.progress", "starting");
    Services.prefs.setIntPref("browser.startup.page", 3);
    Services.prefs.setBoolPref("browser.sessionstore.resume_from_crash", true);
    Services.prefs.setBoolPref("browser.sessionstore.resume_session_once", true);
    const research = window.FluxionUI.workspaces().find(workspace => workspace.id === "research-desk") ||
      window.FluxionUI.createWorkspace("Research Desk", {
        accent: "sage", icon: "square", activate: false,
      });
    if (!research) throw new Error("recovery workspace was not created");
    while (window.FluxionUI.workspaces().findIndex(workspace => workspace.id === research.id) > 2) {
      if (!window.FluxionUI.moveWorkspace(research.id, -1)) break;
    }
    window.FluxionUI.switchWorkspace("build");

    const makeTab = (url, workspace = "build") => {
      const tab = window.gBrowser.addTrustedTab(url, { skipAnimation: true });
      window.FluxionUI.setTabWorkspace(tab, workspace);
      return tab;
    };
    const groupTabs = [makeTab(urls.groupA), makeTab(urls.groupB)];
    const splitTabs = [makeTab(urls.splitA), makeTab(urls.splitB)];
    const pinned = makeTab(urls.pinned);
    const focusTabs = [makeTab(urls.focusIdle, "focus"), makeTab(urls.focusActive, "focus")];
    const group = window.gBrowser.addTabGroup(groupTabs, {
      label: "Recovery Lab", color: "green", insertBefore: groupTabs[0],
    });
    if (!group || group.tabs.length !== 2) throw new Error("native recovery group was not created");
    const split = window.FluxionUI.createSplitView(splitTabs[0], splitTabs[1], {
      orientation: "stacked",
    });
    if (!split || split.tabs.length !== 2) throw new Error("native recovery split was not created");
    window.gBrowser.pinTab(pinned);
    window.FluxionUI.switchWorkspace("focus");
    window.gBrowser.selectedTab = focusTabs[1];
    await wait(100);
    window.FluxionUI.switchWorkspace("build");
    window.gBrowser.selectedTab = splitTabs[0];
    await wait(100);
    write("fluxion.recovery.seed.progress", "native-layout-created");

    const keep = new Set([...groupTabs, ...splitTabs, pinned, ...focusTabs]);
    for (const tab of [...window.gBrowser.tabs]) {
      if (!keep.has(tab)) window.gBrowser.removeTab(tab, { animate: false });
    }
    write("fluxion.recovery.seed.progress", "extra-tabs-removed");
    await wait(1800);
    write("fluxion.recovery.seed.progress", "flushing-sessionstore");
    await flushTabs([...groupTabs, ...splitTabs, pinned, ...focusTabs]);
    write("fluxion.recovery.seed.progress", "sessionstore-projected");
    const validation = FluxionSessionRecovery.validateNormal(snapshot());
    if (!validation.ok) throw new Error(`seed state invalid: ${validation.reasons.join("; ")}`);
    write("fluxion.recovery.seed.health", "workspace-tabs-active-pages-groups-stacked-split-seeded");
    await quit();
  }

  async function validateRestoredSession() {
    await SessionStore.promiseAllWindowsRestored;
    let result = await waitFor(() => FluxionSessionRecovery.validateNormal(snapshot()));
    if (!result.ok) throw new Error(`session restore invalid: ${result.reasons.join("; ")}`);
    window.FluxionUI.switchWorkspace("focus");
    await wait(100);
    if (tabURL(window.gBrowser.selectedTab) !== FluxionSessionRecovery.URLS.focusActive) {
      throw new Error("Focus did not resume its active page after restart");
    }
    window.FluxionUI.switchWorkspace("build");
    await wait(100);
    result = FluxionSessionRecovery.validateNormal(snapshot());
    if (!result.ok) throw new Error(`workspace resume invalid: ${result.reasons.join("; ")}`);
    write("fluxion.recovery.restore.health", "workspace-tabs-active-pages-groups-stacked-split-restored");
    await flushTabs([...window.gBrowser.tabs]);
    await quit();
  }

  async function validatePrivateWindow() {
    const privateURL = FluxionSessionRecovery.URLS.privateOnly;
    let tab = [...window.gBrowser.tabs].find(candidate => tabURL(candidate) === privateURL);
    if (!tab) tab = window.gBrowser.addTrustedTab(privateURL, { skipAnimation: true });
    window.gBrowser.selectedTab = tab;
    await wait(1500);
    const memory = await window.FluxionMemory.search("fluxion private only");
    const enabled = await window.FluxionMemory.enable();
    const result = FluxionSessionRecovery.validatePrivate({
      isPrivate,
      memoryState: memory.state,
      memoryResults: memory.results.length,
      memoryEnabled: enabled,
    });
    if (!result.ok) throw new Error(`private boundary invalid: ${result.reasons.join("; ")}`);
    write("fluxion.recovery.private.health", "private-memory-boundary-enforced");
    await quit();
  }

  async function validatePrivateAbsence() {
    const result = FluxionSessionRecovery.validatePrivateAbsence(snapshot());
    if (!result.ok) throw new Error(`post-private tab isolation invalid: ${result.reasons.join("; ")}`);
    const privateURL = FluxionSessionRecovery.URLS.privateOnly;
    const historyRecord = await PlacesUtils.history.fetch(privateURL);
    if (historyRecord) throw new Error("private URL leaked into Gecko Places history");
    const memory = await window.FluxionMemory.search("fluxion private only");
    if (memory.results.some(record => record.url === privateURL)) {
      throw new Error("private URL leaked into Browser Memory search");
    }
    write("fluxion.recovery.absence.health", "private-tabs-history-memory-excluded");
    await quit();
  }

  Services.prefs.setStringPref("fluxion.recovery.health", "multi-launch-gate-loaded");
  Services.prefs.savePrefFile(null);
  window.setTimeout(() => {
    const task = mode === "seed" ? seedNormalSession()
      : mode === "restore" ? validateRestoredSession()
        : mode === "private" ? validatePrivateWindow()
          : validatePrivateAbsence();
    task.catch(fail);
  }, 700);
})(window);
