/* global Services, SessionStore, IOUtils, PathUtils, ChromeUtils, Cu */
(function verifyDeferredNewTab(window) {
  "use strict";
  if (Services.env.get("FLUXION_NEW_TAB_TEST") !== "1") return;
  const prefix = "fluxion.newTab.verification";
  if (Services.prefs.getBoolPref(`${prefix}.claimed`, false)) return;
  Services.prefs.setBoolPref(`${prefix}.claimed`, true);
  const driver = Services.env.get("FLUXION_NEW_TAB_DRIVER_DIR");
  const origin = Services.env.get("FLUXION_NEW_TAB_ORIGIN");
  const report = { input: "System Events Cmd-T, typing, Return and Escape; Gecko widget sidebar click", checks: [], keys: [], stages: [] };
  const assert = (condition, message) => { if (!condition) throw Error(message); };
  const stage = value => {
    report.stages.push(value); Services.prefs.setStringPref(`${prefix}.stage`, value); Services.prefs.savePrefFile(null);
  };
  const wait = async (check, message, timeout = 20000) => {
    const end = Date.now() + timeout;
    do { const value = await check(); if (value) return value; await new Promise(resolve => window.setTimeout(resolve, 40)); } while (Date.now() < end);
    throw Error(message);
  };
  let sequence = 0, privateWindow = null;
  async function key(owner, action, text = "") {
    assert(["activate", "newtab", "type", "return", "escape"].includes(action) && ++sequence <= 80, "Unknown or unbounded native key request");
    if (action !== "activate") assert(Services.focus.activeWindow === owner && owner.document.hasFocus(), "Native key target lost foreground");
    if (action === "type") assert(/^[\x20-\x7e]{1,512}$/.test(text), "Native typing fixture must be short ASCII");
    const name = `${sequence}-${action}`;
    await IOUtils.writeUTF8(PathUtils.join(driver, `${name}.ready`), action === "type" ? text : "ready");
    await wait(() => IOUtils.exists(PathUtils.join(driver, `${name}.sent`)), `Native driver did not acknowledge ${name}`);
  }
  function observeKeys(owner) {
    owner.addEventListener("keydown", event => {
      if (event.isTrusted && ["t", "T", "Escape", "Enter"].includes(event.key) && report.keys.length < 80) {
        report.keys.push({ key: event.key, command: event.metaKey, private: owner === privateWindow,
          pending: owner.FluxionNewTab?.pending, tabs: owner.gBrowser.tabs.length });
      }
    }, true);
  }
  function snapshot(owner) {
    const tab = owner.gBrowser.selectedTab;
    return { tab, count: owner.gBrowser.tabs.length, browser: tab.linkedBrowser,
      url: tab.linkedBrowser.currentURI.spec, typed: tab.linkedBrowser.userTypedValue,
      searchMode: owner.gURLBar.getSearchMode(tab.linkedBrowser), title: tab.linkedBrowser.contentTitle,
      workspace: owner.FluxionUI.currentWorkspace(), container: Number(tab.getAttribute("usercontextid") || 0) };
  }
  function unchanged(owner, source) {
    assert(source.tab.parentNode && !source.tab.closing && source.browser.currentURI.spec === source.url,
      "Deferred New Tab navigated or closed its original source");
    assert(source.browser.userTypedValue === source.typed, "Draft left its typed value on the original page");
    const mode = owner.gURLBar.getSearchMode(source.browser);
    const stableMode = value => value && JSON.stringify(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
    assert(stableMode(mode) === stableMode(source.searchMode), "Draft changed the original page's search mode");
  }
  async function readySource(owner, url, container = 0) {
    const tab = owner.gBrowser.addTrustedTab(url, { userContextId: container, skipAnimation: true });
    owner.FluxionUI.setTabWorkspace(tab, owner.FluxionUI.currentWorkspace());
    owner.FluxionUI.selectTab(tab);
    await wait(() => tab === owner.gBrowser.selectedTab && tab.linkedBrowser.currentURI.spec === url && !tab.hasAttribute("busy") &&
      tab.linkedBrowser.contentTitle === "Fluxion new tab fixture",
      "Native source fixture did not load");
    owner.gBrowser.selectedBrowser.focus();
    return snapshot(owner);
  }
  async function begin(owner) {
    const count = owner.gBrowser.tabs.length;
    await key(owner, "newtab");
    await wait(() => owner.FluxionNewTab.pending && owner.document.activeElement === owner.gURLBar.inputField,
      "Native Cmd-T did not open a deferred address draft");
    assert(owner.gBrowser.tabs.length === count, "Cmd-T created a tab before submission");
  }
  function createQueryTracker() {
    let watched = null, outcome = { status: "pending" };
    return {
      observe(current) {
        if (current && current !== watched) {
          watched = current;
          outcome = { status: "pending" };
          current.then(context => {
            if (watched === current) outcome = { status: "resolved", context };
          }, error => {
            if (watched === current) outcome = { status: "rejected", error };
          });
        }
        return { ...outcome, promise: watched };
      },
    };
  }
  async function typeAndSettle(owner, value) {
    assert(owner.document.activeElement === owner.gURLBar.inputField, "Address field not focused before native typing");
    await key(owner, "type", value);
    await wait(() => owner.gURLBar.value === value, "Native typing did not reach the address draft");
    // A key acknowledgement precedes asynchronous suggestion completion. Wait
    // for the current query, following replacement queries without starting or
    // cancelling one in the verifier, before testing Escape or Return.
    const tracker = createQueryTracker();
    await wait(() => {
      const current = owner.gURLBar.lastQueryContextPromise;
      const state = tracker.observe(current);
      assert(state.status !== "rejected", `Native address query rejected: ${String(state.error)}\n${state.error?.stack || ""}`);
      return state.status === "resolved" && state.promise === owner.gURLBar.lastQueryContextPromise && owner.gURLBar.value === value;
    }, "Native address query did not finish");
  }
  async function commit(owner, source, value, expectedURL) {
    await begin(owner);
    await typeAndSettle(owner, value);
    assert(owner.gBrowser.tabs.length === source.count && owner.gBrowser.selectedTab === source.tab,
      "Typing created or selected a tab before Return");
    await key(owner, "return");
    const target = await wait(() => owner.gBrowser.selectedTab !== source.tab &&
      owner.gBrowser.selectedBrowser.currentURI.spec === expectedURL && !owner.gBrowser.selectedTab.hasAttribute("busy") && owner.gBrowser.selectedTab,
    "Native address submission did not load exactly the requested page");
    assert(owner.gBrowser.tabs.length === source.count + 1 && !owner.FluxionNewTab.pending, "Submission did not create exactly one committed tab");
    assert(owner.FluxionUI.tabWorkspace(target) === source.workspace && Number(target.getAttribute("usercontextid") || 0) === source.container,
      "Submitted draft crossed its workspace or account container");
    unchanged(owner, source);
    return target;
  }
  async function run() {
    assert(driver === PathUtils.join(PathUtils.parent(PathUtils.profileDir), "driver") && /^http:\/\/127\.0\.0\.1:\d+$/.test(origin),
      "New Tab native fixture must use an isolated loopback profile");
    await SessionStore.promiseAllWindowsRestored;
    await wait(() => window.FluxionNewTab && window.FluxionUI, "Deferred New Tab did not initialize");
    Services.prefs.setBoolPref("browser.search.suggest.enabled", false);
    const { SearchService } = ChromeUtils.importESModule("moz-src:///toolkit/components/search/SearchService.sys.mjs");
    const { PrivateBrowsingUtils } = ChromeUtils.importESModule("resource://gre/modules/PrivateBrowsingUtils.sys.mjs");
    await SearchService.init();
    const engine = await SearchService.addOpenSearchEngine(`${origin}/engine.xml`, null, {});
    await SearchService.setDefault(engine, SearchService.CHANGE_REASON.USER);
    await SearchService.setDefaultPrivate(engine, SearchService.CHANGE_REASON.USER);
    assert(engine.getSubmission("proof", null).postData, "Fixture engine must produce actual POST search data");
    observeKeys(window);
    await key(window, "activate");
    await wait(() => Services.focus.activeWindow === window && window.document.hasFocus(), "Fixture did not gain foreground");
    window.FluxionUI.setSidebarState("expanded");
    const source = await readySource(window, `${origin}/page?case=source`, 1);

    stage("native-cmd-t-and-cancel");
    await begin(window);
    await begin(window);
    assert(window.gBrowser.selectedTab === source.tab && window.gBrowser.tabs.length === source.count, "Repeated Cmd-T created blank tabs");
    await typeAndSettle(window, `${origin}/page?case=cancelled`);
    await key(window, "escape");
    await wait(() => !window.FluxionNewTab.pending && !window.gURLBar.view.isOpen, "Escape did not cancel the native draft");
    unchanged(window, source);
    assert(window.gBrowser.tabs.length === source.count && window.gBrowser.selectedTab === source.tab, "Escape changed the tab set");
    report.checks.push("native-cmd-t-and-repeat-defer-creation-escape-preserves-source");

    stage("native-sidebar-click");
    const button = window.document.querySelector(".fluxion-new-tab");
    await wait(() => button?.isConnected && button.getBoundingClientRect().height > 0, "Sidebar New Tab not visible");
    const rect = button.getBoundingClientRect();
    let trustedClick = false;
    button.addEventListener("click", event => { trustedClick = event.isTrusted; }, { once: true });
    for (const type of ["mousemove", "mousedown", "mouseup"]) {
      window.synthesizeMouseEvent(type, rect.x + rect.width / 2, rect.y + rect.height / 2, {
        identifier: window.windowUtils.DEFAULT_MOUSE_POINTER_ID, button: 0,
        buttons: type === "mousedown" ? 1 : 0, clickCount: type === "mousemove" ? 0 : 1,
        modifiers: 0, inputSource: window.MouseEvent.MOZ_SOURCE_MOUSE,
      }, { isDOMEventSynthesized: true, isWidgetEventSynthesized: false, isAsyncEnabled: false, toWindow: true });
    }
    await wait(() => trustedClick && window.FluxionNewTab.pending && window.document.activeElement === window.gURLBar.inputField,
      "Trusted sidebar New Tab click did not focus a draft");
    assert(window.gBrowser.tabs.length === source.count, "Sidebar click created a blank tab");
    await typeAndSettle(window, "cancel sidebar draft");
    await key(window, "escape");
    await wait(() => !window.FluxionNewTab.pending, "Sidebar draft did not cancel");
    unchanged(window, source);
    report.checks.push("trusted-sidebar-click-defers-and-escape-cancels");

    stage("native-url-container-commit");
    await commit(window, source, `${origin}/page?case=committed#exact`, `${origin}/page?case=committed#exact`);
    report.checks.push("native-url-submission-creates-one-tab-preserves-source-workspace-and-container");
    stage("native-post-search");
    const searchSource = snapshot(window);
    await commit(window, searchSource, "fluxion native post proof", `${origin}/search`);
    const state = await (await window.fetch(`${origin}/state`, { cache: "no-store" })).json();
    const searches = state.requests.filter(request => request.path === "/search");
    assert(searches.length === 1 && searches[0].method === "POST" && new URLSearchParams(searches[0].body).get("q") === "fluxion native post proof",
      "Native default-engine search dropped, duplicated or changed its POST data");
    report.search = searches[0];
    report.checks.push("native-default-opensearch-post-submission-preserved");

    stage("source-search-mode-restoration");
    await readySource(window, `${origin}/page?case=search-mode-source`, 1);
    await window.gURLBar.setSearchMode({ engineName: engine.name, entry: "other", isPreview: false }, window.gBrowser.selectedBrowser);
    window.gURLBar.search("earlier source query", { focus: true });
    window.gBrowser.selectedBrowser.userTypedValue = "earlier source query";
    const modeSource = snapshot(window);
    assert(modeSource.searchMode?.engineName === engine.name && modeSource.searchMode.isPreview === false,
      "Source fixture did not retain a real confirmed engine search mode");
    await begin(window);
    await typeAndSettle(window, "discard this draft query");
    await key(window, "escape");
    await wait(() => !window.FluxionNewTab.pending, "Search-mode source draft did not cancel");
    unchanged(window, modeSource);
    assert(window.gURLBar.value === "earlier source query", "Cancel did not restore the original visible search query");
    await commit(window, modeSource, `${origin}/page?case=mode-source-commit`, `${origin}/page?case=mode-source-commit`);
    report.checks.push("native-cancel-and-commit-restore-confirmed-source-search-mode-and-typed-query");

    stage("data-url-principal-isolation");
    const dataSource = await readySource(window, `${origin}/page?case=data-source`, 1);
    const dataURL = "data:text/html,<title>Fluxion%20opaque%20draft</title>";
    const dataTarget = await commit(window, dataSource, dataURL, Services.io.newURI(dataURL).spec);
    await wait(() => dataTarget.linkedBrowser.contentTitle === "Fluxion opaque draft", "Typed data URL did not render its document");
    assert(dataTarget.linkedBrowser.contentPrincipal.isNullPrincipal && !dataTarget.linkedBrowser.contentPrincipal.isSystemPrincipal,
      "Typed data document acquired a non-opaque or privileged principal");
    assert(dataSource.browser.contentTitle === dataSource.title, "Typed data document changed the original page title");
    report.checks.push("native-data-url-renders-in-new-opaque-non-system-document-original-preserved");

    stage("javascript-url-source-isolation");
    const scriptSource = await readySource(window, `${origin}/page?case=script-source`, 1);
    const scriptURL = "javascript:document.documentElement.setAttribute('data-fluxion-script-probe','1');document.title='Fluxion_script_target';void(0)";
    assert(!window.document.documentElement.hasAttribute("data-fluxion-script-probe"), "Chrome script probe unexpectedly pre-exists");
    await begin(window);
    await typeAndSettle(window, scriptURL);
    const load = window.gURLBar.controller.loadURL;
    let scriptAttempt = false;
    function observeLoad(details) {
      if (details.url.startsWith("javascript:")) scriptAttempt = true;
      return load.call(this, details);
    }
    window.gURLBar.controller.loadURL = observeLoad;
    try {
      await key(window, "return");
      await wait(() => scriptAttempt && !window.FluxionNewTab.pending && window.gBrowser.selectedTab !== scriptSource.tab,
        "Native JavaScript URL did not reach its isolated target through the native controller");
    } finally {
      if (window.gURLBar.controller.loadURL === observeLoad) window.gURLBar.controller.loadURL = load;
    }
    const scriptTarget = window.gBrowser.selectedTab;
    assert(window.gBrowser.tabs.length === scriptSource.count + 1 && !scriptTarget.linkedBrowser.contentPrincipal.isSystemPrincipal,
      "JavaScript draft did not remain confined to one non-system target");
    unchanged(window, scriptSource);
    assert(scriptSource.browser.contentTitle === scriptSource.title && !window.document.documentElement.hasAttribute("data-fluxion-script-probe"),
      "JavaScript draft executed against its original page or browser chrome");
    report.script = { nativeLoadObserved: scriptAttempt, sourceTitle: scriptSource.title,
      targetPrincipal: scriptTarget.linkedBrowser.contentPrincipal.isNullPrincipal ? "null" : "content", chromeMarkerAbsent: true };

    stage("workspace-draft-invalidation");
    const beforeSwitch = snapshot(window), other = window.FluxionUI.createWorkspace("Draft boundary", { activate: false });
    const otherTab = window.gBrowser.addTrustedTab(`${origin}/page?case=other-workspace`, { skipAnimation: true });
    window.FluxionUI.setTabWorkspace(otherTab, other.id);
    const countBeforeSwitch = window.gBrowser.tabs.length;
    await begin(window);
    await typeAndSettle(window, `${origin}/page?case=stale`);
    window.FluxionUI.switchWorkspace(other.id);
    await wait(() => !window.FluxionNewTab.pending && window.FluxionUI.currentWorkspace() === other.id,
      "Workspace switch left a live draft from another workspace");
    unchanged(window, beforeSwitch);
    assert(window.gBrowser.tabs.length === countBeforeSwitch, "Workspace cancellation committed a stale draft");
    report.checks.push("workspace-change-invalidates-draft-without-navigation");

    stage("private-native-commit");
    privateWindow = window.OpenBrowserWindow({ private: true });
    await wait(() => privateWindow.FluxionNewTab && privateWindow.FluxionUI && PrivateBrowsingUtils.isWindowPrivate(privateWindow),
      "Private deferred-tab window did not initialize");
    observeKeys(privateWindow); privateWindow.focus();
    await key(privateWindow, "activate");
    await wait(() => Services.focus.activeWindow === privateWindow && privateWindow.document.hasFocus(), "Private fixture did not become foreground");
    const privateSource = await readySource(privateWindow, `${origin}/page?case=private-source`);
    const privateTarget = await commit(privateWindow, privateSource, `${origin}/page?case=private-commit`, `${origin}/page?case=private-commit`);
    assert(privateTarget.linkedBrowser.contentPrincipal.originAttributes.privateBrowsingId === 1,
      "Native private draft escaped private origin attributes");
    report.checks.push("native-private-draft-commit-retains-private-origin-attributes");
    // Recheck after subsequent actual network loads and native commands, rather
    // than treating the synchronous load dispatch as script-completion proof.
    unchanged(window, scriptSource);
    assert(scriptSource.browser.contentTitle === scriptSource.title && !window.document.documentElement.hasAttribute("data-fluxion-script-probe") &&
      !scriptTarget.linkedBrowser.contentPrincipal.isSystemPrincipal, "JavaScript draft later escaped its non-system target");
    report.checks.push("native-javascript-load-keeps-original-title-and-non-system-target-through-remaining-gate");
    assert(report.keys.some(event => event.command && event.key.toLowerCase() === "t") && report.keys.some(event => event.key === "Enter") &&
      report.keys.some(event => event.key === "Escape"), "Required native input was not observed");
  }
  run().then(() => Services.prefs.setStringPref(`${prefix}.health`, "native-deferred-new-tab-verified"))
    .catch(error => {
      report.failure = [window, privateWindow].filter(owner => owner && !owner.closed).map(owner => ({
        private: owner === privateWindow, active: Services.focus.activeWindow === owner,
        tabs: owner.gBrowser?.tabs.length, url: owner.gBrowser?.selectedBrowser.currentURI.spec,
        typed: owner.gBrowser?.selectedBrowser.userTypedValue, field: owner.gURLBar?.value,
        pending: owner.FluxionNewTab?.pending, suggestions: owner.gURLBar?.view.isOpen,
        focused: owner.document.activeElement?.id || owner.document.activeElement?.localName,
      }));
      Services.prefs.setStringPref(`${prefix}.error`, `${error.message}\n${error.stack || ""}`); Cu.reportError(error);
    })
    .finally(() => {
      if (privateWindow && !privateWindow.closed) privateWindow.close();
      Services.prefs.setStringPref(`${prefix}.report`, JSON.stringify(report)); Services.prefs.savePrefFile(null);
    });
})(window);
