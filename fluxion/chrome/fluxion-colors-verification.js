/* global Services, SessionStore, PathUtils, IOUtils, Ci, Cu, FluxionColorsCore */
(function verifyFluxionColors(window) {
  "use strict";
  if (Services.env.get("FLUXION_COLORS_TEST") !== "1") return;
  const phase = Services.env.get("FLUXION_COLORS_PHASE");
  if (!["seed", "restore"].includes(phase)) return;
  const prefix = `fluxion.colors.verification.${phase}`;
  if (Services.prefs.getBoolPref(`${prefix}.claimed`, false)) return;
  Services.prefs.setBoolPref(`${prefix}.claimed`, true);
  const driver = Services.env.get("FLUXION_COLORS_DRIVER_DIR");
  const report = { phase, checks: [], captures: [], input: "Actual native Gecko Settings controls with dispatched input/change events; OS color-picker interaction is not claimed" };
  const expected = {
    enabled: true,
    light: { base: "#ddd7cd", accent: "#603d1c" },
    dark: { base: "#202d36", accent: "#e7c58e" },
  };
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const delay = ms => new Promise(resolve => window.setTimeout(resolve, ms));
  const wait = async (condition, message, timeout = 15000) => {
    const deadline = Date.now() + timeout;
    while (!(await condition())) { assert(Date.now() < deadline, message); await delay(50); }
  };
  const rgb = hex => `rgb(${[1, 3, 5].map(index => Number.parseInt(hex.slice(index, index + 2), 16)).join(", ")})`;
  const computed = (target, id, property) => {
    const node = id === "urlbar-background"
      ? target.document.querySelector("#urlbar > .urlbar-background") || target.document.getElementById(id)
      : target.document.getElementById(id);
    assert(node, `Native color target is missing: ${id}`);
    return target.getComputedStyle(node)[property];
  };
  const inline = target => target.document.documentElement.style.getPropertyValue("--fluxion-bg");
  let companion = null;
  const stage = value => { Services.prefs.setStringPref(`${prefix}.stage`, value); Services.prefs.savePrefFile(null); };
  async function snapshot(tab) {
    const global = tab.linkedBrowser.browsingContext.currentWindowGlobal;
    assert(global?.documentURI.spec === "https://example.org/", "Snapshot target is not the loaded static HTTPS fixture");
    // Parent-only Gecko API, checked against Firefox155 WindowGlobalActors.webidl.
    // No code is installed into the webpage and no privileged bridge is exposed.
    const bitmap = await global.drawSnapshot(new window.DOMRect(0, 0, 400, 260), 1, "#ffffff");
    try {
      const canvas = window.document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
      canvas.width = bitmap.width; canvas.height = bitmap.height;
      const context = canvas.getContext("2d");
      context.drawImage(bitmap, 0, 0);
      const bytes = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const digest = await window.crypto.subtle.digest("SHA-256", bytes);
      return { hash: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join(""),
        width: canvas.width, height: canvas.height, global: global.innerWindowId };
    } finally { bitmap.close(); }
  }
  async function settings(target) {
    const tab = target.gBrowser.addTrustedTab("about:preferences?fluxion=appearance", { skipAnimation: true });
    target.FluxionUI.setTabWorkspace(tab, target.FluxionUI.currentWorkspace());
    target.FluxionUI.selectTab(tab);
    await wait(() => target.document.getElementById("fluxion-settings")?.hidden === false &&
      target.document.getElementById("fluxion-colors-enabled")?.getBoundingClientRect().height > 0,
    "Actual Appearance color controls did not become visible");
    return tab;
  }
  const enabled = (target, checked) => {
    const control = target.document.getElementById("fluxion-colors-enabled");
    assert(control && !control.disabled, "Custom color control is unavailable");
    control.checked = checked;
    control.dispatchEvent(new target.Event("change", { bubbles: true }));
  };
  const color = (target, mode, name, value) => {
    const control = target.document.getElementById(`fluxion-color-${mode}-${name}`);
    assert(control && !control.disabled, `Actual ${mode} ${name} field is unavailable`);
    control.value = value;
    control.dispatchEvent(new target.Event("input", { bubbles: true }));
    control.dispatchEvent(new target.Event("change", { bubbles: true }));
    assert(control.getAttribute("aria-invalid") !== "true", `Valid ${mode} ${name} color was rejected`);
  };
  async function capture(name) {
    window.focus();
    await IOUtils.writeUTF8(PathUtils.join(driver, `${name}.ready`), "ready");
    await wait(() => IOUtils.exists(PathUtils.join(driver, `${name}.sent`)), `Color capture driver did not acknowledge ${name}`, 20000);
    report.captures.push(name);
  }
  async function run() {
    assert(/\/fluxion-colors-check\.[^/]+\/profile\/?$/.test(PathUtils.profileDir), "Color fixture requires its isolated profile");
    assert(driver === PathUtils.parent(PathUtils.profileDir), "Color driver must belong to the isolated profile");
    Services.prefs.setBoolPref("browser.tabs.warnOnClose", false);
    Services.prefs.setBoolPref("browser.warnOnQuit", false);
    await SessionStore.promiseAllWindowsRestored;
    await wait(() => window.FluxionColors && window.FluxionUI && window.FluxionTheme &&
      window.document.getElementById("fluxion-settings"), "Color, chrome or Settings modules failed to initialize");
    window.FluxionUI.setSidebarState("expanded");
    if (phase === "restore") {
      stage("clean-relaunch-and-settings-reset");
      assert(JSON.stringify(window.FluxionColors.current()) === JSON.stringify(expected), "Custom palettes were not restored after clean process restart");
      await wait(() => computed(window, "nav-bar", "backgroundColor") === rgb(expected.dark.base), "Restored dark palette did not reach native navigation chrome");
      await settings(window);
      for (const mode of ["light", "dark"]) for (const key of ["base", "accent"]) {
        assert(window.document.getElementById(`fluxion-color-${mode}-${key}`).value === expected[mode][key], "Relaunched Settings did not show the persisted palette");
      }
      assert(window.document.getElementById("fluxion-colors-enabled").checked, "Relaunched custom-color toggle was not enabled");
      const theme = window.FluxionTheme.current();
      window.document.getElementById("fluxion-colors-reset").click();
      await wait(() => !window.FluxionColors.current().enabled && !inline(window), "Relaunched Reset did not restore default stylesheet colors");
      assert(window.FluxionTheme.current() === theme, "Reset unexpectedly changed the Gecko theme");
      assert(window.document.getElementById("fluxion-color-dark-base").disabled, "Reset left custom palette fields enabled");
      report.checks.push("clean-relaunch-restores-both-palettes-and-native-dark-chrome", "real-settings-reset-restores-defaults-without-theme-change");
      return;
    }

    assert(!window.FluxionColors.current().enabled && !inline(window), "Fresh isolated profile unexpectedly has custom colors");
    await window.FluxionTheme.set("light");
    const baseline = computed(window, "nav-bar", "backgroundColor");
    const tab = window.gBrowser.addTrustedTab("https://example.org/", { skipAnimation: true });
    window.FluxionUI.setTabWorkspace(tab, window.FluxionUI.currentWorkspace());
    window.FluxionUI.selectTab(tab);
    await wait(() => tab.linkedBrowser.currentURI.spec === "https://example.org/" && !tab.hasAttribute("busy") && tab.label === "Example Domain",
      "Static HTTPS webpage did not load for color-boundary verification", 35000);
    await delay(300);
    const before = await snapshot(tab);
    companion = window.OpenBrowserWindow();
    await wait(() => companion.gBrowserInit?.delayedStartupFinished && companion.FluxionColors && companion.document.getElementById("fluxion-settings"),
      "Companion native window did not initialize its color controls");
    await settings(companion);
    stage("actual-settings-cross-window-colors");
    enabled(companion, true);
    color(companion, "light", "base", expected.light.base);
    color(companion, "light", "accent", expected.light.accent);
    await wait(() => computed(window, "nav-bar", "backgroundColor") === rgb(expected.light.base) &&
      computed(companion, "nav-bar", "backgroundColor") === rgb(expected.light.base), "Actual Appearance changes did not reach both native navigation toolbars");
    const projected = FluxionColorsCore.palette(expected.light);
    assert(computed(window, "urlbar-input", "color") === rgb(projected.ink), "Native address text did not use the readable custom foreground");
    assert(computed(window, "urlbar-background", "backgroundColor") === rgb(projected["bg-raised"]), "Native address background clashes with the custom frame");
    assert(FluxionColorsCore.contrast(projected.ink, projected["bg-raised"]) >= 4.5,
      "The actual projected address field failed readable contrast");
    report.nativeChrome = {
      background: computed(window, "nav-bar", "backgroundColor"),
      addressBackground: computed(window, "urlbar-background", "backgroundColor"),
      addressForeground: computed(window, "urlbar-input", "color"),
      addressContrast: FluxionColorsCore.contrast(projected.ink, projected["bg-raised"]),
    };
    const after = await snapshot(tab);
    report.webpage = { before, after };
    assert(JSON.stringify(before) === JSON.stringify(after), "Changing chrome colors altered the static webpage pixels or reloaded its document");
    report.checks.push("actual-settings-inputs-project-readable-native-toolbars-in-both-windows", "static-https-page-pixels-and-window-global-unchanged-by-custom-colors");
    companion.document.getElementById("fluxion-colors-reset").click();
    await wait(() => !inline(window) && !inline(companion) && computed(window, "nav-bar", "backgroundColor") === baseline,
      "Actual Settings Reset did not restore the original chrome across windows");
    assert(!window.FluxionColors.current().enabled, "Reset kept customization enabled");
    enabled(companion, true);
    for (const mode of ["light", "dark"]) for (const key of ["base", "accent"]) color(companion, mode, key, expected[mode][key]);
    companion.close(); companion = null;
    await delay(300);
    await capture("capture-colors-light");
    await window.FluxionTheme.set("dark");
    await wait(() => computed(window, "nav-bar", "backgroundColor") === rgb(expected.dark.base), "Custom dark frame did not follow the native Gecko theme");
    await delay(300);
    await capture("capture-colors-dark");
    await settings(window);
    await delay(300);
    await capture("capture-colors-settings");
    assert(JSON.stringify(window.FluxionColors.current()) === JSON.stringify(expected), "Seed did not retain the exact palettes for relaunch");
    report.checks.push("cross-window-reset-restores-original-chrome", "both-native-gecko-themes-use-independent-custom-palettes");
  }
  run().then(() => Services.prefs.setStringPref(`${prefix}.health`, "native-custom-colors-and-content-boundary-verified"))
    .catch(error => { Services.prefs.setStringPref(`${prefix}.error`, `${error.message}\n${error.stack}`); Cu.reportError(error); })
    .finally(async () => {
      if (companion && !companion.closed) companion.close();
      Services.prefs.setStringPref(`${prefix}.report`, JSON.stringify(report));
      Services.prefs.savePrefFile(null);
      await delay(100);
      Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit);
    });
})(window);
