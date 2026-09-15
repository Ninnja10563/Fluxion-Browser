/* global Services, SessionStore, PathUtils, IOUtils, Ci, Cu */
(function verifyFluxionFrame(window) {
  "use strict";
  if (Services.env.get("FLUXION_FRAME_TEST") !== "1") return;
  const prefix = "fluxion.frame.verification";
  if (Services.prefs.getBoolPref(`${prefix}.claimed`, false)) return;
  Services.prefs.setBoolPref(`${prefix}.claimed`, true);
  const { document, gBrowser } = window;
  const driver = Services.env.get("FLUXION_FRAME_DRIVER_DIR");
  const report = {
    keyboard: "native macOS System Events Cmd-W and Cmd-Shift-T",
    pointer: "Gecko Window.synthesizeMouseEvent input routing; no OS pointer movement claimed",
    fullscreenTested: false, checks: [], captures: [], geometry: [], keys: [],
  };
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const delay = ms => new Promise(resolve => window.setTimeout(resolve, ms));
  const wait = async (condition, message, timeout = 10000) => {
    const deadline = Date.now() + timeout;
    while (!(await condition())) { assert(Date.now() < deadline, message); await delay(50); }
  };
  const near = (a, b) => Math.abs(a - b) < 1.5;
  const rect = node => {
    const r = node.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
  };
  const rows = () => [...document.querySelectorAll(".fluxion-tab")];
  const rowFor = tab => rows().find(row => row._fluxionTab === tab);
  const liveTabs = () => [...gBrowser.tabs].filter(tab => !tab.closing);
  let pointerMoves = 0;
  const diagnosticListeners = [];
  const onPointerMove = () => { pointerMoves++; };
  const onKey = event => {
    if (event.metaKey && ["w", "t"].includes(event.key?.toLowerCase())) {
      report.keys.push({ key: event.key, meta: event.metaKey, shift: event.shiftKey,
        alt: event.altKey, control: event.ctrlKey, repeat: event.repeat, trusted: event.isTrusted });
    }
  };
  const stage = value => {
    Services.prefs.setStringPref(`${prefix}.stage`, value);
    Services.prefs.savePrefFile(null);
  };
  async function action(name) {
    await IOUtils.writeUTF8(PathUtils.join(driver, `${name}.ready`), "ready");
    await wait(() => IOUtils.exists(PathUtils.join(driver, `${name}.sent`)), `Native driver did not acknowledge ${name}`, 20000);
  }
  async function run() {
    assert(/\/fluxion-frame-check\.[^/]+\/profile\/?$/.test(PathUtils.profileDir), "Frame fixture requires an isolated profile");
    assert(driver === PathUtils.parent(PathUtils.profileDir), "Frame driver must belong to the isolated profile");
    Services.prefs.setBoolPref("browser.tabs.warnOnClose", false);
    Services.prefs.setBoolPref("browser.warnOnQuit", false);
    await SessionStore.promiseAllWindowsRestored;
    await wait(() => window.FluxionUI && window.FluxionTheme && document.getElementById("fluxion-settings"), "Frame modules did not initialize");
    const ui = window.FluxionUI;
    const flow = document.getElementById("fluxion-flow");
    const browser = document.getElementById("browser");
    const deck = document.getElementById("tabbrowser-tabbox");
    ui.setSidebarState("expanded");
    window.FluxionSidebarWidth?.setWidth(232);
    await action("foreground");
    await wait(() => Services.focus.activeWindow === window, "Frame browser did not become the native foreground window");
    window.addEventListener("pointermove", onPointerMove, true);
    window.addEventListener("keydown", onKey, true);
    const add = url => {
      const tab = gBrowser.addTrustedTab(url, { skipAnimation: true });
      ui.setTabWorkspace(tab, ui.currentWorkspace());
      return tab;
    };
    const select = async tab => {
      ui.selectTab(tab);
      await wait(() => gBrowser.selectedTab === tab && rowFor(tab)?.getAttribute("aria-selected") === "true", "Selected native tab did not match its Flow row");
      rowFor(tab).focus();
      await wait(() => document.activeElement === rowFor(tab), "Flow row did not receive keyboard focus");
    };
    const survivor = add("about:blank?fluxion-frame=survivor");
    const closing = add("about:blank?fluxion-frame=keyboard-close");
    await select(closing);
    await wait(() => closing.linkedBrowser.currentURI.spec === "about:blank?fluxion-frame=keyboard-close" && !closing.hasAttribute("busy"),
      "Keyboard close fixture navigation did not settle");
    stage("ordinary-native-keyboard-close");
    const oldRow = rowFor(closing), before = liveTabs(), beforeMoves = pointerMoves;
    await action("close-ordinary");
    await wait(() => !closing.parentNode && !oldRow.isConnected && !rowFor(closing), "Cmd-W left the closed native tab's Flow row visible");
    assert(liveTabs().length === before.length - 1 && before.filter(tab => tab !== closing).every(tab => tab.parentNode && !tab.closing), "Cmd-W closed an unintended tab");
    assert(pointerMoves === beforeMoves, "Pointer moved during the stationary Cmd-W fixture");
    await action("restore-ordinary");
    await wait(() => liveTabs().length === before.length && gBrowser.selectedBrowser.currentURI.spec === "about:blank?fluxion-frame=keyboard-close" && rowFor(gBrowser.selectedTab)?.isConnected,
      "Cmd-Shift-T did not restore the closed native tab and Flow row");
    report.checks.push("stationary-native-cmd-w-removes-row-and-cmd-shift-t-restores");

    stage("native-keyboard-close-after-pointer-hold");
    const pointerTab = add("about:blank?fluxion-frame=pointer-close");
    const following = add("about:blank?fluxion-frame=following");
    await select(pointerTab);
    rowFor(following).scrollIntoView({ block: "nearest" });
    await delay(250);
    const pointerRow = rowFor(pointerTab), nextRow = rowFor(following);
    const close = pointerRow.querySelector(".fluxion-close"), closeRect = rect(close);
    assert(closeRect.width > 0 && closeRect.height > 0, "Pointer close control has no hit area");
    const x = closeRect.left + closeRect.width / 2, y = closeRect.top + closeRect.height / 2;
    const nextTop = rect(nextRow).top;
    report.pointerHoldEvents = [];
    const observe = (target, type, options) => {
      const listener = event => {
        if (report.pointerHoldEvents.length >= 80) return;
        report.pointerHoldEvents.push({ type, target: event.target?.id || event.target?.className || event.target?.localName || "window",
          trusted: event.isTrusted, detail: event.detail, x: event.clientX, y: event.clientY,
          related: event.relatedTarget?.id || event.relatedTarget?.className || event.relatedTarget?.localName || "",
          active: document.activeElement?.id || document.activeElement?.className || document.activeElement?.localName,
          activeLocalName: document.activeElement?.localName, activeWindow: Services.focus.activeWindow === window,
          targetIsWindow: event.target === window,
          rowConnected: pointerRow.isConnected, rowClass: pointerRow.className, nextTop: rect(nextRow).top,
          at: window.performance.now() });
      };
      target.addEventListener(type, listener, options);
      diagnosticListeners.push(() => target.removeEventListener(type, listener, options));
    };
    observe(close, "click", true);
    observe(flow, "pointerleave", false);
    observe(flow.querySelector(".fluxion-tabs:not(.fluxion-pinned-tabs)"), "scroll", { passive: true });
    observe(window, "blur", false);
    report.pointerHoldStart = { closeRect, nextTop, flow: rect(flow), x, y };
    assert(typeof window.synthesizeMouseEvent === "function", "Gecko native widget input router is unavailable");
    const mouse = (type, buttons) => window.synthesizeMouseEvent(type, x, y, {
      identifier: window.windowUtils.DEFAULT_MOUSE_POINTER_ID, button: 0, buttons,
      clickCount: type === "mousemove" ? 0 : 1, modifiers: 0, inputSource: window.MouseEvent.MOZ_SOURCE_MOUSE,
    }, { isDOMEventSynthesized: true, isWidgetEventSynthesized: false, isAsyncEnabled: false, toWindow: true });
    mouse("mousemove", 0); mouse("mousedown", 1); mouse("mouseup", 0);
    report.pointerHoldAfterClick = { connected: pointerRow.isConnected, className: pointerRow.className,
      nextTop: rect(nextRow).top, nativeConnected: Boolean(pointerTab.parentNode) };
    await wait(() => !pointerTab.parentNode, "Routed pointer close did not close its native tab");
    report.pointerHoldAfterNativeClose = { connected: pointerRow.isConnected, className: pointerRow.className,
      nextConnected: nextRow.isConnected, nextTop: rect(nextRow).top, initialNextTop: nextTop, pointerMoves };
    assert(pointerRow.isConnected && pointerRow.classList.contains("is-closing") && near(rect(nextRow).top, nextTop),
      `Pointer close did not retain its stationary safety space: ${JSON.stringify(report.pointerHoldAfterNativeClose)}`);
    await delay(100);
    const heldMoves = pointerMoves;
    const keyboardTab = gBrowser.selectedTab;
    assert(keyboardTab !== pointerTab && keyboardTab.parentNode, "Pointer closure did not select a surviving tab");
    const keyboardRow = rowFor(keyboardTab), heldBefore = liveTabs();
    assert(keyboardRow, "Selected surviving tab has no Flow row");
    keyboardRow.focus();
    await action("close-after-pointer");
    await wait(() => !keyboardTab.parentNode && !keyboardRow.isConnected && !pointerRow.isConnected,
      "Cmd-W after pointer close left deferred closed rows visible");
    assert(pointerMoves === heldMoves, "Pointer moved during the pointer-hold keyboard fixture");
    assert(liveTabs().length === heldBefore.length - 1 && heldBefore.filter(tab => tab !== keyboardTab).every(tab => tab.parentNode && !tab.closing), "Keyboard close after pointer hold closed an extra tab");
    assert(survivor.parentNode, "The protected survivor was unexpectedly closed");
    const trustedCommand = key => key.trusted && key.meta && !key.alt && !key.control && !key.repeat;
    const closes = report.keys.filter(key => key.key.toLowerCase() === "w" && !key.shift && trustedCommand(key));
    const restores = report.keys.filter(key => key.key.toLowerCase() === "t" && key.shift && trustedCommand(key));
    assert(report.keys.length === 3 && closes.length === 2 && restores.length === 1,
      `Native keyboard event evidence is incomplete or contains extra commands: ${JSON.stringify(report.keys)}`);
    report.nativeKeyCounts = { close: closes.length, restore: restores.length, total: report.keys.length };
    report.checks.push("pointer-close-hold-preserved-until-native-keyboard-close-with-no-pointer-motion");

    stage("real-page-and-frame-geometry");
    const webpage = add("https://example.org/");
    await select(webpage);
    await wait(() => webpage.linkedBrowser.currentURI.spec === "https://example.org/" && !webpage.hasAttribute("busy") && webpage.label === "Example Domain",
      "Real HTTPS example.org page did not finish loading", 35000);
    const gap = mode => {
      const outer = rect(browser), sidebar = rect(flow), page = rect(deck);
      const values = { start: page.left - sidebar.right, end: outer.right - page.right,
        top: page.top - outer.top, bottom: outer.bottom - page.bottom };
      assert(Object.values(values).every(value => near(value, 4)), `Frame inset is not a consistent four pixels in ${mode}: ${JSON.stringify(values)}`);
      assert(page.width > 200 && page.height > 100, "Frame squeezed the page below a usable size");
      report.geometry.push({ mode, outer, sidebar, page, gaps: values });
    };
    const workspaceControls = (mode, visible) => {
      const list = flow.querySelector(".fluxion-workspace-list");
      const orientation = mode === "compact" ? "vertical" : "horizontal";
      assert(list?.getAttribute("aria-orientation") === orientation &&
        window.getComputedStyle(list).flexDirection === (mode === "compact" ? "column" : "row"),
      `Workspace keyboard orientation disagrees with its visible ${mode} layout`);
      const button = flow.querySelector(".fluxion-workspaces > .fluxion-icon-button");
      const label = { expanded: "Collapse sidebar to icons", compact: "Hide sidebar", focus: "Expand sidebar" }[mode];
      assert(button?.getAttribute("aria-label") === label && button.title.startsWith(`${label} (`),
        `Sidebar toggle lacks its actionable ${mode} accessible name or shortcut hint`);
      if (visible) {
        const box = rect(button), surface = rect(flow.querySelector(".fluxion-surface"));
        assert(box.width >= 24 && box.height >= 24 && box.left >= surface.left - 1 && box.right <= surface.right + 1 &&
          box.top >= surface.top - 1 && box.bottom <= surface.bottom + 1 &&
          button.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)),
        `Sidebar toggle is clipped, hidden, or has an insufficient hit area in ${mode}`);
        if (mode !== "compact") {
          for (const label of list.querySelectorAll(".fluxion-workspace-name")) {
            assert(label.scrollWidth <= label.clientWidth + 1,
              `Default workspace label is clipped in ${mode}: ${label.textContent}`);
          }
        }
      }
    };
    for (const [mode, expected] of [["expanded", 232], ["compact", 44], ["focus", 3]]) {
      ui.setSidebarState(mode);
      await wait(() => near(rect(flow).width, expected), `Sidebar ${mode} geometry did not settle`);
      await delay(200);
      gap(mode);
      workspaceControls(mode, mode !== "focus");
    }
    const pageBefore = rect(gBrowser.tabpanels);
    ui.revealSidebar({ focusActive: false });
    await wait(() => flow.dataset.revealed === "true", "Focus sidebar did not reveal");
    await delay(250);
    const pageAfter = rect(gBrowser.tabpanels);
    assert(["left", "top", "width", "height"].every(key => near(pageBefore[key], pageAfter[key])), "Focus reveal reflowed page content");
    workspaceControls("focus", true);
    ui.hideSidebar({ force: true }); ui.setSidebarState("expanded");
    await wait(() => near(rect(flow).width, 232), "Expanded sidebar did not return for captures");
    report.checks.push("expanded-compact-focus-consistent-insets-and-overlay-without-page-reflow");
    report.checks.push("workspace-orientation-and-visible-actionable-sidebar-toggle-in-each-mode");
    const capture = async (name, theme) => {
      await window.FluxionTheme.set(theme);
      await wait(() => document.documentElement.dataset.fluxionTheme === theme, "Capture theme did not settle");
      await delay(350);
      await action(name);
      report.captures.push({ name, theme, url: gBrowser.selectedBrowser.currentURI.spec, title: gBrowser.selectedTab.label });
    };
    await capture("capture-page-light", "light");
    await capture("capture-page-dark", "dark");
    const secondPage = add("https://example.com/");
    await wait(() => secondPage.linkedBrowser.currentURI.spec === "https://example.com/" &&
      !secondPage.hasAttribute("busy") && secondPage.label === "Example Domain",
    "Second real HTTPS page did not finish loading", 35000);
    const split = ui.createSplitView(webpage, secondPage);
    assert(split && webpage.splitview === split && secondPage.splitview === split && split.tabs.length === 2,
      "Real pages did not enter the same native split view");
    await wait(() => gBrowser.activeSplitView === split && split.panels.length === 2 &&
      Array.from(split.panels).every(panel => panel.classList.contains("split-view-panel-active") &&
        rect(panel).width > 100 && rect(panel).height > 100), "Both native split panels did not become visible");
    await delay(250);
    const [leftPane, rightPane] = Array.from(split.panels, rect);
    assert(rightPane.left >= leftPane.right && near(leftPane.top, rightPane.top), "Native side-by-side page panels overlap or are misaligned");
    report.geometry.push({ mode: "real-page-split", leftPane, rightPane,
      urls: Array.from(split.tabs, tab => tab.linkedBrowser.currentURI.spec) });
    await capture("capture-page-split", "dark");
    report.checks.push("two-real-https-pages-share-visible-nonoverlapping-native-split-panels");
    const settingsTab = add("about:preferences?fluxion=appearance");
    await select(settingsTab);
    const settings = document.getElementById("fluxion-settings");
    await wait(() => !settings.hidden && rect(settings).height > 100, "Settings surface did not open");
    const settingsRect = rect(settings), browserRect = rect(browser), flowRect = rect(flow);
    assert(near(settingsRect.left - flowRect.right, 4) && near(browserRect.right - settingsRect.right, 4) &&
      near(settingsRect.top - browserRect.top, 4) && near(browserRect.bottom - settingsRect.bottom, 4), "Settings inset does not match the page frame");
    assert(deck.hidden, "Settings left the underlying webpage deck visible");
    report.geometry.push({ mode: "settings", page: settingsRect });
    await capture("capture-settings", "light");
    const libraryTab = add("about:downloads#history");
    await select(libraryTab);
    const library = document.getElementById("fluxion-library");
    await wait(() => library && !library.hidden && settings.hidden && rect(library).height > 100, "Library surface did not replace Settings");
    const libraryRect = rect(library), libraryOuter = rect(browser), libraryFlow = rect(flow);
    assert(near(libraryRect.left - libraryFlow.right, 4) && near(libraryOuter.right - libraryRect.right, 4) &&
      near(libraryRect.top - libraryOuter.top, 4) && near(libraryOuter.bottom - libraryRect.bottom, 4), "Library inset does not match the page frame");
    assert(deck.hidden, "Library left the underlying webpage deck visible");
    report.geometry.push({ mode: "library", page: libraryRect });
    report.checks.push("settings-and-library-share-the-native-page-frame-boundary");
    report.checks.push("actual-light-dark-webpage-and-settings-captures");
  }
  run().then(() => Services.prefs.setStringPref(`${prefix}.health`, "native-frame-keyboard-close-and-captures-verified"))
    .catch(error => { Services.prefs.setStringPref(`${prefix}.error`, `${error.message}\n${error.stack}`); Cu.reportError(error); })
    .finally(async () => {
      window.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("keydown", onKey, true);
      for (const remove of diagnosticListeners) remove();
      report.pointerMoves = pointerMoves;
      Services.prefs.setStringPref(`${prefix}.report`, JSON.stringify(report));
      Services.prefs.savePrefFile(null);
      await delay(100);
      Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit);
    });
})(window);
