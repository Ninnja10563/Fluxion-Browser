/* global Services, SessionStore, IOUtils, PathUtils, ChromeUtils, Cu, Ci, Components */
(function verifyDeferredNewTab(window) {
  "use strict";
  if (Services.env.get("FLUXION_NEW_TAB_TEST") !== "1") return;
  const prefix = "fluxion.newTab.verification";
  if (Services.prefs.getBoolPref(`${prefix}.claimed`, false)) return;
  Services.prefs.setBoolPref(`${prefix}.claimed`, true);
  const driver = Services.env.get("FLUXION_NEW_TAB_DRIVER_DIR");
  const origin = Services.env.get("FLUXION_NEW_TAB_ORIGIN");
  const report = { input: "System Events Cmd-T, Cmd-W, typing, Return and Escape; Gecko widget sidebar click", checks: [], keys: [], stages: [] };
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
    assert(["activate", "newtab", "close", "type", "return", "escape",
      "capture-ordinary-empty", "capture-ordinary-draft", "capture-private-empty", "capture-private-draft"].includes(action) &&
      ++sequence <= 80, "Unknown or unbounded native key request");
    if (action !== "activate") assert(Services.focus.activeWindow === owner && owner.document.hasFocus(), "Native key target lost foreground");
    if (action === "type") assert(/^[\x20-\x7e]{1,512}$/.test(text), "Native typing fixture must be short ASCII");
    const name = `${sequence}-${action}`;
    await IOUtils.writeUTF8(PathUtils.join(driver, `${name}.ready`), action === "type" ? text : "ready");
    await wait(() => IOUtils.exists(PathUtils.join(driver, `${name}.sent`)), `Native driver did not acknowledge ${name}`);
  }
  function observeKeys(owner) {
    // Draft Escape deliberately stops ordinary propagation. Gecko dispatches
    // the system group separately after clearing those flags (EventDispatcher
    // 155); observe there without preventing or altering the native event.
    owner.addEventListener("keydown", event => {
      const command = event.metaKey && ["t", "w"].includes(event.key.toLowerCase());
      if (event.isTrusted && (command || ["Escape", "Enter"].includes(event.key)) && report.keys.length < 80) {
        report.keys.push({ key: event.key, command: event.metaKey, private: owner === privateWindow,
          pending: owner.FluxionNewTab?.pending, tabs: owner.gBrowser.tabs.length });
      }
    }, { capture: true, mozSystemGroup: true, passive: true, wantUntrusted: false });
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
  function observeFinalSessionFlush(browser) {
    const topic = "sessionstore-browser-shutdown-flush";
    let complete = false;
    const observer = subject => { if (subject === browser) complete = true; };
    Services.obs.addObserver(observer, topic);
    return { get complete() { return complete; }, dispose() { Services.obs.removeObserver(observer, topic); } };
  }
  async function verifyEmptyWorkspace(owner, searchOrigin, privateMode) {
    const label = privateMode ? "private" : "ordinary";
    stage(`${label}-empty-workspace`);
    await wait(() => owner.FluxionEmptyWorkspace, "Empty workspace controller did not initialize");
    const ui = owner.FluxionUI, empty = owner.FluxionEmptyWorkspace, browser = owner.gBrowser;
    const marker = "fluxion-empty-workspace";
    const preserved = [...browser.tabs].filter(tab => !tab.closing && !empty.isPlaceholder(tab))
      .map(tab => ({ tab, url: tab.linkedBrowser.currentURI.spec, workspace: ui.tabWorkspace(tab) }));
    assert(preserved.length > 0, "Empty workspace fixture needs real tabs in another workspace");
    const workspace = ui.createWorkspace(`${label} empty workspace`, { activate: false });
    const sourceURL = `${origin}/page?case=${label}-empty-source`;
    const source = browser.addTrustedTab(sourceURL, { skipAnimation: true });
    ui.setTabWorkspace(source, workspace.id);
    ui.setSidebarState("expanded");
    ui.selectTab(source);
    const rows = () => [...owner.document.querySelectorAll("#fluxion-flow .fluxion-tab")];
    await wait(() => source.linkedBrowser.currentURI.spec === sourceURL && !source.hasAttribute("busy") &&
      rows().length === 1 && rows()[0]._fluxionTab === source, "Dedicated workspace did not show exactly its real source tab");
    const assertOtherWorkspaces = () => {
      assert(!owner.closed, "Closing an empty workspace closed its browser window");
      assert(preserved.every(item => item.tab.parentNode && !item.tab.closing &&
        item.tab.linkedBrowser.currentURI.spec === item.url && ui.tabWorkspace(item.tab) === item.workspace),
      "Empty workspace closure changed or closed another workspace's tabs");
    };
    async function closeToEmpty(tab) {
      const closedURL = tab.linkedBrowser.currentURI.spec;
      // Gecko can add the real page to undo history only after its asynchronous
      // final child-state update, later than tab detachment. Observe the pinned
      // SessionStore completion notification before sending the actual Cmd-W.
      const flush = observeFinalSessionFlush(tab.linkedBrowser);
      browser.selectedBrowser.focus();
      try {
        await key(owner, "close");
        const backing = await wait(() => !owner.closed && !tab.parentNode &&
          empty.isPlaceholder(browser.selectedTab) && ui.currentWorkspace() === workspace.id && rows().length === 0 &&
          owner.document.documentElement.hasAttribute("data-fluxion-empty-workspace") && browser.selectedTab,
        "Cmd-W did not leave an open, genuinely empty visible workspace");
        assertOtherWorkspaces();
        const emptyURLs = ["about:blank", "about:newtab", Services.prefs.getStringPref("fluxion.newtab.url", "about:newtab")];
        assert(emptyURLs.includes(backing.linkedBrowser.currentURI.spec), "Empty workspace backing page is not an owned blank/new-tab document");
        const saved = JSON.parse(SessionStore.getTabState(backing));
        assert(saved.attributes?.[marker] === "true", "Empty backing identity is absent from native session state");
        await wait(() => flush.complete, "Closed real source did not finish its native SessionStore shutdown flush");
        await wait(() => SessionStore.getClosedTabDataForWindow(owner).some(item =>
          item.state?.entries?.some(entry => entry.url === closedURL)),
        `Closed real source is missing from native undo history: ${closedURL}`);
        return backing;
      } finally { flush.dispose(); }
    }
    let backing = await closeToEmpty(source);
    await new Promise(resolve => owner.requestAnimationFrame(() => owner.requestAnimationFrame(resolve)));
    await key(owner, `capture-${label}-empty`);
    const emptyCount = browser.tabs.length, closedCount = SessionStore.getClosedTabCountForWindow(owner);
    await key(owner, "close");
    const repeatClose = { label, countBefore: emptyCount, countAfter: browser.tabs.length,
      sameBacking: browser.selectedTab === backing, originalAttached: !!backing.parentNode,
      originalClosing: backing.closing, selectedEmpty: empty.isPlaceholder(browser.selectedTab), rows: rows().length,
      closedBefore: closedCount, closedAfter: SessionStore.getClosedTabCountForWindow(owner),
      closedTabs: SessionStore.getClosedTabDataForWindow(owner).map(item => ({ closedId: item.closedId,
        empty: item.state?.attributes?.[marker], urls: item.state?.entries?.map(entry => entry.url) })) };
    (report.repeatEmptyClose ??= []).push(repeatClose);
    const diagnostic = JSON.stringify(repeatClose);
    assert(repeatClose.sameBacking && repeatClose.originalAttached && !repeatClose.originalClosing,
      `Cmd-W on an already empty workspace replaced its backing identity: ${diagnostic}`);
    assert(repeatClose.countAfter === emptyCount && repeatClose.selectedEmpty && repeatClose.rows === 0,
      `Cmd-W on an already empty workspace changed its tab count or visible state: ${diagnostic}`);
    assert(repeatClose.closedAfter === closedCount && !repeatClose.closedTabs.some(item => item.empty === "true"),
      `Cmd-W on an already empty workspace manufactured undo history: ${diagnostic}`);
    assertOtherWorkspaces();
    const count = browser.tabs.length;
    await begin(owner);
    await typeAndSettle(owner, `${label} uncommitted empty draft`);
    assert(rows().length === 0 && browser.tabs.length === count && browser.selectedTab === backing,
      "Empty workspace draft materialized a visible or additional native tab before submit");
    await new Promise(resolve => owner.requestAnimationFrame(() => owner.requestAnimationFrame(resolve)));
    await key(owner, `capture-${label}-draft`);
    await key(owner, "escape");
    await wait(() => !owner.FluxionNewTab.pending && rows().length === 0 && !owner.gURLBar.focused &&
      owner.document.activeElement !== owner.gURLBar.inputField,
    "Escape did not return focus from the address draft to the empty workspace");
    assert(browser.tabs.length === count && browser.selectedTab === backing && empty.isPlaceholder(backing),
      "Canceling empty workspace draft changed its backing identity or allocated a tab");
    assertOtherWorkspaces();

    async function submitEmpty(value, url) {
      const before = browser.tabs.length, placeholder = browser.selectedTab;
      assert(empty.isPlaceholder(placeholder), "Commit fixture lost its empty workspace");
      await begin(owner); await typeAndSettle(owner, value);
      assert(browser.tabs.length === before && rows().length === 0, "Typing allocated a tab in an empty workspace");
      await key(owner, "return");
      const committed = await wait(() => browser.selectedBrowser.currentURI.spec === url && !browser.selectedTab.hasAttribute("busy") &&
        rows().length === 1 && rows()[0]._fluxionTab === browser.selectedTab && browser.selectedTab,
      "Empty workspace submission did not produce exactly one real visible tab");
      assert(browser.tabs.length === before && committed === placeholder && !empty.isPlaceholder(committed) &&
        !owner.FluxionNewTab.pending && !owner.document.documentElement.hasAttribute("data-fluxion-empty-workspace") &&
        ui.tabWorkspace(committed) === workspace.id,
      "Empty workspace submission failed to promote exactly its inert backing tab");
      assert(JSON.parse(SessionStore.getTabState(committed)).attributes?.[marker] !== "true",
        "Committed real page still carries empty identity in native session state");
      assertOtherWorkspaces();
      if (privateMode) assert(committed.linkedBrowser.contentPrincipal.originAttributes.privateBrowsingId === 1,
        "Empty workspace promotion crossed the private browsing boundary");
      return committed;
    }
    const url = `${origin}/page?case=${label}-empty-commit`;
    const committed = await submitEmpty(url, url);
    backing = await closeToEmpty(committed);
    const words = `fluxion ${label} empty post proof`;
    const searched = await submitEmpty(words, `${searchOrigin}/search`);
    const requests = (await (await window.fetch(`${origin}/state`, { cache: "no-store" })).json()).requests;
    assert(requests.filter(request => request.path === "/search" && request.method === "POST" &&
      new URLSearchParams(request.body).get("q") === words).length === 1, "Empty workspace search lost or duplicated its native POST body");
    const explicit = browser.addTrustedTab("about:blank", { skipAnimation: true });
    ui.setTabWorkspace(explicit, workspace.id); ui.selectTab(explicit);
    await wait(() => rows().length === 2 && rows().some(row => row._fluxionTab === explicit),
      "User-created about:blank was incorrectly hidden as an empty-workspace placeholder");
    assert(!empty.isPlaceholder(explicit), "Ordinary explicit about:blank acquired an internal placeholder marker");
    await key(owner, "close");
    await wait(() => !explicit.parentNode && rows().length === 1 && rows()[0]._fluxionTab === searched,
      "Closing explicit blank page did not retain the workspace's real search tab");
    assertOtherWorkspaces();
    report.checks.push(`${label}-native-last-workspace-cmd-w-keeps-window-and-other-workspaces-empty-cancel-and-url-post-promotion`);
    report.checks.push(`${label}-native-session-marker-only-for-backing-page-explicit-about-blank-remains-visible`);
  }
  async function run() {
    assert(driver === PathUtils.join(PathUtils.parent(PathUtils.profileDir), "driver") && /^http:\/\/127\.0\.0\.1:\d+$/.test(origin),
      "New Tab native fixture must use an isolated loopback profile");
    await SessionStore.promiseAllWindowsRestored;
    await wait(() => window.FluxionNewTab && window.FluxionUI, "Deferred New Tab did not initialize");
    Services.prefs.setBoolPref("browser.search.suggest.enabled", false);
    // Gecko's engine-domain matcher expects a public suffix, and throws for an
    // IP-address engine URL. Map a reserved example hostname inside this owned
    // test profile, leaving the product's search/DNS/security policies intact.
    const engineHost = "fluxion-new-tab.example.com";
    const searchOrigin = `http://${engineHost}:${new URL(origin).port}`;
    Services.prefs.setStringPref("network.dns.localDomains", engineHost);
    const bypass = Services.prefs.getStringPref("network.proxy.no_proxies_on", "");
    Services.prefs.setStringPref("network.proxy.no_proxies_on", [bypass, engineHost].filter(Boolean).join(","));
    const addresses = await new Promise((resolve, reject) => {
      Services.dns.asyncResolve(engineHost, Ci.nsIDNSService.RESOLVE_TYPE_DEFAULT,
        Ci.nsIDNSService.RESOLVE_DISABLE_IPV6 | Ci.nsIDNSService.RESOLVE_DISABLE_TRR | Ci.nsIDNSService.RESOLVE_BYPASS_CACHE,
        null, { onLookupComplete(_request, record, status) {
          if (!Components.isSuccessCode(status)) { reject(Error(`Fixture DNS failed: ${status}`)); return; }
          const result = [];
          const addresses = record.QueryInterface(Ci.nsIDNSAddrRecord);
          while (addresses.hasMore()) result.push(addresses.getNextAddrAsString());
          resolve(result);
        } }, null, {});
    });
    assert(addresses.length > 0 && addresses.every(address => address === "127.0.0.1"), "Fixture engine hostname did not resolve exclusively to loopback");
    report.engineFixture = { origin: searchOrigin, addresses };
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
    await commit(window, searchSource, "fluxion native post proof", `${searchOrigin}/search`);
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

    await verifyEmptyWorkspace(window, searchOrigin, false);

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
    await verifyEmptyWorkspace(privateWindow, searchOrigin, true);
    // Recheck after subsequent actual network loads and native commands, rather
    // than treating the synchronous load dispatch as script-completion proof.
    unchanged(window, scriptSource);
    assert(scriptSource.browser.contentTitle === scriptSource.title && !window.document.documentElement.hasAttribute("data-fluxion-script-probe") &&
      !scriptTarget.linkedBrowser.contentPrincipal.isSystemPrincipal, "JavaScript draft later escaped its non-system target");
    report.checks.push("native-javascript-load-keeps-original-title-and-non-system-target-through-remaining-gate");
    assert(report.keys.some(event => event.command && event.key.toLowerCase() === "t") && report.keys.some(event => event.key === "Enter") &&
      report.keys.some(event => event.key === "Escape") && report.keys.some(event => event.command && event.key.toLowerCase() === "w"),
    "Required native input was not observed");
  }
  run().then(() => Services.prefs.setStringPref(`${prefix}.health`, "native-deferred-new-tab-verified"))
    .catch(error => {
      report.failure = [window, privateWindow].filter(owner => owner && !owner.closed).map(owner => ({
        private: owner === privateWindow, active: Services.focus.activeWindow === owner,
        tabs: owner.gBrowser?.tabs.length, url: owner.gBrowser?.selectedBrowser.currentURI.spec,
        typed: owner.gBrowser?.selectedBrowser.userTypedValue, field: owner.gURLBar?.value,
        pending: owner.FluxionNewTab?.pending, suggestions: owner.gURLBar?.view.isOpen,
        empty: owner.FluxionEmptyWorkspace?.isPlaceholder(owner.gBrowser?.selectedTab),
        emptySurface: owner.document.documentElement.hasAttribute("data-fluxion-empty-workspace"),
        workspace: owner.FluxionUI?.currentWorkspace(),
        rows: [...owner.document.querySelectorAll("#fluxion-flow .fluxion-tab")].map(row => ({
          url: row._fluxionTab?.linkedBrowser.currentURI.spec,
          workspace: row._fluxionTab ? owner.FluxionUI?.tabWorkspace(row._fluxionTab) : null,
        })),
        focused: owner.document.activeElement?.id || owner.document.activeElement?.localName,
      }));
      Services.prefs.setStringPref(`${prefix}.error`, `${error.message}\n${error.stack || ""}`); Cu.reportError(error);
    })
    .finally(() => {
      if (privateWindow && !privateWindow.closed) privateWindow.close();
      Services.prefs.setStringPref(`${prefix}.report`, JSON.stringify(report)); Services.prefs.savePrefFile(null);
    });
})(window);
