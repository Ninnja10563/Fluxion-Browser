/* global Services, ChromeUtils, IOUtils, PathUtils, SessionStore, Cu */
(function verifyMigration(window) {
  "use strict";
  if (Services.env.get("FLUXION_MIGRATION_TEST") !== "1") return;
  const prefix = "fluxion.migrationVerification";
  if (Services.prefs.getBoolPref(`${prefix}.claimed`, false)) return;
  Services.prefs.setBoolPref(`${prefix}.claimed`, true);
  Services.prefs.setIntPref(`${prefix}.pid`, Services.appinfo.processID);
  const driver = Services.env.get("FLUXION_MIGRATION_DRIVER_DIR");
  const report = { input: "native import command, Gecko widget pointer, and owned macOS NSOpenPanel keyboard", checks: [] };
  let dialog;
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const wait = async (condition, message, timeout = 30000) => {
    const end = Date.now() + timeout;
    do { const value = await condition(); if (value) return value; await new Promise(resolve => window.setTimeout(resolve, 100)); } while (Date.now() < end);
    throw Error(message);
  };
  const stage = value => { Services.prefs.setStringPref(`${prefix}.stage`, value); Services.prefs.savePrefFile(null); };
  const visible = node => node?.isConnected && !node.disabled && node.getBoundingClientRect().width > 0 &&
    node.getBoundingClientRect().height > 0 && node.ownerDocument.defaultView.getComputedStyle(node).visibility !== "hidden";
  const click = node => {
    assert(visible(node) && node.ownerDocument === dialog.document, "Migration control is hidden, disabled or foreign");
    const rect = node.getBoundingClientRect();
    for (const type of ["mousemove", "mousedown", "mouseup"]) {
      dialog.synthesizeMouseEvent(type, rect.x + rect.width / 2, rect.y + rect.height / 2, {
        identifier: dialog.windowUtils.DEFAULT_MOUSE_POINTER_ID, button: 0,
        buttons: type === "mousedown" ? 1 : 0, clickCount: type === "mousemove" ? 0 : 1,
        modifiers: 0, inputSource: dialog.MouseEvent.MOZ_SOURCE_MOUSE,
      }, { isDOMEventSynthesized: true, isWidgetEventSynthesized: false, isAsyncEnabled: false, toWindow: true });
    }
  };
  const requestDriver = async action => {
    await IOUtils.writeUTF8(PathUtils.join(driver, `${action}.ready`), "ready");
    await wait(() => IOUtils.exists(PathUtils.join(driver, `${action}.sent`)), `Native migration picker ${action} was not acknowledged`, 45000);
  };
  async function openWizard() {
    const tabs = window.gBrowser.tabs.length, selected = window.gBrowser.selectedTab;
    const command = window.document.getElementById("cmd_file_importFromAnotherBrowser");
    assert(command && command.getAttribute("disabled") !== "true", "Native import command unavailable");
    command.dispatchEvent(new window.Event("command", { bubbles: true }));
    dialog = await wait(() => [...Services.wm.getEnumerator(null)].find(candidate => !candidate.closed &&
      candidate.document?.documentURI === "chrome://browser/content/migration/migration-dialog-window.html"),
    "Import command did not open the native standalone wizard");
    await dialog.customElements.whenDefined("migration-wizard");
    const wizard = dialog.document.getElementById("wizard");
    const shadow = await wait(() => wizard?.shadowRoot, "Native wizard shadow tree missing");
    await wait(() => {
      const view = shadow.querySelector("#wizard-deck")?.getAttribute("selected-view");
      return view && view !== "page-loading";
    }, "Native wizard did not finish loading");
    Services.focus.focusedWindow = dialog;
    await wait(() => Services.focus.activeWindow === dialog && dialog.document.hasFocus(), "Native migration window is not focused");
    assert(window.gBrowser.tabs.length === tabs && window.gBrowser.selectedTab === selected,
      "Import changed the active tab or opened a hidden preferences destination");
    return { wizard, shadow };
  }
  async function settledSelector(shadow) {
    // The standalone wizard sizes itself through ResizeObserver. Gecko's
    // panel-list opens after rAF + a task and closes on resize; loaded DOM alone
    // does not mean the native selector is ready for a pointer activation.
    const diagnostics = report.selectionReadiness = { samples: 0, geometryChanges: 0, pendingPaintSamples: 0 };
    let previous = "", stable = 0;
    return wait(() => {
      diagnostics.samples++;
      const selector = shadow.querySelector("#browser-profile-selector");
      const view = shadow.querySelector("#wizard-deck")?.getAttribute("selected-view");
      const rect = selector?.getBoundingClientRect();
      const pendingPaint = dialog.windowUtils.isMozAfterPaintPending;
      if (pendingPaint) diagnostics.pendingPaintSamples++;
      const hit = rect && shadow.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      const geometry = rect ? [dialog.screenX, dialog.screenY, dialog.outerWidth, dialog.outerHeight,
        dialog.innerWidth, dialog.innerHeight, rect.x, rect.y, rect.width, rect.height].map(value => Math.round(value * 100) / 100) : [];
      const signature = JSON.stringify(geometry);
      if (previous && previous !== signature) diagnostics.geometryChanges++;
      const ready = view === "page-selection" && dialog.document.readyState === "complete" &&
        dialog.document.hasFocus() && Services.focus.activeWindow === dialog && !pendingPaint && visible(selector) &&
        (hit === selector || selector.contains(hit)) && geometry.every(Number.isFinite);
      stable = ready ? signature === previous ? stable + 1 : 1 : 0;
      previous = signature;
      diagnostics.last = { geometry, view, pendingPaint, hit: hit?.id || hit?.localName || null, stable };
      return stable >= 3 ? selector : null;
    }, "Native migration selector did not reach stable painted, focused, hit-testable geometry");
  }
  function traceSelection(shadow) {
    const events = report.selectionEvents = [];
    const targets = [dialog, shadow], types = ["resize", "blur", "focus", "mousedown", "mouseup", "click",
      "popupshowing", "popupshown", "popuphiding", "popuphidden"];
    const start = Date.now();
    const observe = event => {
      if (events.length >= 64) return;
      const target = event.composedPath?.()[0] || event.target;
      events.push({ elapsed: Date.now() - start, type: event.type, target: target?.id || target?.localName || "window",
        trusted: event.isTrusted, panelState: shadow.querySelector("panel-list")?.parentElement?.state || null,
        listOpen: Boolean(shadow.querySelector("panel-list")?.open) });
    };
    for (const target of targets) for (const type of types) target.addEventListener(type, observe, true);
    return () => {
      for (const target of targets) for (const type of types) target.removeEventListener(type, observe, true);
      const list = shadow.querySelector("panel-list");
      report.selectionFinal = { panelState: list?.parentElement?.state || null, listOpen: Boolean(list?.open),
        choices: [...shadow.querySelectorAll("panel-item")].map(item => ({ key: item.getAttribute("key"), visible: visible(item) })) };
    };
  }
  async function run() {
    assert(/\/fluxion-migration-check\.[^/]+\/profile\/?$/.test(PathUtils.profileDir) &&
      driver === PathUtils.join(PathUtils.parent(PathUtils.profileDir), "driver"), "Migration fixture is not isolated");
    const { PrivateBrowsingUtils } = ChromeUtils.importESModule("resource://gre/modules/PrivateBrowsingUtils.sys.mjs");
    assert(!PrivateBrowsingUtils.isWindowPrivate(window), "Migration fixture requires a normal isolated window");
    const { PlacesUtils } = ChromeUtils.importESModule("resource://gre/modules/PlacesUtils.sys.mjs");
    const { PlacesBrowserStartup } = ChromeUtils.importESModule("moz-src:///browser/components/places/PlacesBrowserStartup.sys.mjs");
    await SessionStore.promiseAllWindowsRestored;
    await wait(() => PlacesBrowserStartup._placesBrowserInitComplete, "Native bookmark startup did not settle");
    stage("awaiting-foreground");
    await wait(() => IOUtils.exists(PathUtils.join(driver, "foreground.ready")), "Native import window was not activated");
    const existing = await PlacesUtils.bookmarks.insert({ parentGuid: PlacesUtils.bookmarks.toolbarGuid,
      title: "Existing user bookmark", url: "https://fluxion-import-fixture.invalid/retained" });
    const unchanged = async () => {
      const actual = await PlacesUtils.bookmarks.fetch(existing.guid);
      return actual?.title === existing.title && actual.parentGuid === existing.parentGuid && actual.url.href === existing.url.href;
    };
    stage("wizard-open-cancel");
    let { shadow } = await openWizard();
    const cancel = [...shadow.querySelectorAll(".cancel-close")].find(visible);
    click(cancel);
    await wait(() => dialog.closed, "Native wizard Cancel did not close its window");
    assert(await unchanged(), "Cancel changed the existing user bookmark");
    assert(!await PlacesUtils.bookmarks.fetch({ url: "https://fluxion-import-fixture.invalid/first" }), "Cancel unexpectedly imported a bookmark");
    report.checks.push("native-import-command-opens-wizard-without-settings-navigation", "wizard-cancel-preserves-bookmarks");
    stage("selecting-native-html-file-import");
    ({ shadow } = await openWizard());
    const chooseFile = shadow.querySelector("#choose-import-from-file");
    if (visible(chooseFile)) {
      click(chooseFile);
      await wait(() => shadow.querySelector("#wizard-deck").getAttribute("selected-view") === "page-selection", "File import choices did not open");
    }
    const stopTracing = traceSelection(shadow);
    let fileChoice;
    try {
      click(await settledSelector(shadow));
      await wait(() => shadow.querySelector("panel-list")?.parentElement?.state === "open" &&
        shadow.querySelector("panel-list").open, "Native migration selector popup did not open after its real pointer activation");
      fileChoice = await wait(() => {
        const candidate = shadow.querySelector('panel-item[key="file-bookmarks"]');
        return visible(candidate) ? candidate : null;
      }, "Native bookmark-file import choice is missing");
      const rect = fileChoice.getBoundingClientRect();
      report.fileChoice = { key: fileChoice.getAttribute("key"), rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
    } finally { stopTracing(); }
    click(fileChoice.shadowRoot.querySelector("button"));
    stage("native-picker-selecting-fixture");
    await requestDriver("accept");
    // Go to Folder can either accept the file or leave Open awaiting Return.
    // Only request the latter after checking the actual wizard and modal focus.
    const deadline = Date.now() + 2000;
    let imported;
    do {
      imported = await PlacesUtils.bookmarks.fetch({ url: "https://fluxion-import-fixture.invalid/first" });
      if (imported || dialog.document.hasFocus()) break;
      await new Promise(resolve => window.setTimeout(resolve, 100));
    } while (Date.now() < deadline);
    if (!imported && !dialog.document.hasFocus()) await requestDriver("open");
    const first = await wait(() => PlacesUtils.bookmarks.fetch({ url: "https://fluxion-import-fixture.invalid/first" }), "Native HTML import did not create the expected bookmark");
    const second = await PlacesUtils.bookmarks.fetch({ url: "https://fluxion-import-fixture.invalid/second" });
    const folder = await PlacesUtils.bookmarks.fetch(first.parentGuid);
    assert(first.title === "Imported café page" && second?.title === "Second imported page" &&
      second.parentGuid === first.parentGuid && folder.title === "Imported café research", "Native HTML import lost titles or folder structure");
    assert(await unchanged(), "Import replaced the existing user bookmark");
    const finish = await wait(() => [...shadow.querySelectorAll(".finish-button")].find(visible), "Native import did not show its success page");
    click(finish);
    await wait(() => dialog.closed, "Native import Done did not close the wizard");
    report.checks.push("real-native-file-picker-html-import", "unicode-titles-and-imported-folder-preserved", "existing-bookmark-guid-url-title-parent-retained");
    report.imported = { first: first.guid, second: second.guid, folder: folder.guid, retained: existing.guid };
  }
  run().then(() => Services.prefs.setStringPref(`${prefix}.health`, "native-wizard-cancel-and-html-import-verified"))
    .catch(error => { Services.prefs.setStringPref(`${prefix}.error`, `${error.message}\n${error.stack || ""}`); Cu.reportError(error); })
    .finally(() => { Services.prefs.setStringPref(`${prefix}.report`, JSON.stringify(report)); Services.prefs.savePrefFile(null); });
})(window);
