/* global Services, SessionStore, IOUtils, PathUtils, Cu */
(function verifyDuplicateTabs(window) {
  "use strict";
  if (Services.env.get("FLUXION_DUPLICATE_TABS_TEST") !== "1") return;
  const prefix = "fluxion.duplicateTabs.verification";
  if (Services.prefs.getBoolPref(`${prefix}.claimed`, false)) return;
  Services.prefs.setBoolPref(`${prefix}.claimed`, true);
  const { document, gBrowser } = window;
  const driver = Services.env.get("FLUXION_DUPLICATE_TABS_DRIVER_DIR");
  const origin = Services.env.get("FLUXION_DUPLICATE_TABS_ORIGIN");
  const report = { input: "System Events native context menu and reopen; Gecko widget prompt controls", checks: [], prompts: [], menuEvents: [], readiness: [], keys: [] };
  const assert = (condition, message) => { if (!condition) throw Error(message); };
  const stage = value => { Services.prefs.setStringPref(`${prefix}.stage`, value); Services.prefs.savePrefFile(null); };
  const wait = async (check, message, timeout = 20000) => {
    const end = Date.now() + timeout;
    do { const value = await check(); if (value) return value; await new Promise(resolve => window.setTimeout(resolve, 40)); } while (Date.now() < end);
    throw Error(message);
  };
  let sequence = 0;
  async function key(action) {
    if (!["activate", "return"].includes(action)) {
      assert(Services.focus.activeWindow === window, "Native duplicate key lost the owned foreground window");
    }
    assert(["activate", "open", "down", "return", "escape", "reopen"].includes(action) && ++sequence <= 160,
      "Unbounded or unknown native keyboard request");
    const name = `${sequence}-${action}`;
    await IOUtils.writeUTF8(PathUtils.join(driver, `${name}.ready`), "ready");
    await wait(() => IOUtils.exists(PathUtils.join(driver, `${name}.sent`)), `Native driver did not acknowledge ${name}`);
  }
  async function capture(name) {
    await IOUtils.writeUTF8(PathUtils.join(driver, `${name}.ready`), "ready");
    await wait(() => IOUtils.exists(PathUtils.join(driver, `${name}.sent`)), `Native capture not acknowledged: ${name}`);
  }
  function clickWidget(owner, node) {
    const rect = node.getBoundingClientRect();
    assert(node.isConnected && !node.disabled && rect.width > 0 && rect.height > 0, "Native widget target is unavailable");
    for (const type of ["mousemove", "mousedown", "mouseup"]) {
      owner.synthesizeMouseEvent(type, rect.x + rect.width / 2, rect.y + rect.height / 2, {
        identifier: owner.windowUtils.DEFAULT_MOUSE_POINTER_ID, button: 0,
        buttons: type === "mousedown" ? 1 : 0, clickCount: type === "mousemove" ? 0 : 1,
        modifiers: 0, inputSource: owner.MouseEvent.MOZ_SOURCE_MOUSE,
      }, { isDOMEventSynthesized: true, isWidgetEventSynthesized: false, isAsyncEnabled: false, toWindow: true });
    }
  }
  function promptHandler({ cancel = false, mutate = null, beforeUnload = false } = {}) {
    let resolve, reject, handled = 0, disposed = false;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    // Attach a rejection sink immediately: a synchronous prompt spins Gecko's
    // nested event loop before the menu-key promise can return to its caller.
    promise.catch(() => {});
    const timer = window.setTimeout(() => finish(Error("Expected native duplicate confirmation did not complete")), 25000);
    const finish = error => {
      if (disposed) return;
      disposed = true; window.clearTimeout(timer); Services.obs.removeObserver(observer, "common-dialog-loaded");
      if (error) reject(error); else resolve();
    };
    const observer = { observe(subject) {
      if (disposed || subject.opener !== window) return;
      const dialog = subject.Dialog;
      if (!dialog?.ui || !dialog.args) return;
      const title = dialog.args.title || "";
      const cleanupPrompt = title === "Close Duplicate Tabs";
      if ((handled === 0 && !cleanupPrompt) || (handled > 0 && (!beforeUnload || cleanupPrompt))) {
        finish(Error(`Unexpected owned prompt left untouched: ${title}`)); return;
      }
      handled++;
      const entry = { title, promptType: dialog.args.promptType, cleanup: cleanupPrompt };
      report.prompts.push(entry);
      (async () => {
        await wait(() => dialog.ui.button0?.getBoundingClientRect().height > 0 && !dialog.ui.button0.disabled &&
          dialog.ui.button1?.getBoundingClientRect().height > 0 && !dialog.ui.button1.disabled, "Prompt buttons did not become ready");
        if (cleanupPrompt) {
          assert(dialog.ui.button1.label === "Cancel" || dialog.ui.button1.getAttribute("label") === "Cancel", "Cleanup Cancel button missing");
          entry.defaultButton = dialog.args.defaultButtonNum;
          assert(dialog.args.defaultButtonNum === 1, "Cleanup must default to Cancel");
          if (report.prompts.length === 1) await capture("capture-duplicate-confirmation");
          if (mutate) await mutate();
          if (cancel) await key("return"); else clickWidget(subject, dialog.ui.button0);
        } else {
          // The page itself installed a real beforeunload handler after trusted
          // input; cancel its actual Gecko leave-page dialog, not a test stub.
          clickWidget(subject, dialog.ui.button1);
        }
        if (!beforeUnload || !cleanupPrompt) finish();
      })().catch(finish);
    } };
    Services.obs.addObserver(observer, "common-dialog-loaded");
    return { promise, dispose() { finish(Error("Native prompt verification disposed before completion")); } };
  }
  async function run() {
    assert(driver === PathUtils.join(PathUtils.parent(PathUtils.profileDir), "driver") &&
      /^http:\/\/127\.0\.0\.1:\d+$/.test(origin), "Duplicate fixture must use an isolated loopback profile");
    await SessionStore.promiseAllWindowsRestored;
    await wait(() => window.FluxionDuplicateTabs?.available && window.FluxionUI, "Duplicate cleanup did not initialize");
    const ui = window.FluxionUI;
    await key("activate");
    await wait(() => document.hasFocus() && Services.focus.activeWindow === window, "Duplicate fixture did not gain foreground");
    ui.setSidebarState("expanded");
    const workspace = ui.currentWorkspace(), other = ui.createWorkspace("Archive", { activate: false });
    assert(other && other.id !== workspace, "Fixture requires a distinct hidden workspace");
    const popup = document.getElementById("fluxion-tab-context"), item = document.getElementById("fluxion-close-duplicate-tabs");
    assert(item?.parentNode === popup, "Duplicate cleanup must be a native top-level tab action");
    let active = null, commands = 0;
    const describe = node => node ? { id: node.id || "", name: node.localName,
      className: typeof node.className === "string" ? node.className : "",
      tabIndex: node._fluxionTab ? [...gBrowser.tabs].indexOf(node._fluxionTab) : null } : null;
    document.addEventListener("keydown", event => {
      if (report.keys.length < 200 && event.isTrusted && ["F10", "ArrowDown", "Enter", "Escape", "T", "t"].includes(event.key)) {
        report.keys.push({ key: event.key, shift: event.shiftKey, command: event.metaKey,
          target: describe(event.target), focused: describe(document.activeElement), popup: popup.state });
      }
    }, true);
    popup.addEventListener("DOMMenuItemActive", event => {
      if (event.isTrusted && event.target.parentNode === popup) {
        active = event.target; report.menuEvents.push({ label: active.getAttribute("label"), trusted: true });
      }
    });
    item.addEventListener("command", event => { assert(event.isTrusted, "Duplicate action was not a native command"); commands++; });
    const live = tab => tab?.parentNode && !tab.closing && [...gBrowser.tabs].includes(tab);
    const create = async (url, { userContextId = 0, workspaceId = workspace, pinned = false } = {}) => {
      const tab = gBrowser.addTrustedTab(url, { userContextId, skipAnimation: true });
      ui.setTabWorkspace(tab, workspaceId);
      await wait(() => tab.linkedBrowser.currentURI.spec === url && !tab.hasAttribute("busy"), "Duplicate fixture failed to load");
      if (pinned) gBrowser.pinTab(tab);
      return tab;
    };
    const invoke = async (tab, expectedCount, options = {}) => {
      stage(options.beforeUnload ? "beforeunload" : options.mutate ? "stale-modal" : options.cancel ? "cancel" : "close");
      // Selecting a native page queues Flow's projection and Gecko focus work.
      // Wait for the actual selected-row state and frame boundary before
      // choosing the keyboard anchor; an existing row alone is not readiness.
      let frames = 0;
      const frame = () => { if (++frames < 2) window.requestAnimationFrame(frame); };
      window.requestAnimationFrame(frame);
      await wait(() => frames >= 2 && [...document.querySelectorAll(".fluxion-tab")].some(node =>
        node._fluxionTab === gBrowser.selectedTab && node.dataset.active === "true"), "Selected Flow projection did not settle");
      const row = await wait(() => [...document.querySelectorAll(".fluxion-tab")].find(node => node._fluxionTab === tab), "Missing duplicate context row");
      row.scrollIntoView({ block: "nearest", behavior: "instant" }); row.focus({ preventScroll: true });
      const readiness = { before: null, after: null };
      const state = () => ({ focused: describe(document.activeElement), expected: describe(row), connected: row.isConnected,
        rect: row.getBoundingClientRect().toJSON(), sidebar: document.getElementById("fluxion-flow")?.dataset.state,
        documentFocus: document.hasFocus(), ownedActiveWindow: Services.focus.activeWindow === window,
        popup: popup.state, selectedTabIndex: [...gBrowser.tabs].indexOf(gBrowser.selectedTab) });
      report.readiness.push(readiness);
      readiness.before = state();
      assert(row.isConnected && document.activeElement === row && document.hasFocus() && Services.focus.activeWindow === window,
        "Context row did not receive foreground keyboard focus");
      active = null; await key("open");
      try { await wait(() => popup.state === "open", "Native duplicate menu did not open"); }
      finally { readiness.after = state(); }
      assert(popup.isNativeMenu, "Duplicate gate requires actual macOS native menu");
      assert(!item.disabled && item.getAttribute("label") === `Close ${expectedCount} Duplicate Tab${expectedCount === 1 ? "" : "s"}…`,
        `Unexpected cleanup count: ${item.getAttribute("label")}`);
      if (!active) { await key("down"); await wait(() => active, "No trusted native leaf selected"); }
      const leaves = [...popup.children].filter(node => ["menu", "menuitem"].includes(node.localName) &&
        !node.hidden && !node.disabled && window.getComputedStyle(node).display !== "none" && window.getComputedStyle(node).visibility !== "collapse");
      const from = leaves.indexOf(active), target = leaves.indexOf(item);
      assert(from >= 0 && target >= from && target - from <= 40, "Duplicate native navigation is unbounded");
      for (let index = from; index < target; index++) await key("down");
      await wait(() => active === item, "Duplicate action did not receive native selection");
      if (commands === 0) await capture("capture-duplicate-menu");
      const handler = promptHandler(options), before = commands;
      try {
        await key("return");
        await handler.promise;
        await wait(() => commands === before + 1 && popup.state === "closed", "Duplicate command did not complete exactly once");
      } finally { handler.dispose(); }
    };
    const url = `${origin}/page?case=shared#exact`;
    const selected = await create(url, { userContextId: 1 }), duplicate = await create(url, { userContextId: 1 });
    const pinned = await create(url, { pinned: true, userContextId: 1 });
    const container = await create(url, { userContextId: 2 });
    const hidden = await create(url, { workspaceId: other.id, userContextId: 1 });
    const query = await create(`${origin}/page?case=different#exact`, { userContextId: 1 });
    const fragment = await create(`${origin}/page?case=shared#different`, { userContextId: 1 });
    const context = await create(url, { userContextId: 1 });
    ui.selectTab(selected);
    await wait(() => !gBrowser.selectedTab.hasAttribute("busy"), "Selection still loading");
    const before = [...gBrowser.tabs];
    await invoke(context, 1, { cancel: true });
    assert(before.length === gBrowser.tabs.length && before.every(live), "Default Cancel changed tabs");
    report.checks.push("native-confirmation-default-cancel-preserves-all-tabs");
    await invoke(context, 1);
    await wait(() => !live(duplicate), "Eligible exact duplicate did not close");
    assert([selected, pinned, container, hidden, query, fragment, context].every(live) && gBrowser.selectedTab === selected,
      "Cleanup lost a protected/context tab or crossed a URL/container/workspace boundary");
    report.checks.push("native-command-exact-url-container-workspace-and-selected-pinned-context-boundaries");
    const closedCount = gBrowser.tabs.length;
    await key("reopen");
    const reopened = await wait(() => gBrowser.tabs.length === closedCount + 1 && gBrowser.selectedTab !== selected &&
      gBrowser.selectedTab.linkedBrowser.currentURI.spec === url && gBrowser.selectedTab, "Cmd-Shift-T did not restore cleaned tab");
    assert(ui.tabWorkspace(reopened) === workspace && Number(reopened.getAttribute("usercontextid") || 0) === 1,
      "Native reopen lost workspace/container metadata");
    report.checks.push("native-cmd-shift-t-restores-cleaned-tab-and-workspace");
    // Restored tab is protected while selected. Changing a candidate's URL
    // during the real confirmation invalidates the whole captured cleanup.
    const stale = await create(`${origin}/page?case=stale`), staleDuplicate = await create(`${origin}/page?case=stale`);
    ui.selectTab(selected);
    // Remove only fixture-owned reopened duplicate, avoiding another eligible
    // group in the stale-menu test. Native session undo was already verified.
    gBrowser.removeTab(reopened, { animate: false, skipSessionStore: true });
    await wait(() => !live(reopened), "Restored fixture did not retire");
    const staleBefore = [...gBrowser.tabs];
    await invoke(context, 1, { mutate: async () => {
      staleDuplicate.linkedBrowser.loadURI(Services.io.newURI(`${origin}/page?case=changed`), {
        triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
      });
      await wait(() => staleDuplicate.linkedBrowser.currentURI.spec === `${origin}/page?case=changed` && !staleDuplicate.hasAttribute("busy"),
        "Modal-time navigation did not commit");
    } });
    assert(staleBefore.length === gBrowser.tabs.length && staleBefore.every(live), "Stale confirmation closed changed or unrelated tabs");
    report.checks.push("modal-time-navigation-invalidates-whole-plan-without-retargeting");
    const unloadURL = `${origin}/page?case=beforeunload`;
    const survivor = await create(unloadURL), armed = await create(unloadURL);
    ui.selectTab(armed);
    await wait(() => armed.linkedBrowser.getBoundingClientRect().height > 100 && Services.focus.activeWindow === window,
      "Beforeunload page is not visible");
    clickWidget(window, armed.linkedBrowser);
    const serverState = async () => (await window.fetch(`${origin}/state`)).json();
    await wait(async () => (await serverState()).armed === 1, "Trusted page activation did not arm beforeunload");
    ui.selectTab(selected);
    await invoke(context, 1, { beforeUnload: true });
    await wait(async () => (await serverState()).unload >= 1, "Actual beforeunload handler did not execute");
    assert(live(armed) && live(survivor), "Canceling real leave-page prompt failed to preserve duplicate");
    report.checks.push("trusted-page-beforeunload-cancel-preserves-page-through-native-close-path");
    assert(live(stale), "Unrelated stale-group survivor vanished");
  }
  run().then(() => Services.prefs.setStringPref(`${prefix}.health`, "native-duplicate-cleanup-verified"))
    .catch(async error => {
      stage("failure-capture");
      try { await capture("capture-duplicate-failure"); }
      catch (captureError) { report.captureError = String(captureError); }
      Services.prefs.setStringPref(`${prefix}.error`, `${error.message}\n${error.stack || ""}`); Cu.reportError(error);
    })
    .finally(() => { Services.prefs.setStringPref(`${prefix}.report`, JSON.stringify(report)); Services.prefs.savePrefFile(null); });
})(window);
