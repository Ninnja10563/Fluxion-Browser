/* global Services, SessionStore, PathUtils, IOUtils, Ci, Cu, ChromeUtils */
(function verifyFluxionBranding(window) {
  "use strict";
  if (Services.env.get("FLUXION_VERIFY_BRANDING") !== "1") return;
  const prefix = "fluxion.branding.verification";
  if (Services.prefs.getBoolPref(`${prefix}.claimed`, false)) return;
  Services.prefs.setBoolPref(`${prefix}.claimed`, true);
  const { document, gBrowser } = window;
  const driver = Services.env.get("FLUXION_BRANDING_DRIVER_DIR");
  const report = { checks: [], strings: {}, resources: [], captures: [],
    input: "Packaged Gecko localization and live HTTPS security panel; quit strings resolved without accepting a quit dialog" };
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const delay = ms => new Promise(resolve => window.setTimeout(resolve, ms));
  const wait = async (condition, message, timeout = 15000) => {
    const deadline = Date.now() + timeout;
    while (!(await condition())) { assert(Date.now() < deadline, message); await delay(50); }
  };
  const plain = value => String(value).replace(/[\u2066-\u2069]/g, "");
  function requireProductString(id, actual, expected) {
    const value = plain(actual);
    assert(value === expected, `Native branded string changed or lost meaning: ${id}: ${value}`);
    report.strings[id] = value;
  }
  const painted = node => {
    if (!node) return false;
    const box = node.getBoundingClientRect(), style = window.getComputedStyle(node);
    return box.width > 0 && box.height > 0 && style.visibility === "visible" && style.display !== "none";
  };
  async function capture(name) {
    await new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)));
    await IOUtils.writeUTF8(PathUtils.join(driver, `${name}.ready`), "ready");
    await wait(() => IOUtils.exists(PathUtils.join(driver, `${name}.sent`)), `Branding capture not acknowledged: ${name}`, 20000);
    report.captures.push(name);
  }
  async function strings() {
    const brand = Services.strings.createBundle("chrome://branding/locale/brand.properties");
    for (const id of ["brandShorterName", "brandShortName", "brandFullName"]) {
      requireProductString(id, brand.GetStringFromName(id), "Fluxion");
    }
    const quit = {
      "tabbrowser-confirm-close-tabs-with-key-title": "Close window and quit Fluxion?",
      "tabbrowser-confirm-close-tabs-with-key-button": "Quit Fluxion",
      "tabbrowser-confirm-close-warn-shortcut-title": "Quit Fluxion or close current tab?",
    };
    const quitValues = await gBrowser.tabLocalization.formatValues(Object.keys(quit).map(id => ({ id })));
    Object.entries(quit).forEach(([id, expected], index) => requireProductString(id, quitValues[index], expected));
    const security = {
      "trustpanel-header-enabled": "Fluxion is on guard",
      "trustpanel-header-enabled-insecure": "Be careful on this site",
      "trustpanel-description-enabled-insecure": "Fluxion noticed something suspicious.",
      "trustpanel-header-disabled": "You turned off protections",
      "trustpanel-description-disabled": "Fluxion is off-duty. We suggest turning protections back on.",
      "trustpanel-connection-label-secure": "Connection secure",
      "trustpanel-connection-label-insecure": "Connection not secure",
    };
    const securityValues = await document.l10n.formatValues(Object.keys(security).map(id => ({ id })));
    Object.entries(security).forEach(([id, expected], index) => requireProductString(id, securityValues[index], expected));
    const legal = await document.l10n.formatValue("trademarkInfo");
    requireProductString("trademarkInfo", legal, "Firefox and the Firefox logos are trademarks of the Mozilla Foundation.");
    const errors = Services.strings.createBundle("chrome://browser/locale/appstrings.properties");
    requireProductString("fileNotFound", errors.GetStringFromName("fileNotFound"), "Fluxion can’t find the file at %S.");
    requireProductString("sslv3Used", errors.GetStringFromName("sslv3Used"),
      "Fluxion cannot guarantee the safety of your data on %S because it uses SSLv3, a broken security protocol.");
    report.checks.push("native-generic-and-quit-localizations-use-fluxion",
      "secure-insecure-disabled-and-network-warning-meanings-preserved", "mozilla-trademark-attribution-preserved");
  }
  const bytes = uri => new Promise((resolve, reject) => {
    const request = new window.XMLHttpRequest();
    request.open("GET", uri, true);
    request.responseType = "arraybuffer";
    request.timeout = 10000;
    request.onload = () => request.response?.byteLength > 0 ? resolve(new Uint8Array(request.response)) : reject(new Error(`Empty branding resource: ${uri}`));
    request.onerror = request.ontimeout = () => reject(new Error(`Could not load packaged branding resource: ${uri}`));
    request.send();
  });
  function validateMarkPixels(pixels, width, height) {
    assert(width >= 32 && height >= 32 && pixels.length === width * height * 4, "Transparent mark has invalid decoded dimensions");
    for (const [x, y] of [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]]) {
      assert(pixels[(y * width + x) * 4 + 3] === 0, "Browser mark still has an opaque app-tile corner");
    }
    let visible = 0, transparent = 0;
    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index] > 0) visible++;
      if (pixels[index] === 0) transparent++;
    }
    assert(visible > width * height * .05 && transparent > width * height * .1, "Browser mark is empty or lacks a genuinely transparent background");
    return { width, height, visible, transparent };
  }
  function validateNativeArt(uri, svg, encodedMark) {
    assert(svg.includes(`data:image/png;base64,${encodedMark}`), `Native art does not embed the supplied transparent Fluxion mark: ${uri}`);
    assert(!/\bFirefox\b/i.test(svg), `Native replacement art retains Firefox branding: ${uri}`);
    if (/trustpanel-graphic-(warning|disabled)\.svg$/.test(uri)) {
      assert(/<(?:path|circle|rect|text)\b/.test(svg), `Native warning/off artwork lost its distinct status badge: ${uri}`);
    }
  }
  async function artwork() {
    const uri = "resource://fluxion/assets/app-icons/fluxion-mark.png", mark = await bytes(uri);
    const encoded = window.btoa(Array.from(mark, byte => String.fromCharCode(byte)).join(""));
    const image = new window.Image();
    image.src = uri;
    await image.decode();
    const canvas = document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d"); context.drawImage(image, 0, 0);
    report.mark = validateMarkPixels(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
    const art = new Map();
    for (const resource of ["chrome://branding/content/about-logo.svg",
      ...["enabled", "warning", "disabled"].map(state => `chrome://browser/skin/trustpanel-graphic-${state}.svg`)]) {
      const raw = await bytes(resource), svg = new window.TextDecoder().decode(raw);
      validateNativeArt(resource, svg, encoded);
      art.set(resource, svg);
      const digest = await window.crypto.subtle.digest("SHA-256", raw);
      report.resources.push({ uri: resource, sha256: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("") });
    }
    assert(new Set([...art].filter(([resource]) => resource.includes("trustpanel-graphic")).map(([, svg]) => svg)).size === 3,
      "Security state illustrations became indistinguishable");
    report.checks.push("packaged-native-logo-and-trust-art-embed-exact-supplied-transparent-mark",
      "decoded-mark-has-transparent-corners-and-distinct-warning-off-art-retained");
    const tab = window.FluxionUI.newTab();
    await wait(() => {
      const row = [...document.querySelectorAll(".fluxion-tab")].find(item => item._fluxionTab === tab);
      const icon = row?.querySelector("img.fluxion-favicon");
      return icon?.src === uri && icon.complete && icon.naturalWidth > 0;
    }, "New Tab did not paint the transparent Fluxion mark");
    report.checks.push("new-tab-flow-row-paints-transparent-mark");
  }
  async function securityPanel() {
    const tab = gBrowser.addTrustedTab("https://example.org/", { skipAnimation: true });
    window.FluxionUI.setTabWorkspace(tab, window.FluxionUI.currentWorkspace());
    window.FluxionUI.selectTab(tab);
    await wait(() => tab.linkedBrowser.currentURI.spec === "https://example.org/" &&
      tab.label === "Example Domain" && !tab.hasAttribute("busy"), "Real HTTPS branding fixture did not load", 35000);
    await window.gTrustPanelHandler.showPopup({ reason: "fluxion-branding-verification" });
    const panel = document.getElementById("trustpanel-popup");
    await wait(() => panel?.state === "open" && document.getElementById("trustpanel-header")?.textContent.includes("Fluxion"),
      "Native Fluxion trust panel did not finish localizing");
    assert(panel.getAttribute("tracking-protection") === "enabled", "Fixture unexpectedly disabled tracking protection");
    const header = document.getElementById("trustpanel-header");
    requireProductString("painted-trust-header", header.textContent.trim(), "Fluxion is on guard");
    assert(painted(header), "Branded security status is not painted");
    for (const id of ["trustpanel-popup-connection", "trustpanel-toggle", "trustpanel-privacy-link"]) {
      assert(painted(document.getElementById(id)), `Branding hid a native security control: ${id}`);
    }
    assert(document.getElementById("trustpanel-toggle").hasAttribute("pressed"), "Native protection toggle lost its enabled state");
    assert(document.querySelector('[data-l10n-id="trustpanel-header-enabled-insecure"]') &&
      document.getElementById("trustpanel-insecure-section") && document.getElementById("trustpanel-breach-alert-section"),
    "Branding removed native insecure/breach warning surfaces");
    const graphic = document.getElementById("trustpanel-graphic-image-legacy");
    const backgroundImage = window.getComputedStyle(graphic).backgroundImage;
    assert(painted(graphic) && backgroundImage.includes("trustpanel-graphic-enabled.svg"),
      "Actual native security illustration is not using the replaced branded resource");
    report.security = { state: panel.getAttribute("tracking-protection"), connection: panel.getAttribute("connection"),
      header: header.textContent.trim(), graphic: backgroundImage };
    await capture("capture-branding-security");
    panel.hidePopup();
    await wait(() => panel.state === "closed", "Native security panel did not close");
    report.checks.push("real-https-trust-panel-branded-with-security-controls-and-warning-surfaces-retained");
  }
  async function defaultBrowserControl() {
    const { ShellService } = ChromeUtils.importESModule("moz-src:///browser/components/shell/ShellService.sys.mjs");
    const before = ShellService.isDefaultBrowser(false, true);
    const tab = gBrowser.addTrustedTab("about:preferences?fluxion=general", { skipAnimation: true });
    window.FluxionUI.setTabWorkspace(tab, window.FluxionUI.currentWorkspace());
    window.FluxionUI.selectTab(tab);
    const settings = document.getElementById("fluxion-settings");
    const button = document.getElementById("fluxion-make-default-browser");
    const status = document.getElementById("fluxion-default-browser-status");
    const general = [...settings.querySelectorAll(".fluxion-settings-nav button")].find(node => node.textContent === "General");
    await wait(() => !settings.hidden && painted(button), "Actual General default-browser control is missing");
    general.click();
    assert(button.disabled === before && status.textContent.includes(before ? "is your default browser" : "is not your default browser"),
      "General default-browser status disagrees with the read-only native service");
    const descriptors = new Map(["isDefaultBrowser", "setDefaultBrowser"].map(name => [name, Object.getOwnPropertyDescriptor(ShellService, name)]));
    assert([...descriptors.values()].every(value => value?.configurable), "Native service seam cannot be safely intercepted; refusing any default-browser write");
    const calls = []; let simulatedDefault = false;
    try {
      // Replace the mutator before making the control actionable. CI must never
      // invoke the real OS default-browser request or accept an OS prompt.
      Object.defineProperty(ShellService, "setDefaultBrowser", { configurable: true, writable: true,
        value: async (...args) => { calls.push(args); } });
      Object.defineProperty(ShellService, "isDefaultBrowser", { configurable: true, writable: true,
        value: () => simulatedDefault });
      general.click();
      assert(!button.disabled, "Default-browser action did not refresh with the native service seam");
      button.scrollIntoView({ block: "nearest", behavior: "instant" });
      const box = button.getBoundingClientRect(), x = box.left + box.width / 2, y = box.top + box.height / 2;
      assert(button.contains(document.elementFromPoint(x, y)), "Make Default button is clipped or obscured");
      assert(typeof window.synthesizeMouseEvent === "function", "Native widget pointer router unavailable");
      for (const [type, buttons] of [["mousemove", 0], ["mousedown", 1], ["mouseup", 0]]) {
        window.synthesizeMouseEvent(type, x, y, { identifier: window.windowUtils.DEFAULT_MOUSE_POINTER_ID,
          button: 0, buttons, clickCount: type === "mousemove" ? 0 : 1, modifiers: 0,
          inputSource: window.MouseEvent.MOZ_SOURCE_MOUSE },
        { isDOMEventSynthesized: true, isWidgetEventSynthesized: false, isAsyncEnabled: false, toWindow: true });
      }
      await wait(() => calls.length === 1 && !button.disabled, "Actual Make Default control did not delegate to the intercepted native method");
      assert(calls[0].length === 1 && calls[0][0] === false, "Default-browser request incorrectly targeted all users");
      assert(!status.textContent.includes("is your default browser"), "UI claimed success before native status confirmed it");
      simulatedDefault = true;
      window.dispatchEvent(new window.Event("activate"));
      assert(button.disabled && status.textContent === "Fluxion is your default browser.", "General did not refresh after native confirmation status changed");
    } finally {
      for (const [name, descriptor] of descriptors) Object.defineProperty(ShellService, name, descriptor);
      general.click();
    }
    const after = ShellService.isDefaultBrowser(false, true);
    assert(after === before, "Default-browser fixture changed the runner’s native default");
    report.defaultBrowser = { nativeBefore: before, nativeAfter: after, interceptedCalls: calls,
      systemDefaultMutation: false, osConfirmationTested: false };
    await capture("capture-branding-default-browser");
    report.checks.push("native-default-browser-status-and-widget-routed-settings-delegation-with-os-mutation-intercepted");
  }
  async function run() {
    assert(/\/fluxion-branding-check\.[^/]+\/profile\/?$/.test(PathUtils.profileDir), "Branding fixture requires its isolated profile");
    assert(driver === PathUtils.parent(PathUtils.profileDir), "Branding driver must belong to the isolated profile");
    Services.prefs.setBoolPref("browser.warnOnQuit", false);
    Services.prefs.setBoolPref("browser.tabs.warnOnClose", false);
    await SessionStore.promiseAllWindowsRestored;
    await wait(() => window.FluxionUI && window.gBrowserInit.delayedStartupFinished, "Browser startup did not finish");
    window.FluxionUI.setSidebarState("expanded");
    await strings();
    await artwork();
    await IOUtils.writeUTF8(PathUtils.join(driver, "branding-foreground.ready"), "ready");
    await wait(() => IOUtils.exists(PathUtils.join(driver, "branding-foreground.sent")) &&
      Services.focus.activeWindow === window, "Branding driver did not foreground its owned browser", 20000);
    await defaultBrowserControl();
    await securityPanel();
    Services.prefs.setStringPref(`${prefix}.health`, "native-branding-and-security-preservation-verified");
  }
  run().catch(error => {
    Services.prefs.setStringPref(`${prefix}.error`, `${error?.message || error}\n${error?.stack || ""}`);
    Cu.reportError(error);
  }).finally(async () => {
    Services.prefs.setStringPref(`${prefix}.report`, JSON.stringify(report));
    Services.prefs.savePrefFile(null);
    await delay(100);
    Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit);
  });
})(window);
