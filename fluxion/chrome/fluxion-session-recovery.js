/* global Ci, Cu, Services, SessionStore, FluxionSessionRecovery */
(function initialiseFluxionSessionRecovery(window) {
  "use strict";

  const mode = [
    ["seed", "FLUXION_SESSION_SEED_TEST"],
    ["restore", "FLUXION_SESSION_RESTORE_TEST"],
    ["private", "FLUXION_PRIVATE_ISOLATION_TEST"],
    ["absence", "FLUXION_PRIVATE_ABSENCE_TEST"],
    ["preferencesSeed", "FLUXION_STARTUP_PREFERENCES_SEED_TEST"],
    ["homepage", "FLUXION_STARTUP_HOMEPAGE_TEST"],
    ["blankSeed", "FLUXION_STARTUP_BLANK_SEED_TEST"],
    ["blank", "FLUXION_STARTUP_BLANK_TEST"],
    ["crashSeed", "FLUXION_CRASH_SEED_TEST"],
    ["crashRestore", "FLUXION_CRASH_RESTORE_TEST"],
  ].find(([, environment]) => Services.env.get(environment) === "1")?.[0];
  if (!mode || !window.FluxionUI || !window.FluxionMemory) return;

  const { PrivateBrowsingUtils } = ChromeUtils.importESModule(
    "resource://gre/modules/PrivateBrowsingUtils.sys.mjs",
  );
  const { PlacesUtils } = ChromeUtils.importESModule(
    "resource://gre/modules/PlacesUtils.sys.mjs",
  );
  const isPrivate = PrivateBrowsingUtils.isWindowPrivate(window);
  if (isPrivate) return;
  const leaderPref = `fluxion.recovery.${mode}.leader`;
  if (Services.prefs.getBoolPref(leaderPref, false)) return;
  Services.prefs.setBoolPref(leaderPref, true);
  Services.prefs.savePrefFile(null);

  const wait = milliseconds => new Promise(resolve => window.setTimeout(resolve, milliseconds));
  function write(name, value) {
    Services.prefs.setStringPref(name, String(value));
    Services.prefs.savePrefFile(null);
  }
  function fail(error) {
    write(`fluxion.recovery.${mode}.error`, `${error?.message || error}\n${error?.stack || ""}`);
    try {
      write(`fluxion.recovery.${mode}.snapshot`, JSON.stringify(normalSnapshots()));
    } catch (snapshotError) {
      Cu.reportError(snapshotError);
    }
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
  function snapshot(browserWindow = window) {
    let sessionWorkspace = "";
    try {
      sessionWorkspace = SessionStore.getCustomWindowValue(
        browserWindow,
        browserWindow.FluxionWorkspaceTabs?.WINDOW_VALUE_KEY || "fluxion-active-workspace",
      );
    } catch (_) {}
    return {
      currentWorkspace: browserWindow.FluxionUI.currentWorkspace(),
      sessionWorkspace,
      isPrivate: PrivateBrowsingUtils.isWindowPrivate(browserWindow),
      workspaces: browserWindow.FluxionUI.workspaces(),
      tabs: [...browserWindow.gBrowser.tabs].map(tab => {
        const split = tab.splitview?.tabs
          ?.map(member => tabURL(member)).sort().join("|") || "";
        return {
          url: tabURL(tab),
          workspace: browserWindow.FluxionUI.tabWorkspace(tab),
          pinned: tab.pinned,
          group: tab.group?.label || "",
          split,
          splitOrientation: tab.splitview ? browserWindow.FluxionUI.splitOrientation(tab) : "",
          active: browserWindow.FluxionUI.workspaceTabActive(tab),
          selected: tab === browserWindow.gBrowser.selectedTab,
        };
      }),
    };
  }
  function normalWindows() {
    return [...Services.wm.getEnumerator("navigator:browser")]
      .filter(browserWindow =>
        !browserWindow.closed && browserWindow.FluxionUI &&
        !PrivateBrowsingUtils.isWindowPrivate(browserWindow)
      );
  }
  function normalSnapshots() {
    return normalWindows().map(snapshot);
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
  async function flushTabs(tabs, browserWindow = window) {
    await Promise.all(tabs.map(tab => {
      try {
        return withDeadline(tab.linkedBrowser?.frameLoader?.requestTabStateFlush?.());
      } catch (_) {
        return Promise.resolve();
      }
    }));
    // Reading the native state after the content flush forces SessionStore to
    // project current tab, group, split, pin, and custom-attribute data.
    SessionStore.getWindowState(browserWindow);
    await wait(400);
  }

  async function seedNormalSession({ crash = false } = {}) {
    const urls = FluxionSessionRecovery.URLS;
    write("fluxion.recovery.seed.progress", "starting");
    Services.prefs.setIntPref("browser.startup.page", crash ? 0 : 3);
    Services.prefs.setBoolPref("browser.sessionstore.resume_from_crash", true);
    Services.prefs.setBoolPref("browser.sessionstore.resume_session_once", !crash);
    if (crash) {
      // Hosted runners are idle. Exercise the normal periodic writer at its
      // active cadence instead of waiting for its long idle interval.
      Services.prefs.setIntPref("browser.sessionstore.interval.idle",
        Services.prefs.getIntPref("browser.sessionstore.interval", 15000));
    }
    await window.FluxionMemory.setEmbeddingProvider("disabled");
    const memoryCapability = await window.FluxionMemory.enable();
    if (
      memoryCapability !== "lexical" ||
      window.FluxionMemory.embeddingProvider() !== "disabled" ||
      Services.prefs.getBoolPref("browser.ml.enable", true) ||
      Services.prefs.getBoolPref("places.semanticHistory.featureGate", true)
    ) {
      throw new Error("keyword-only Browser Memory seed state was not exact");
    }
    const research = window.FluxionUI.workspaces().find(workspace => workspace.id === "research-desk") ||
      window.FluxionUI.createWorkspace("Research Desk", {
        accent: "sage", icon: "square", activate: false,
      });
    if (!research) throw new Error("recovery workspace was not created");
    while (window.FluxionUI.workspaces().findIndex(workspace => workspace.id === research.id) > 2) {
      if (!window.FluxionUI.moveWorkspace(research.id, -1)) break;
    }
    const windowsBefore = new Set(normalWindows());
    window.OpenBrowserWindow();
    const companionResult = await waitFor(() => {
      const candidate = normalWindows().find(browserWindow => !windowsBefore.has(browserWindow));
      return { ok: Boolean(candidate?.FluxionUI), candidate };
    });
    const companion = companionResult.candidate;
    if (!companion) throw new Error("companion Fluxion window did not open");
    window.FluxionUI.switchWorkspace("build");

    const makeTab = (browserWindow, url, workspace = "build") => {
      const tab = browserWindow.gBrowser.addTrustedTab(url, { skipAnimation: true });
      browserWindow.FluxionUI.setTabWorkspace(tab, workspace);
      return tab;
    };
    const groupTabs = [makeTab(window, urls.groupA), makeTab(window, urls.groupB)];
    const splitTabs = [makeTab(window, urls.splitA), makeTab(window, urls.splitB)];
    const pinned = makeTab(window, urls.pinned);
    const focusTabs = [
      makeTab(window, urls.focusIdle, "focus"),
      makeTab(window, urls.focusActive, "focus"),
    ];
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
    const companionBuild = makeTab(companion, urls.companionBuild, "build");
    const companionLife = makeTab(companion, urls.companionLife, "life");
    companion.FluxionUI.switchWorkspace("build");
    companion.gBrowser.selectedTab = companionBuild;
    await wait(100);
    companion.FluxionUI.switchWorkspace("life");
    companion.gBrowser.selectedTab = companionLife;
    await wait(100);
    write("fluxion.recovery.seed.progress", "native-layout-created");

    const keep = new Set([...groupTabs, ...splitTabs, pinned, ...focusTabs]);
    for (const tab of [...window.gBrowser.tabs]) {
      if (!keep.has(tab)) window.gBrowser.removeTab(tab, { animate: false });
    }
    const companionKeep = new Set([companionBuild, companionLife]);
    for (const tab of [...companion.gBrowser.tabs]) {
      if (!companionKeep.has(tab)) companion.gBrowser.removeTab(tab, { animate: false });
    }
    write("fluxion.recovery.seed.progress", "extra-tabs-removed");
    await wait(1800);
    write("fluxion.recovery.seed.progress", "flushing-sessionstore");
    await flushTabs([...groupTabs, ...splitTabs, pinned, ...focusTabs]);
    await flushTabs([companionBuild, companionLife], companion);
    write("fluxion.recovery.seed.progress", "sessionstore-projected");
    const validation = FluxionSessionRecovery.validateWindowSet(normalSnapshots());
    if (!validation.ok) throw new Error(`seed state invalid: ${validation.reasons.join("; ")}`);
    if (crash) {
      await validatePrivateWindow({ leaveOpen: true });
      const token = String(Date.now());
      SessionStore.setCustomWindowValue(window, FluxionSessionRecovery.CRASH_CHECKPOINT_KEY, token);
      const { SessionFile } = ChromeUtils.importESModule("resource:///modules/sessionstore/SessionFile.sys.mjs");
      // Observe a normal periodic checkpoint; never force a write or clean quit.
      const checkpoint = await waitFor(async () => {
        try {
          const state = JSON.parse(await IOUtils.readUTF8(SessionFile.Paths.recovery, { decompress: true }));
          return FluxionSessionRecovery.validateCrashCheckpoint(state, token);
        } catch (error) {
          return { ok: false, reasons: [String(error)] };
        }
      }, 60000);
      if (!checkpoint.ok) throw new Error(`crash checkpoint invalid: ${checkpoint.reasons.join("; ")}`);
      write("fluxion.recovery.crashSeed.health", "periodic-session-checkpoint-ready-with-private-window-open");
      return;
    }
    write("fluxion.recovery.seed.health", "two-window-workspaces-tabs-groups-stacked-split-seeded");
    await quit();
  }

  async function validateRestoredSession({ crash = false } = {}) {
    await SessionStore.promiseAllWindowsRestored;
    if (crash) {
      const { SessionStartup } = ChromeUtils.importESModule("resource:///modules/sessionstore/SessionStartup.sys.mjs");
      if (SessionStartup.previousSessionCrashed !== true || SessionStartup.sessionType !== SessionStartup.RECOVER_SESSION ||
          Services.prefs.getIntPref("browser.startup.page", -1) !== 0 ||
          Services.prefs.getBoolPref("browser.sessionstore.resume_session_once", false)) {
        throw new Error("Gecko did not take its crash recovery path with blank startup and resume-once disabled");
      }
      if ([...Services.wm.getEnumerator("navigator:browser")].some(candidate => PrivateBrowsingUtils.isWindowPrivate(candidate))) {
        throw new Error("A private window returned after process crash");
      }
      const { FluxionMemoryStore } = ChromeUtils.importESModule("resource://fluxion/modules/FluxionMemoryStore.sys.mjs");
      if (await PlacesUtils.history.fetch(FluxionSessionRecovery.URLS.privateOnly) ||
          await FluxionMemoryStore.get(FluxionSessionRecovery.URLS.privateOnly)) {
        throw new Error("Private evidence survived the process crash in history or Memory");
      }
    }
    if (
      !window.FluxionMemory.enabled() ||
      window.FluxionMemory.embeddingProvider() !== "disabled" ||
      Services.prefs.getBoolPref("browser.ml.enable", true) ||
      Services.prefs.getBoolPref("places.semanticHistory.featureGate", true)
    ) {
      throw new Error("keyword-only Browser Memory did not survive startup without ML");
    }
    let result = await waitFor(() => FluxionSessionRecovery.validateWindowSet(normalSnapshots()));
    if (!result.ok) throw new Error(`session restore invalid: ${result.reasons.join("; ")}`);
    const primary = normalWindows().find(browserWindow =>
      [...browserWindow.gBrowser.tabs].some(tab => tabURL(tab) === FluxionSessionRecovery.URLS.groupA)
    );
    const companion = normalWindows().find(browserWindow =>
      [...browserWindow.gBrowser.tabs].some(tab => tabURL(tab) === FluxionSessionRecovery.URLS.companionLife)
    );
    if (!primary || !companion || primary === companion) {
      throw new Error("restored window identities were not distinct");
    }
    // Capture the native identities before selection causes Gecko to restore a
    // lazy browser. Its currentURI can briefly be about:blank during that swap.
    const expectedTab = (browserWindow, url) => {
      const tab = [...browserWindow.gBrowser.tabs].find(candidate => tabURL(candidate) === url);
      if (!tab) throw new Error(`restored native tab was missing before workspace switch: ${url}`);
      return tab;
    };
    const focusActive = expectedTab(primary, FluxionSessionRecovery.URLS.focusActive);
    const buildActive = expectedTab(primary, FluxionSessionRecovery.URLS.splitA);
    const companionBuild = expectedTab(companion, FluxionSessionRecovery.URLS.companionBuild);
    const companionLife = expectedTab(companion, FluxionSessionRecovery.URLS.companionLife);
    const switchAndRestore = async (browserWindow, workspace, tab, url) => {
      browserWindow.FluxionUI.switchWorkspace(workspace);
      const assertIdentity = () => {
        if (browserWindow.FluxionUI.currentWorkspace() !== workspace ||
            browserWindow.gBrowser.selectedTab !== tab || !tab.parentNode) {
          throw new Error(`${workspace} did not immediately select and retain its remembered native tab`);
        }
      };
      assertIdentity();
      const restored = await waitFor(() => {
        assertIdentity();
        return { ok: tabURL(tab) === url };
      });
      if (!restored.ok) throw new Error(`${workspace} selected the right tab but its page did not restore: ${tabURL(tab)}`);
    };
    await switchAndRestore(primary, "focus", focusActive, FluxionSessionRecovery.URLS.focusActive);
    await switchAndRestore(primary, "build", buildActive, FluxionSessionRecovery.URLS.splitA);
    result = await waitFor(() => FluxionSessionRecovery.validateWindowSet(normalSnapshots()));
    if (!result.ok) throw new Error(`workspace resume invalid: ${result.reasons.join("; ")}`);
    if (
      companion.FluxionUI.currentWorkspace() !== "life" ||
      tabURL(companion.gBrowser.selectedTab) !== FluxionSessionRecovery.URLS.companionLife
    ) {
      throw new Error("operating the primary window changed the companion workspace");
    }
    await switchAndRestore(companion, "build", companionBuild, FluxionSessionRecovery.URLS.companionBuild);
    await switchAndRestore(companion, "life", companionLife, FluxionSessionRecovery.URLS.companionLife);
    if (primary.FluxionUI.currentWorkspace() !== "build" || primary.gBrowser.selectedTab !== buildActive) {
      throw new Error("operating the companion window changed the primary workspace or selected tab");
    }
    result = await waitFor(() => FluxionSessionRecovery.validateWindowSet(normalSnapshots()));
    if (!result.ok) throw new Error(`companion workspace resume invalid: ${result.reasons.join("; ")}`);
    if (crash) {
      const absence = FluxionSessionRecovery.validatePrivateAbsence(normalSnapshots());
      if (!absence.ok) throw new Error(absence.reasons.join("; "));
      write("fluxion.recovery.crashRestore.health", "sigkill-session-restored-native-layout-with-private-evidence-excluded");
    } else {
      write("fluxion.recovery.restore.health", "two-window-workspaces-tabs-groups-stacked-split-restored");
    }
    for (const browserWindow of normalWindows()) {
      await flushTabs([...browserWindow.gBrowser.tabs], browserWindow);
    }
    await quit();
  }

  async function validatePrivateWindow({ leaveOpen = false } = {}) {
    await SessionStore.promiseAllWindowsRestored;
    const restored = await waitFor(() => FluxionSessionRecovery.validateWindowSet(normalSnapshots()));
    if (!restored.ok) throw new Error(`pre-private window restore invalid: ${restored.reasons.join("; ")}`);
    const windowsBefore = new Set([...Services.wm.getEnumerator("navigator:browser")]);
    window.OpenBrowserWindow({ private: true });
    const privateResult = await waitFor(() => {
      const candidate = [...Services.wm.getEnumerator("navigator:browser")].find(browserWindow =>
        !windowsBefore.has(browserWindow) && !browserWindow.closed &&
        PrivateBrowsingUtils.isWindowPrivate(browserWindow) &&
        browserWindow.FluxionUI && browserWindow.FluxionMemory
      );
      return { ok: Boolean(candidate), candidate };
    });
    const privateBrowserWindow = privateResult.candidate;
    if (!privateBrowserWindow) throw new Error("private Fluxion window did not open");
    const privateURL = FluxionSessionRecovery.URLS.privateOnly;
    let tab = [...privateBrowserWindow.gBrowser.tabs].find(candidate => tabURL(candidate) === privateURL);
    if (!tab) tab = privateBrowserWindow.gBrowser.addTrustedTab(privateURL, { skipAnimation: true });
    privateBrowserWindow.gBrowser.selectedTab = tab;
    await wait(1500);
    const memory = await privateBrowserWindow.FluxionMemory.search("fluxion private only");
    const enabled = await privateBrowserWindow.FluxionMemory.enable();
    if (privateBrowserWindow.FluxionMemory.embeddingProvider() !== "disabled") {
      throw new Error("private launch changed the persisted embedding mode");
    }
    const result = FluxionSessionRecovery.validatePrivate({
      isPrivate: PrivateBrowsingUtils.isWindowPrivate(privateBrowserWindow),
      memoryState: memory.state,
      memoryResults: memory.results.length,
      memoryEnabled: enabled,
    });
    if (!result.ok) throw new Error(`private boundary invalid: ${result.reasons.join("; ")}`);
    write("fluxion.recovery.private.health", "private-memory-boundary-enforced");
    if (leaveOpen) {
      const loaded = await waitFor(() => ({ ok: tabURL(tab) === privateURL && !tab.hasAttribute("busy") }));
      if (!loaded.ok) throw new Error("private crash fixture did not finish its HTTPS navigation");
      return privateBrowserWindow;
    }
    privateBrowserWindow.close();
    const closed = await waitFor(() => ({ ok: privateBrowserWindow.closed }), 8000);
    if (!closed.ok) throw new Error("private Fluxion window did not close");
    const normalState = FluxionSessionRecovery.validateWindowSet(normalSnapshots());
    if (!normalState.ok) throw new Error(`post-private live session invalid: ${normalState.reasons.join("; ")}`);
    for (const browserWindow of normalWindows()) {
      await flushTabs([...browserWindow.gBrowser.tabs], browserWindow);
    }
    await quit();
  }

  async function validatePrivateAbsence() {
    await SessionStore.promiseAllWindowsRestored;
    const restored = await waitFor(() =>
      FluxionSessionRecovery.validateWindowSet(normalSnapshots(), { requirePrivateAbsence: true })
    );
    if (!restored.ok) throw new Error(`post-private window restore invalid: ${restored.reasons.join("; ")}`);
    const result = FluxionSessionRecovery.validatePrivateAbsence(normalSnapshots());
    if (!result.ok) throw new Error(`post-private tab isolation invalid: ${result.reasons.join("; ")}`);
    const privateURL = FluxionSessionRecovery.URLS.privateOnly;
    const historyRecord = await PlacesUtils.history.fetch(privateURL);
    if (historyRecord) throw new Error("private URL leaked into Gecko Places history");
    const memory = await window.FluxionMemory.search("fluxion private only");
    if (memory.results.some(record => record.url === privateURL)) {
      throw new Error("private URL leaked into Browser Memory search");
    }
    if (
      window.FluxionMemory.embeddingProvider() !== "disabled" ||
      Services.prefs.getBoolPref("browser.ml.enable", true)
    ) {
      throw new Error("post-private startup did not preserve keyword-only mode");
    }
    write("fluxion.recovery.absence.health", "private-tabs-history-memory-excluded");
    await quit();
  }

  const startupHomepage = "https://example.com/?fluxion-startup=custom-homepage";
  const startupBookmarkTitle = "Fluxion startup reference";
  function validateStartupPreferences(expectedPage) {
    if (Services.prefs.getStringPref("browser.startup.homepage", "") !== startupHomepage) {
      throw new Error("custom homepage preference was overwritten during startup");
    }
    if (Services.prefs.getIntPref("browser.startup.page", -1) !== expectedPage) {
      throw new Error(`startup mode ${expectedPage} was not preserved`);
    }
    if (Services.prefs.getStringPref("browser.toolbars.bookmarks.visibility", "") !== "always") {
      throw new Error("the chosen bookmarks toolbar preference was overwritten during startup");
    }
  }

  async function validateVisibleBookmarksToolbar() {
    const visible = await waitFor(() => {
      const toolbar = window.document.getElementById("PersonalToolbar");
      const style = toolbar ? window.getComputedStyle(toolbar) : null;
      const height = toolbar?.getBoundingClientRect().height || 0;
      const bookmark = toolbar ? [...toolbar.querySelectorAll(".bookmark-item")].find(item =>
        item.getAttribute("label") === startupBookmarkTitle
      ) : null;
      return {
        ok: height > 0 && style?.visibility === "visible" && style.display !== "none" &&
          Boolean(bookmark?.getBoundingClientRect().width > 0),
        details: `height=${height} visibility=${style?.visibility || "missing"} ` +
          `display=${style?.display || "missing"} bookmarkVisible=${Boolean(bookmark?.getBoundingClientRect().width > 0)}`,
      };
    });
    if (!visible.ok) throw new Error(`Saved bookmarks toolbar was not visible: ${visible.details}`);
  }

  async function seedStartupPreferences() {
    await SessionStore.promiseAllWindowsRestored;
    await PlacesUtils.bookmarks.insert({
      parentGuid: PlacesUtils.bookmarks.toolbarGuid,
      title: startupBookmarkTitle,
      url: startupHomepage,
    });
    Services.prefs.setStringPref("browser.startup.homepage", startupHomepage);
    Services.prefs.setIntPref("browser.startup.page", 1);
    Services.prefs.setStringPref("browser.toolbars.bookmarks.visibility", "always");
    Services.prefs.setBoolPref("browser.sessionstore.resume_session_once", false);
    validateStartupPreferences(1);
    write("fluxion.recovery.preferencesSeed.health", "custom-homepage-startup-and-toolbar-seeded");
    await quit();
  }

  async function validateHomepageStartup() {
    await SessionStore.promiseAllWindowsRestored;
    validateStartupPreferences(1);
    const loaded = await waitFor(() => ({
      ok: tabURL(window.gBrowser.selectedTab) === startupHomepage,
    }));
    if (!loaded.ok) {
      throw new Error(`Gecko did not open the saved homepage: ${tabURL(window.gBrowser.selectedTab)}`);
    }
    await validateVisibleBookmarksToolbar();
    write("fluxion.recovery.homepage.health", "saved-homepage-opened-by-gecko-startup");
    await quit();
  }

  async function seedBlankStartup() {
    await SessionStore.promiseAllWindowsRestored;
    validateStartupPreferences(1);
    Services.prefs.setIntPref("browser.startup.page", 0);
    Services.prefs.setBoolPref("browser.sessionstore.resume_session_once", false);
    validateStartupPreferences(0);
    write("fluxion.recovery.blankSeed.health", "blank-startup-seeded-with-homepage-retained");
    await quit();
  }

  async function validateBlankStartup() {
    await SessionStore.promiseAllWindowsRestored;
    validateStartupPreferences(0);
    const blank = await waitFor(() => ({
      ok: tabURL(window.gBrowser.selectedTab) === "about:blank",
    }));
    if (!blank.ok) {
      throw new Error(`Gecko did not honor blank startup: ${tabURL(window.gBrowser.selectedTab)}`);
    }
    await validateVisibleBookmarksToolbar();
    write("fluxion.recovery.blank.health", "blank-startup-honored-with-homepage-retained");
    await quit();
  }

  Services.prefs.setStringPref("fluxion.recovery.health", "multi-launch-gate-loaded");
  Services.prefs.savePrefFile(null);
  window.setTimeout(() => {
    const tasks = {
      seed: seedNormalSession,
      restore: validateRestoredSession,
      private: validatePrivateWindow,
      absence: validatePrivateAbsence,
      preferencesSeed: seedStartupPreferences,
      homepage: validateHomepageStartup,
      blankSeed: seedBlankStartup,
      blank: validateBlankStartup,
      crashSeed: () => seedNormalSession({ crash: true }),
      crashRestore: () => validateRestoredSession({ crash: true }),
    };
    const task = tasks[mode]();
    task.catch(fail);
  }, 700);
})(window);
