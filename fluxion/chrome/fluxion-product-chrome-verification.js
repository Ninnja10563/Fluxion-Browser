/* global Services, SessionStore, PathUtils, IOUtils, Ci, Cu, ChromeUtils */
(function verifyFluxionProductChrome(window) {
  "use strict";
  if (Services.env.get("FLUXION_PRODUCT_CHROME_TEST") !== "1") return;
  const prefix = "fluxion.productChrome.verification";
  if (Services.prefs.getBoolPref(`${prefix}.claimed`, false)) return;
  Services.prefs.setBoolPref(`${prefix}.claimed`, true);
  const driver = Services.env.get("FLUXION_PRODUCT_CHROME_DRIVER_DIR");
  const { document, gBrowser, gURLBar } = window;
  const report = { checks: [], captures: [], geometry: [], input: "Actual Gecko chrome layout and native URL-bar query; no OS trackpad or keyboard synthesis claimed" };
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const delay = ms => new Promise(resolve => window.setTimeout(resolve, ms));
  const wait = async (condition, message, timeout = 15000) => {
    const deadline = Date.now() + timeout;
    while (!(await condition())) { assert(Date.now() < deadline, message); await delay(50); }
  };
  const rect = node => {
    const box = node.getBoundingClientRect();
    return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height };
  };
  const painted = node => {
    if (!node) return false;
    const box = rect(node), style = window.getComputedStyle(node);
    return box.width > 0 && box.height > 0 && style.display !== "none" && style.visibility === "visible" && Number(style.opacity) > 0;
  };
  const overlaps = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.75 &&
    Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.75;
  const contains = (outer, inner, tolerance = 1) => inner.left >= outer.left - tolerance &&
    inner.right <= outer.right + tolerance && inner.top >= outer.top - tolerance && inner.bottom <= outer.bottom + tolerance;
  const stage = value => { Services.prefs.setStringPref(`${prefix}.stage`, value); Services.prefs.savePrefFile(null); };
  async function capture(name) {
    window.focus();
    await IOUtils.writeUTF8(PathUtils.join(driver, `${name}.ready`), "ready");
    await wait(() => IOUtils.exists(PathUtils.join(driver, `${name}.sent`)), `Product chrome capture was not acknowledged: ${name}`, 20000);
    report.captures.push(name);
  }
  function geometry(label) {
    const nav = document.getElementById("nav-bar");
    const input = document.querySelector("#urlbar > .urlbar-input-container");
    assert(painted(nav) && painted(input), "Native navigation bar or actual Gecko address input is not painted");
    const navBox = rect(nav), inputBox = rect(input);
    const topPadding = inputBox.top - navBox.top, bottomPadding = navBox.bottom - inputBox.bottom;
    const controls = [...nav.querySelectorAll("toolbarbutton, button")].filter(node => {
      if (!painted(node) || input.contains(node)) return false;
      if (node.closest("panel, panelview, menupopup, .urlbarView")) return false;
      return !node.parentElement?.closest("toolbarbutton, button");
    });
    const boxes = [{ id: "native-address-input", ...inputBox }, ...controls.map(node => ({
      id: node.id || node.getAttribute("aria-label") || node.localName, ...rect(node),
    }))];
    const evidence = { label, outerWidth: window.outerWidth, innerWidth: window.innerWidth, nav: navBox,
      input: inputBox, topPadding, bottomPadding, controls: boxes };
    report.geometry.push(evidence);
    assert(topPadding >= 2 && bottomPadding >= 2 && Math.abs(topPadding - bottomPadding) <= 1.5,
      `Address bar has unbalanced vertical spacing: ${JSON.stringify(evidence)}`);
    assert(inputBox.height >= 28 && inputBox.width >= 120, `Address field is compressed: ${JSON.stringify(inputBox)}`);
    for (const box of boxes) assert(contains(navBox, box), `Toolbar control is clipped outside the nav bar: ${JSON.stringify(box)}`);
    for (let first = 0; first < boxes.length; first++) for (let second = first + 1; second < boxes.length; second++) {
      assert(!overlaps(boxes[first], boxes[second]), `Toolbar controls overlap: ${JSON.stringify([boxes[first], boxes[second]])}`);
    }
    for (const id of ["back-button", "forward-button", "unified-extensions-button", "fluxion-toolbar-menu"]) {
      assert(controls.some(node => node.id === id), `Expected native/product toolbar control is missing: ${id}`);
    }
    assert(controls.some(node => ["reload-button", "stop-button"].includes(node.id)), "Native reload/stop control is missing");
    return inputBox;
  }
  async function run() {
    assert(/\/fluxion-product-chrome-check\.[^/]+\/profile\/?$/.test(PathUtils.profileDir), "Product chrome gate requires its isolated profile");
    assert(driver === PathUtils.parent(PathUtils.profileDir), "Product chrome driver must own the isolated profile");
    assert(Services.prefs.getStringPref("fluxion.productChrome.fixture.seeded", "") === "inherited-vpn-enabled",
      "Existing-profile VPN preference was not seeded before application launch");
    await SessionStore.promiseAllWindowsRestored;
    await wait(() => window.FluxionUI && window.FluxionChromeLayout && window.FluxionTheme,
      "Product chrome layout modules did not initialize");
    stage("existing-profile-product-gate");
    const feature = "browser.ipProtection.enabled";
    assert(Services.prefs.getBoolPref(feature, true) === false &&
      Services.prefs.getDefaultBranch("").getBoolPref(feature, true) === false && Services.prefs.prefIsLocked(feature),
    "Existing enabled VPN profile escaped the effective locked product gate");
    const { IPProtectionService } = ChromeUtils.importESModule(
      "moz-src:///toolkit/components/ipprotection/IPProtectionService.sys.mjs");
    assert(IPProtectionService.featureEnabled === false && IPProtectionService.state === "uninitialized",
      "Firefox VPN service initialized despite the product gate");
    assert(!painted(document.getElementById("ipprotection-button")), "Firefox VPN promotion still occupies toolbar space");
    const panel = document.getElementById("PanelUI-ipprotection");
    assert(!painted(panel), "Firefox VPN enrollment panel is visible");
    assert(document.getElementById("aboutName")?.getAttribute("label") === "About Fluxion", "Native About command is not Fluxion branded");
    report.checks.push("inherited-vpn-enabled-pref-overridden-on-both-branches-and-locked", "native-vpn-service-uninitialized-widget-unpainted-and-panel-closed", "native-about-command-is-fluxion");
    Services.prefs.setBoolPref("browser.tabs.warnOnClose", false);
    Services.prefs.setBoolPref("browser.warnOnQuit", false);
    // Keep this layout fixture entirely local; suggestions come from the native
    // Places bookmark provider, not an external search or AI service.
    Services.prefs.setBoolPref("browser.search.suggest.enabled", false);
    Services.prefs.setBoolPref("browser.urlbar.suggest.searches", false);
    const { PlacesUtils } = ChromeUtils.importESModule("resource://gre/modules/PlacesUtils.sys.mjs");
    await PlacesUtils.bookmarks.insert({ parentGuid: PlacesUtils.bookmarks.menuGuid,
      url: "https://example.org/fluxion-product-chrome", title: "Fluxion navigation geometry fixture" });
    window.FluxionUI.setSidebarState("expanded");
    window.FluxionSidebarWidth?.setWidth(232);
    await window.FluxionTheme.set("dark");
    window.moveTo(window.screen.availLeft, window.screen.availTop);
    for (const width of [1280, 800]) {
      stage(`native-toolbar-${width}`);
      window.resizeTo(width, Math.min(850, window.screen.availHeight));
      await wait(() => Math.abs(window.outerWidth - width) <= 2, `Native window did not reach requested ${width}px width`);
      gURLBar.view.close();
      gBrowser.selectedBrowser.focus();
      await delay(350);
      geometry(`${width}-normal`);
      await capture(`capture-product-chrome-${width}`);
      gURLBar.focus();
      await wait(() => document.activeElement === gURLBar.inputField, "Native address input did not receive focus");
      await delay(250);
      const focused = geometry(`${width}-focused`);
      gURLBar.value = "fluxion-product-chrome";
      await gURLBar.startQuery({ searchString: "fluxion-product-chrome", allowAutofill: false });
      await wait(() => gURLBar.view.isOpen && painted(gURLBar.view.panel) &&
        [...document.querySelectorAll(".urlbarView-row")].some(row => painted(row) && row.textContent.includes("Fluxion navigation geometry fixture")),
      "Native Places suggestion did not render in the real address-bar view");
      const view = rect(gURLBar.view.panel), input = rect(document.querySelector("#urlbar > .urlbar-input-container"));
      report.geometry.push({ label: `${width}-native-suggestions`, view, input, focused });
      assert(view.top >= input.bottom - 1.5 && view.left <= input.left + 16 && view.right >= input.right - 16 &&
        view.left >= -1 && view.right <= window.innerWidth + 1,
      `Native suggestion view lost its address-field anchor: ${JSON.stringify({ view, input })}`);
      await capture(`capture-product-suggestions-${width}`);
      gURLBar.view.close();
      gURLBar.handleRevert();
      gBrowser.selectedBrowser.focus();
    }
    report.checks.push("normal-and-focused-address-field-balanced-at-1280-and-800", "visible-toolbar-controls-contained-with-no-pairwise-overlap", "native-places-suggestions-retain-address-field-anchor");
  }
  run().then(() => Services.prefs.setStringPref(`${prefix}.health`, "native-product-policy-and-toolbar-geometry-verified"))
    .catch(error => { Services.prefs.setStringPref(`${prefix}.error`, `${error.message}\n${error.stack}`); Cu.reportError(error); })
    .finally(async () => {
      Services.prefs.setStringPref(`${prefix}.report`, JSON.stringify(report));
      Services.prefs.savePrefFile(null);
      await delay(100);
      Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit);
    });
})(window);
