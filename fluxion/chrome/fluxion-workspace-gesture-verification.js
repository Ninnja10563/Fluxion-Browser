/* global Services, SessionStore, PathUtils, IOUtils, Ci, Cu */
(function verifyWorkspaceGestures(window) {
  "use strict";
  if (Services.env.get("FLUXION_WORKSPACE_GESTURE_TEST") !== "1") return;
  const prefix = "fluxion.workspaceGestureVerification";
  if (Services.prefs.getBoolPref(`${prefix}.claimed`, false)) return;
  Services.prefs.setBoolPref(`${prefix}.claimed`, true);
  const { document, gBrowser } = window;
  const driver = Services.env.get("FLUXION_WORKSPACE_GESTURE_DRIVER_DIR");
  const report = { input: "Gecko nsIDOMWindowUtils.sendWheelEvent with pixel and momentum flags; physical trackpad not claimed", checks: [], events: [] };
  const cleanups = [];
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const delay = ms => new Promise(resolve => window.setTimeout(resolve, ms));
  const wait = async (condition, message, timeout = 10000) => {
    const deadline = Date.now() + timeout;
    while (!(await condition())) { assert(Date.now() < deadline, message); await delay(40); }
  };
  const painted = () => new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)));
  const stage = value => { Services.prefs.setStringPref(`${prefix}.stage`, value); Services.prefs.savePrefFile(null); };
  const center = node => {
    const r = node.getBoundingClientRect();
    assert(r.width > 0 && r.height > 0, "Wheel target has no visible geometry");
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };
  const wheel = (point, dx, dy = 0, momentum = false) => {
    const utils = window.windowUtils;
    const flags = utils.WHEEL_EVENT_CAUSED_BY_NO_LINE_OR_PAGE_DELTA_DEVICE |
      (momentum ? utils.WHEEL_EVENT_CAUSED_BY_MOMENTUM : 0);
    // The native Gecko router hit-tests these window-relative coordinates.
    // No DOM dispatchEvent or direct workspace call is used for the gesture.
    utils.sendWheelEvent(point.x, point.y, dx, dy, 0, window.WheelEvent.DOM_DELTA_PIXEL, 0, 0, 0, flags);
  };
  const move = point => window.synthesizeMouseEvent("mousemove", point.x, point.y, {
    identifier: window.windowUtils.DEFAULT_MOUSE_POINTER_ID, button: 0, buttons: 0,
    clickCount: 0, modifiers: 0, inputSource: window.MouseEvent.MOZ_SOURCE_MOUSE,
  }, { isDOMEventSynthesized: true, isWidgetEventSynthesized: false, isAsyncEnabled: false, toWindow: true });

  async function run() {
    assert(/\/fluxion-workspace-gesture-check\.[^/]+\/profile\/?$/.test(PathUtils.profileDir), "Gesture fixture requires an isolated profile");
    assert(driver === PathUtils.parent(PathUtils.profileDir), "Gesture driver must belong to the isolated profile");
    await SessionStore.promiseAllWindowsRestored;
    await wait(() => window.FluxionUI && window.FluxionWorkspaceGestures?.enabled, "Workspace gesture modules did not initialize");
    assert(typeof window.windowUtils.sendWheelEvent === "function", "Gecko wheel router is unavailable");
    Services.prefs.setBoolPref("browser.tabs.warnOnClose", false);
    Services.prefs.setBoolPref("browser.warnOnQuit", false);
    await IOUtils.writeUTF8(PathUtils.join(driver, "foreground.ready"), "ready");
    await wait(() => IOUtils.exists(PathUtils.join(driver, "foreground.sent")), "Native driver did not foreground the gesture fixture", 20000);
    await wait(() => Services.focus.activeWindow === window, "Gesture fixture is not the native foreground window");
    const ui = window.FluxionUI, flow = document.getElementById("fluxion-flow");
    const surface = flow.querySelector(".fluxion-surface"), scroll = flow.querySelector(".fluxion-tab-scroll");
    assert(ui.workspaces().length === 1, "A fresh profile did not start with one workspace");
    const first = ui.workspaces()[0];
    const second = ui.createWorkspace("Gesture second", { activate: false });
    const third = ui.createWorkspace("Gesture third", { activate: false });
    assert(second && third, "Gesture fixture workspaces could not be created");
    const fixtures = [];
    for (const workspace of [first, second, third]) {
      // Initial about:blank entries are replaceable by the next navigation.
      // A titled, committed document gives this fixture real Back history.
      const initialTitle = `Fluxion swipe ${workspace.id} initial`;
      const currentTitle = `Fluxion swipe ${workspace.id} current`;
      const pageURL = title => `data:text/html,${encodeURIComponent(`<title>${title}</title><p>${title}</p>`)}`;
      const initial = pageURL(initialTitle), current = pageURL(currentTitle);
      const tab = gBrowser.addTrustedTab(initial, { skipAnimation: true });
      ui.setTabWorkspace(tab, workspace.id);
      ui.selectTab(tab);
      await wait(() => tab.linkedBrowser.currentURI.spec === initial && tab.label === initialTitle && !tab.hasAttribute("busy"),
        "Initial gesture history document did not commit");
      tab.linkedBrowser.loadURI(Services.io.newURI(current), { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
      await wait(() => tab.linkedBrowser.currentURI.spec === current && tab.label === currentTitle &&
        !tab.hasAttribute("busy") && tab.linkedBrowser.canGoBack,
      "Gesture page did not acquire a real Back history entry");
      fixtures.push(tab);
    }
    const history = () => fixtures.map(tab => ({ uri: tab.linkedBrowser.currentURI.spec,
      count: tab.linkedBrowser.browsingContext.sessionHistory.count,
      index: tab.linkedBrowser.browsingContext.sessionHistory.index,
      back: tab.linkedBrowser.canGoBack, forward: tab.linkedBrowser.canGoForward }));
    const historyBaseline = history();
    assert(historyBaseline.every(state => Number.isInteger(state.count) && state.count >= 2 && state.back),
      `Gesture fixtures lack observable native session history: ${JSON.stringify(historyBaseline)}`);
    const originalHistory = JSON.stringify(historyBaseline);
    const observe = event => {
      const entry = { trusted: event.isTrusted, dx: event.deltaX, dy: event.deltaY,
        target: event.target?.className || event.target?.id || event.target?.localName, at: window.performance.now() };
      report.events.push(entry);
      Promise.resolve().then(() => { entry.cancelled = event.defaultPrevented; });
    };
    surface.addEventListener("wheel", observe, true);
    cleanups.push(() => surface.removeEventListener("wheel", observe, true));
    const sidebarPoint = () => {
      const point = center(scroll);
      assert(surface.contains(document.elementFromPoint(point.x, point.y)), "Sidebar wheel target is obscured");
      return point;
    };
    ui.setSidebarState("expanded");
    ui.selectTab(fixtures[0]);
    await painted(); await delay(300);
    let point = sidebarPoint();
    move(point); await delay(300);

    stage("routed-horizontal-and-momentum");
    wheel(point, 60);
    await wait(() => ui.currentWorkspace() === second.id, "Horizontal pixel wheel did not select the next workspace");
    for (let index = 0; index < 12; index++) { wheel(point, 60, 0, true); await delay(25); }
    assert(ui.currentWorkspace() === second.id, "Momentum skipped more than one workspace");
    assert(report.events.length === 13 && report.events.every(event => event.trusted && event.cancelled && event.dx === 60),
      `Horizontal wheel events did not follow the trusted, cancelled sidebar route: ${JSON.stringify(report.events)}`);
    await delay(300);
    wheel(point, -60);
    await wait(() => ui.currentWorkspace() === first.id, "Fresh reverse gesture did not select the previous workspace");
    await delay(300);
    wheel(point, -60); await delay(80);
    assert(ui.currentWorkspace() === first.id, "Workspace gesture wrapped past the first workspace");
    assert(JSON.stringify(history()) === originalHistory, "Sidebar gesture navigated a webpage or changed its session history");
    report.checks.push("trusted-horizontal-next-previous-one-switch-per-momentum-gesture-no-boundary-wrap-no-page-navigation");

    stage("vertical-native-scroll");
    for (let index = 0; index < 55; index++) {
      const tab = gBrowser.addTrustedTab(`about:blank?fluxion-swipe-scroll=${index}`, { skipAnimation: true });
      ui.setTabWorkspace(tab, first.id);
    }
    await wait(() => scroll.scrollHeight > scroll.clientHeight + 300, "Dense tab fixture has no native scroll overflow");
    scroll.scrollTop = 0;
    await painted(); await delay(300);
    point = sidebarPoint(); move(point); await delay(300);
    const offsetBefore = scroll.scrollTop, eventCount = report.events.length;
    wheel(point, 0, 180);
    await wait(() => scroll.scrollTop > offsetBefore + 1, "Vertical wheel did not scroll the native sidebar container");
    assert(ui.currentWorkspace() === first.id, "Vertical sidebar scrolling switched workspace");
    assert(report.events.length === eventCount + 1 && report.events.at(-1).trusted && !report.events.at(-1).cancelled,
      "Vertical wheel was not preserved as an uncancelled trusted event");
    report.verticalScroll = { before: offsetBefore, after: scroll.scrollTop, scrollHeight: scroll.scrollHeight, clientHeight: scroll.clientHeight };
    report.checks.push("vertical-wheel-preserves-workspace-and-scrolls-native-dense-tab-list");

    stage("collapsed-edge-and-revealed-overlay");
    ui.setSidebarState("focus");
    ui.hideSidebar({ force: true });
    await wait(() => flow.dataset.revealed !== "true" && flow.getBoundingClientRect().width <= 4, "Collapsed sidebar did not hide");
    await delay(300);
    const edge = center(flow), edgeEvents = report.events.length;
    wheel(edge, 60); await delay(100);
    assert(ui.currentWorkspace() === first.id && report.events.length === edgeEvents, "Collapsed edge consumed a workspace swipe");
    move(edge);
    await wait(() => flow.dataset.revealed === "true", "Native edge hover did not reveal the sidebar");
    await delay(300);
    point = sidebarPoint(); move(point); await delay(300);
    wheel(point, 60);
    await wait(() => ui.currentWorkspace() === second.id, "Revealed sidebar did not accept a horizontal workspace gesture");
    report.checks.push("collapsed-edge-ignores-wheel-revealed-overlay-accepts-gesture");

    stage("unrelated-page-input");
    ui.setSidebarState("expanded");
    await painted(); await delay(300);
    const page = gBrowser.selectedBrowser, pagePoint = center(page);
    assert(document.elementFromPoint(pagePoint.x, pagePoint.y) === page, "Page input coordinates do not hit the actual Gecko browser");
    move(pagePoint); await delay(300);
    const pageEvents = report.events.length, selected = gBrowser.selectedTab;
    wheel(pagePoint, 60); wheel(pagePoint, 0, 120);
    await delay(300);
    assert(ui.currentWorkspace() === second.id && gBrowser.selectedTab === selected && report.events.length === pageEvents,
      "Unrelated webpage wheel input reached workspace navigation");
    assert(JSON.stringify(history()) === originalHistory, "Routed wheel fixtures changed page URI or session history");
    report.history = history();
    report.checks.push("webpage-wheel-never-enters-sidebar-route-and-page-session-history-remains-intact");
  }
  run().then(() => Services.prefs.setStringPref(`${prefix}.health`, "native-routed-workspace-wheel-and-scroll-verified"))
    .catch(error => { Services.prefs.setStringPref(`${prefix}.error`, `${error.message}\n${error.stack}`); Cu.reportError(error); })
    .finally(async () => {
      for (const remove of cleanups) remove();
      Services.prefs.setStringPref(`${prefix}.report`, JSON.stringify(report));
      Services.prefs.savePrefFile(null);
      await delay(100);
      Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit);
    });
})(window);
