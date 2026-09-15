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
  const routePointer = (x, y, type = "mousemove", buttons = 0) => {
    assert(typeof window.synthesizeMouseEvent === "function", "Gecko native widget input router is unavailable");
    window.synthesizeMouseEvent(type, x, y, {
      identifier: window.windowUtils.DEFAULT_MOUSE_POINTER_ID, button: 0, buttons,
      clickCount: type === "mousemove" ? 0 : 1, modifiers: 0, inputSource: window.MouseEvent.MOZ_SOURCE_MOUSE,
    }, { isDOMEventSynthesized: true, isWidgetEventSynthesized: false, isAsyncEnabled: false, toWindow: true });
  };
  const clickControl = node => {
    const box = rect(node), x = box.left + box.width / 2, y = box.top + box.height / 2;
    assert(box.width >= 24 && box.height >= 24 && node.contains(document.elementFromPoint(x, y)), "Routed control is clipped or obscured");
    routePointer(x, y); routePointer(x, y, "mousedown", 1); routePointer(x, y, "mouseup", 0);
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
    observe(flow.querySelector(".fluxion-tab-scroll"), "scroll", { passive: true });
    observe(window, "blur", false);
    report.pointerHoldStart = { closeRect, nextTop, flow: rect(flow), x, y };
    const mouse = (type, buttons) => routePointer(x, y, type, buttons);
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
      const label = mode === "expanded" ? "Collapse sidebar" : "Expand sidebar";
      assert(button?.getAttribute("aria-label") === label && button.title.startsWith(`${label} (`),
        `Sidebar toggle lacks its actionable ${mode} accessible name or shortcut hint`);
      if (visible) {
        const box = rect(button), surface = rect(flow.querySelector(".fluxion-surface"));
        assert(box.width >= 24 && box.height >= 24 && box.left >= surface.left - 1 && box.right <= surface.right + 1 &&
          box.top >= surface.top - 1 && box.bottom <= surface.bottom + 1 &&
          button.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)),
        `Sidebar toggle is clipped, hidden, or has an insufficient hit area in ${mode}`);
        const dock = rect(flow.querySelector(".fluxion-workspaces"));
        assert(near(dock.bottom, surface.bottom), `Workspace dock is not anchored to the bottom in ${mode}`);
        for (const workspace of list.querySelectorAll(".fluxion-workspace")) {
          assert(workspace.getAttribute("aria-label") && workspace.querySelector("svg"), "Workspace symbol lost its accessible name or vector icon");
          for (const name of workspace.querySelectorAll(".fluxion-workspace-name")) {
            assert(window.getComputedStyle(name).display === "none" || rect(name).width === 0,
              `Workspace dock is not icon-only in ${mode}`);
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
    stage("routed-edge-hover-and-sidebar-toggle");
    report.hoverEvents = [];
    for (const type of ["pointerenter", "pointerleave"]) {
      const handler = event => report.hoverEvents.push({ type, trusted: event.isTrusted, x: event.clientX, y: event.clientY });
      flow.addEventListener(type, handler);
      diagnosticListeners.push(() => flow.removeEventListener(type, handler));
    }
    const surface = flow.querySelector(".fluxion-surface");
    const pageBefore = rect(gBrowser.tabpanels);
    const outside = { x: rect(deck).right - 20, y: rect(deck).top + 60 };
    // Move away before approaching the three-pixel edge so native hit testing,
    // not a direct call to revealSidebar(), owns every enter/leave transition.
    gBrowser.selectedBrowser.focus();
    routePointer(outside.x, outside.y);
    await delay(250);
    for (let cycle = 0; cycle < 3; cycle++) {
      const edge = rect(flow);
      routePointer(edge.left + edge.width / 2, edge.top + Math.min(140, edge.height / 2));
      await wait(() => flow.dataset.revealed === "true" && !surface.inert, `Edge hover did not reveal sidebar on cycle ${cycle}`);
      await delay(200);
      workspaceControls("focus", true);
      const pageAfter = rect(gBrowser.tabpanels);
      assert(["left", "top", "width", "height"].every(key => near(pageBefore[key], pageAfter[key])), "Routed edge reveal reflowed page content");
      if (cycle === 1) {
        const selected = rowFor(gBrowser.selectedTab);
        assert(selected, "Hover fixture lost the selected Flow row");
        clickControl(selected);
        await delay(100);
      }
      routePointer(outside.x, outside.y);
      await wait(() => flow.dataset.revealed === "false" && surface.inert, `Leaving the overlay did not hide sidebar on cycle ${cycle}`);
      await delay(200);
    }
    assert(report.hoverEvents.filter(event => event.type === "pointerenter" && event.trusted).length >= 3 &&
      report.hoverEvents.filter(event => event.type === "pointerleave" && event.trusted).length >= 3,
    "Repeated edge hover lacks trusted Gecko routed enter/leave evidence");
    const toggle = flow.querySelector(".fluxion-workspaces > .fluxion-icon-button");
    ui.setSidebarState("compact");
    await wait(() => near(rect(flow).width, 44), "Compact sidebar did not settle before its expand click");
    await delay(200);
    clickControl(toggle);
    await wait(() => flow.dataset.state === "expanded" && near(rect(flow).width, 232), "Clicking expand in Compact hid the sidebar instead");
    await delay(200);
    clickControl(toggle);
    await wait(() => flow.dataset.state === "focus" && near(rect(flow).width, 3), "Primary collapse did not leave the hover edge");
    routePointer(outside.x, outside.y); await delay(250);
    const edge = rect(flow);
    routePointer(edge.left + edge.width / 2, edge.top + 100);
    await wait(() => flow.dataset.revealed === "true" && !surface.inert, "Collapsed sidebar did not return after a real edge approach");
    await delay(200);
    clickControl(toggle);
    await wait(() => near(rect(flow).width, 232), "Expanded sidebar did not return for captures");
    assert(flow.dataset.state === "expanded" && !surface.inert, "Expand left the sidebar surface hidden or inert");
    report.checks.push("expanded-compact-focus-consistent-insets-and-overlay-without-page-reflow");
    report.checks.push("routed-pointer-edge-reveal-three-cycles-and-compact-expand-never-hides");
    report.checks.push("bottom-symbol-workspace-dock-with-accessible-toggle-in-each-mode");
    stage("inline-new-tab-and-scroll-stable-workspace-dock");
    const scrollArea = flow.querySelector(".fluxion-tab-scroll");
    const tabTree = flow.querySelector(".fluxion-tabs:not(.fluxion-pinned-tabs)");
    const newTab = flow.querySelector(".fluxion-new-tab");
    const dock = flow.querySelector(".fluxion-workspaces");
    assert(scrollArea && scrollArea.contains(tabTree) && scrollArea.contains(newTab) && !scrollArea.contains(dock),
      "Tab list and inline new-tab control do not share a scroll area separate from the dock");
    const inlineGap = rect(newTab).top - rect(tabTree).bottom;
    assert(inlineGap >= -1 && inlineGap <= 16, `New tab is not immediately below the last tab: ${inlineGap}px`);
    const dockBefore = rect(dock);
    const overflowTabs = Array.from({ length: Math.ceil(rect(scrollArea).height / 28) + 4 }, (_, index) =>
      add(`about:blank?fluxion-frame=overflow-${index}`));
    await wait(() => overflowTabs.every(tab => rowFor(tab)) && scrollArea.scrollHeight > scrollArea.clientHeight + 30,
      "Dense-tab fixture did not overflow its intended scroll area");
    newTab.scrollIntoView({ block: "nearest" }); await delay(200);
    const dockAfter = rect(dock), newTabRect = rect(newTab), lastRow = rect(rowFor(overflowTabs.at(-1)));
    assert(["left", "top", "width", "height"].every(key => near(dockBefore[key], dockAfter[key])), "Scrolling many tabs moved the workspace dock");
    assert(newTabRect.top >= lastRow.bottom - 1 && newTabRect.top - lastRow.bottom <= 24 &&
      newTabRect.bottom <= dockAfter.top + 1 && newTabRect.top >= rect(scrollArea).top - 1,
    "Inline new-tab control is not reachable immediately after the lowest tab when scrolling");
    assert(newTab.contains(document.elementFromPoint(newTabRect.left + newTabRect.width / 2, newTabRect.top + newTabRect.height / 2)),
      "Inline new-tab control is obscured at the end of a long tab list");
    const beforeNewTab = liveTabs();
    clickControl(newTab);
    await wait(() => liveTabs().length === beforeNewTab.length + 1 && !beforeNewTab.includes(gBrowser.selectedTab) &&
      rowFor(gBrowser.selectedTab)?.getAttribute("aria-selected") === "true",
    "Inline New tab did not create and select a real tab in the visible workspace");
    const createdTab = gBrowser.selectedTab;
    await select(webpage);
    gBrowser.removeTab(createdTab, { animate: false });
    gBrowser.removeTabs(overflowTabs, { animate: false });
    await wait(() => !createdTab.parentNode && !rowFor(createdTab) && overflowTabs.every(tab => !tab.parentNode && !rowFor(tab)),
      "Dense-tab fixture cleanup left stale Flow rows");
    scrollArea.scrollTop = 0; await delay(200);
    report.checks.push("inline-new-tab-follows-last-tab-and-bottom-workspace-dock-survives-scroll-overflow");
    stage("compact-dock-with-twelve-workspaces-in-short-window");
    const originalSize = { width: window.outerWidth, height: window.outerHeight };
    const originalWorkspace = ui.currentWorkspace();
    const addedWorkspaces = [];
    try {
      while (ui.workspaces().length < 12) {
        const workspace = ui.createWorkspace(`Frame dock ${addedWorkspaces.length + 1}`, { activate: false });
        assert(workspace, "Dense workspace fixture could not reach the supported twelve-workspace limit");
        addedWorkspaces.push(workspace);
      }
      ui.setSidebarState("compact");
      window.resizeTo(originalSize.width, Math.min(620, originalSize.height));
      await wait(() => near(rect(flow).width, 44) && rect(flow).height < 650 &&
        flow.querySelectorAll(".fluxion-workspace").length === 12, "Short-window compact workspace fixture did not settle");
      await delay(250);
      const workspaceList = flow.querySelector(".fluxion-workspace-list");
      const compactDock = rect(dock), compactSurface = rect(surface), compactScroll = rect(scrollArea);
      assert(compactDock.height <= compactSurface.height * .45 + 2 && near(compactDock.bottom, compactSurface.bottom),
        "Twelve-workspace Compact dock exceeded its bounded share of the sidebar or left the bottom edge");
      assert(compactScroll.height >= 120 && compactScroll.bottom <= compactDock.top + 1,
        "Dense Compact dock squeezed out or overlapped the actual tab scrolling area");
      assert(workspaceList.scrollHeight > workspaceList.clientHeight + 20,
        "Short-window workspace symbols did not establish an independently scrollable dock");
      const lastWorkspace = workspaceList.querySelector(".fluxion-workspace:last-child");
      lastWorkspace.focus({ preventScroll: true });
      lastWorkspace.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
      await delay(200);
      const lastBox = rect(lastWorkspace), listBox = rect(workspaceList);
      assert(workspaceList.scrollTop > 0 && lastBox.top >= listBox.top - 1 && lastBox.bottom <= listBox.bottom + 1 &&
        lastWorkspace.contains(document.elementFromPoint(lastBox.left + lastBox.width / 2, lastBox.top + lastBox.height / 2)),
      "The final workspace symbol is not reachable in a short Compact dock");
      workspaceControls("compact", true);
      report.geometry.push({ mode: "compact-twelve-workspaces-short-window", surface: compactSurface,
        dock: compactDock, tabs: compactScroll, workspaceList: listBox, lastWorkspace: lastBox,
        workspaceScrollTop: workspaceList.scrollTop });
      clickControl(toggle);
      await wait(() => flow.dataset.state === "expanded" && near(rect(flow).width, 232) && !surface.inert,
        "Dense Compact dock clipped or disabled the expand control");
      assert(ui.currentWorkspace() === originalWorkspace, "Scrolling the workspace dock unexpectedly switched workspaces");
      report.checks.push("twelve-workspace-short-window-dock-scrolls-with-visible-expand-and-usable-tabs");
    } finally {
      for (const workspace of addedWorkspaces) ui.deleteWorkspace(workspace.id, { confirm: false });
      ui.setSidebarState("expanded");
      window.resizeTo(originalSize.width, originalSize.height);
    }
    await wait(() => near(window.outerWidth, originalSize.width) && near(window.outerHeight, originalSize.height) &&
      addedWorkspaces.every(workspace => !ui.workspaces().some(item => item.id === workspace.id)),
    "Dense workspace fixture did not restore its original window and workspace state");
    await delay(250);
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
