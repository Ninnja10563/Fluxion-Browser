/* global Services, SessionStore, PathUtils, IOUtils, Ci, Cu */
(function verifySidebarWidth(window) {
  "use strict";
  if (Services.env.get("FLUXION_SIDEBAR_WIDTH_TEST") !== "1") return;
  const phase = Services.env.get("FLUXION_SIDEBAR_WIDTH_PHASE");
  if (!["seed", "restore"].includes(phase)) return;
  const prefix = "fluxion.sidebarWidth.verification";
  if (Services.prefs.getBoolPref(`${prefix}.${phase}.claimed`, false)) return;
  Services.prefs.setBoolPref(`${prefix}.${phase}.claimed`, true);
  const driver = Services.env.get("FLUXION_SIDEBAR_WIDTH_DRIVER_DIR");
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const delay = ms => new Promise(resolve => window.setTimeout(resolve, ms));
  const wait = async (condition, message, timeout = 10000) => {
    const deadline = Date.now() + timeout;
    while (!(await condition())) { assert(Date.now() < deadline, message); await delay(50); }
  };
  const closeTo = (actual, expected) => Math.abs(actual - expected) < 2;
  let companion = null;
  const report = { phase, checks: [], keyboard: "native macOS System Events; no synthetic DOM key events" };
  async function run() {
    assert(/\/fluxion-sidebar-width-check\.[^/]+\/profile\/?$/.test(PathUtils.profileDir), "Sidebar fixture requires isolated profile");
    assert(driver === PathUtils.parent(PathUtils.profileDir), "Sidebar driver must belong to isolated profile directory");
    Services.prefs.setBoolPref("browser.tabs.warnOnClose", false);
    Services.prefs.setBoolPref("browser.warnOnQuit", false);
    await SessionStore.promiseAllWindowsRestored;
    await wait(() => window.FluxionSidebarWidth && window.document.getElementById("fluxion-settings"), "Sidebar/Settings modules unavailable");
    const { document, gBrowser, FluxionUI: ui, FluxionSidebarWidth: sizing } = window;
    const flow = document.getElementById("fluxion-flow");
    const browser = document.getElementById("browser");
    const width = () => flow.getBoundingClientRect().width;
    ui.setSidebarState("expanded");
    const expected = phase === "seed" ? 232 : 318;
    await wait(() => sizing.preferredWidth() === expected && closeTo(width(), sizing.effectiveWidth()), "Initial saved sidebar width did not render");
    report.initial = { preferred: sizing.preferredWidth(), actual: width() };
    if (phase === "restore") { report.checks.push("saved-318px-restored-after-clean-relaunch"); return; }
    const preferences = gBrowser.addTrustedTab("about:preferences?fluxion=appearance", { skipAnimation: true });
    ui.selectTab(preferences);
    const choice = () => document.getElementById("fluxion-sidebar-width-choice");
    await wait(() => choice()?.getBoundingClientRect().height > 0, "Actual Appearance sidebar width control not visible");
    const change = value => { choice().value = String(value); choice().dispatchEvent(new window.Event("change", { bubbles: true })); };
    change(318);
    await wait(() => sizing.preferredWidth() === 318 && closeTo(width(), 318), "Settings width change did not resize live sidebar");
    const settings = document.getElementById("fluxion-settings");
    assert(settings && settings.getBoundingClientRect().left >= flow.getBoundingClientRect().right - 2,
      "Settings overlaps the resized sidebar");
    companion = window.OpenBrowserWindow();
    await wait(() => companion.FluxionSidebarWidth && companion.gBrowserInit?.delayedStartupFinished, "Companion window did not initialise");
    companion.FluxionUI.setSidebarState("expanded");
    const companionWidth = () => companion.document.getElementById("fluxion-flow").getBoundingClientRect().width;
    await wait(() => closeTo(companionWidth(), 318), "New window did not inherit saved sidebar geometry");
    change(350);
    await wait(() => closeTo(width(), 350) && closeTo(companionWidth(), 350), "Sidebar preference did not update both live windows");
    document.getElementById("fluxion-sidebar-width-reset").click();
    await wait(() => sizing.preferredWidth() === 232 && closeTo(companionWidth(), 232), "Settings Reset did not restore default across windows");
    companion.close(); companion = null;
    await IOUtils.writeUTF8(PathUtils.join(driver, "foreground.ready"), "ready");
    await wait(() => IOUtils.exists(PathUtils.join(driver, "foreground.sent")), "Native foreground driver did not respond");
    await wait(() => Services.focus.activeWindow === window, "Sidebar test window did not become active");
    const handle = document.getElementById("fluxion-sidebar-resizer");
    assert(handle?.getAttribute("role") === "separator", "Sidebar resize handle lacks separator semantics");
    const nativeKey = async key => {
      handle.focus();
      assert(document.activeElement === handle, "Native separator could not receive focus");
      await IOUtils.writeUTF8(PathUtils.join(driver, `${key}.ready`), "ready");
      await wait(() => IOUtils.exists(PathUtils.join(driver, `${key}.sent`)), `Native ${key} key not delivered`);
    };
    for (const [key, target] of [["home", 180], ["right", 188], ["end", Math.min(420, Math.max(180, browser.clientWidth - 320))]]) {
      await nativeKey(key);
      await wait(() => sizing.preferredWidth() === target && closeTo(width(), sizing.effectiveWidth()), `Native ${key} key did not resize sidebar`);
    }
    change(318);
    flow.style.direction = "rtl";
    await nativeKey("rtl-right");
    await wait(() => sizing.preferredWidth() === 310, "Native Right arrow did not reverse in RTL");
    flow.style.removeProperty("direction");
    report.checks.push("settings-change-reset-cross-window-and-native-arrow-home-end-rtl");
    change(280);
    await wait(() => closeTo(width(), 280), "Pointer fixture initial width did not render");
    let pointerID = null, trustedDown = false;
    const observeDown = event => { pointerID = event.pointerId; trustedDown = event.isTrusted; };
    handle.addEventListener("pointerdown", observeDown);
    // Firefox155 moved the privileged widget-input router onto Window. This
    // follows EventUtils.synthesizeMouseAtPoint, not DOM dispatchEvent.
    assert(typeof window.synthesizeMouseEvent === "function", "Gecko155 mouse input router is unavailable");
    report.pointerRequests = [];
    report.pointerDowns = [];
    const observeTarget = event => {
      if (report.pointerDowns.length < 8) report.pointerDowns.push({
        trusted: event.isTrusted, id: event.pointerId, target: event.target?.id || "",
        tag: event.target?.localName || "", x: event.clientX, y: event.clientY,
      });
    };
    document.addEventListener("pointerdown", observeTarget, true);
    let mouseHeld = false;
    const mouse = (type, x, y) => {
      if (type === "mousedown") mouseHeld = true;
      if (type === "mouseup") mouseHeld = false;
      report.pointerRequests.push({ type, x, y, buttons: mouseHeld ? 1 : 0 });
      return window.synthesizeMouseEvent(type, x, y, {
        identifier: window.windowUtils.DEFAULT_MOUSE_POINTER_ID,
        button: 0, buttons: mouseHeld ? 1 : 0,
        clickCount: type === "mousemove" ? 0 : 1,
        modifiers: 0, inputSource: window.MouseEvent.MOZ_SOURCE_MOUSE,
      }, { isDOMEventSynthesized: true, isWidgetEventSynthesized: false, isAsyncEnabled: false, toWindow: true });
    };
    const surfaceWidth = () => flow.querySelector(".fluxion-surface").getBoundingClientRect().width;
    const drag = async (amount, cancel) => {
      const rect = handle.getBoundingClientRect(), x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
      const before = sizing.preferredWidth();
      mouse("mousemove", x, y); mouse("mousedown", x, y);
      await wait(() => trustedDown && pointerID !== null && handle.hasPointerCapture(pointerID),
        "Gecko input routing did not create trusted native pointer capture");
      mouse("mousemove", x + amount, y);
      await wait(() => closeTo(surfaceWidth(), before + amount), "Captured pointer drag did not preview width");
      assert(sizing.preferredWidth() === before, "Pointer preview committed before release");
      if (cancel) {
        await nativeKey("escape");
        await wait(() => closeTo(surfaceWidth(), before) && !handle.hasPointerCapture(pointerID), "Escape did not roll back captured resize");
      }
      mouse("mouseup", x + amount, y);
      await wait(() => sizing.preferredWidth() === (cancel ? before : before + amount) && !handle.hasPointerCapture(pointerID),
        "Pointer release did not settle its exact committed/cancelled width");
      trustedDown = false; pointerID = null;
    };
    await drag(32, false);
    await drag(24, true);
    report.checks.push("trusted-gecko-pointer-capture-preview-commit-native-escape-rollback");
    report.pointer = "Gecko Window.synthesizeMouseEvent input routing with actual pointer capture; not OS pointer movement";
    change(318);
    ui.setSidebarState("compact");
    await wait(() => closeTo(width(), 44), "Compact sidebar did not retain44px geometry");
    assert(sizing.preferredWidth() === 318, "Compact mode overwrote saved width");
    ui.setSidebarState("focus");
    await wait(() => closeTo(width(), 3), "Focus mode did not retain its3px rail");
    const content = gBrowser.tabpanels.getBoundingClientRect();
    ui.revealSidebar({ focusActive: false });
    await wait(() => flow.dataset.revealed === "true", "Focus sidebar did not reveal");
    await delay(250);
    assert(closeTo(flow.querySelector(".fluxion-surface").getBoundingClientRect().width, 318), "Revealed Focus overlay ignored saved width");
    assert(closeTo(gBrowser.tabpanels.getBoundingClientRect().width, content.width), "Focus overlay reflowed page content");
    await drag(24, false);
    assert(closeTo(surfaceWidth(), 342) && closeTo(width(), 3), "Focus pointer resize changed the rail instead of its overlay");
    assert(closeTo(gBrowser.tabpanels.getBoundingClientRect().width, content.width), "Focus pointer resize reflowed page content");
    handle.removeEventListener("pointerdown", observeDown);
    document.removeEventListener("pointerdown", observeTarget, true);
    report.checks.push("focus-overlay-trusted-pointer-commit-without-content-reflow");
    ui.hideSidebar({ force: true }); ui.setSidebarState("expanded");
    change(420);
    await wait(() => closeTo(width(), 420), "Wide window did not display420px before responsive check");
    const wide = { width: window.outerWidth, height: window.outerHeight };
    window.resizeTo(580, wide.height);
    await wait(() => window.outerWidth < wide.width, "Native window refused the narrower geometry");
    await wait(() => sizing.effectiveWidth() < 420 && sizing.effectiveWidth() <= Math.max(180, browser.clientWidth - 320) && closeTo(width(), sizing.effectiveWidth()), "Narrow window did not clamp effective sidebar width below420px");
    assert(sizing.preferredWidth() === 420, "Narrow window changed desired sidebar width");
    report.narrow = { preferred: sizing.preferredWidth(), effective: sizing.effectiveWidth(), browserWidth: browser.clientWidth };
    const rectData = node => {
      const rect = node.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
    };
    const inside = (node, root) => {
      if (!node || !root || root.hidden) return false;
      const box = rectData(node), area = rectData(root);
      return box.width > 0 && box.height > 0 && area.width > 0 && area.height > 0 &&
        box.left >= area.left - 2 && box.right <= area.right + 2 &&
        box.top >= area.top - 2 && box.bottom <= area.bottom + 2;
    };
    const reset = document.getElementById("fluxion-sidebar-width-reset");
    choice().scrollIntoView({ block: "center", inline: "nearest" });
    await wait(() => inside(choice(), settings) && inside(reset, settings), "Narrow Settings clipped sidebar width input or Reset");
    report.narrow.settings = { root: rectData(settings), input: rectData(choice()), reset: rectData(reset) };
    const library = gBrowser.addTrustedTab("about:downloads#history", { skipAnimation: true });
    ui.selectTab(library);
    const libraryRoot = document.getElementById("fluxion-library");
    const librarySearch = libraryRoot?.querySelector(".fluxion-library-search");
    const libraryContent = libraryRoot?.querySelector(".fluxion-library-content");
    await wait(() => inside(librarySearch, libraryRoot) && inside(libraryContent, libraryRoot),
      "Narrow Library clipped its search or content area");
    report.narrow.library = { root: rectData(libraryRoot), search: rectData(librarySearch), content: rectData(libraryContent) };
    window.resizeTo(wide.width, wide.height);
    await wait(() => closeTo(width(), 420), "Widening window did not restore preferred420px width");
    ui.selectTab(preferences);
    await wait(() => !settings.hidden, "Settings did not return for final width save");
    change(318);
    await wait(() => closeTo(width(), 318), "Final318px width did not render");
    ui.selectTab(library);
    await wait(() => libraryRoot && !libraryRoot.hidden && libraryRoot.getBoundingClientRect().height > 0, "Library did not render");
    assert(libraryRoot.getBoundingClientRect().left >= flow.getBoundingClientRect().right - 2, "Library overlaps resized sidebar");
    assert(sizing.preferredWidth() === 318 && Services.prefs.getIntPref("fluxion.sidebar.width") === 318, "Final saved width not318");
    report.checks.push("compact-focus-overlay-narrow-window-settings-library-offsets");
    if (Services.env.get("FLUXION_SIDEBAR_WIDTH_ARTIFACT_DIR")) {
      ui.selectTab(preferences);
      await wait(() => !settings.hidden && choice().getBoundingClientRect().height > 0,
        "Appearance did not settle for the sidebar screenshot");
      choice().scrollIntoView({ block: "center", inline: "nearest" });
      choice().focus();
      await IOUtils.writeUTF8(PathUtils.join(driver, "capture.ready"), "ready");
      await wait(() => IOUtils.exists(PathUtils.join(driver, "capture.sent")), "Sidebar screenshot driver did not respond");
    }
  }
  run().then(() => Services.prefs.setStringPref(`${prefix}.${phase}.health`, "native-sidebar-width-geometry-and-persistence-verified"))
    .catch(error => { Services.prefs.setStringPref(`${prefix}.${phase}.error`, `${error.message}\n${error.stack}`); Cu.reportError(error); })
    .finally(async () => {
      if (companion && !companion.closed) companion.close();
      const flow = window.document.getElementById("fluxion-flow");
      report.final = { preferred: window.FluxionSidebarWidth?.preferredWidth(),
        effective: window.FluxionSidebarWidth?.effectiveWidth(), actual: flow?.getBoundingClientRect().width,
        mode: flow?.dataset.state, revealed: flow?.dataset.revealed,
        activeElement: window.document.activeElement?.id, activeWindow: Services.focus.activeWindow === window,
        browserWidth: window.document.getElementById("browser")?.clientWidth,
        outerWidth: window.outerWidth };
      Services.prefs.setStringPref(`${prefix}.${phase}.report`, JSON.stringify(report));
      Services.prefs.savePrefFile(null); await delay(100);
      Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit);
    });
})(window);
