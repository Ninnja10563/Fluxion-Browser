/* global Services, SessionStore, IOUtils, PathUtils, Ci, Cu */
(function verifyBrandingUpgrade(window) {
  "use strict";
  const phase = Services.env.get("FLUXION_BRANDING_CACHE_PHASE");
  if (!["seed", "legacy", "repaired", "warm"].includes(phase)) return;
  const driver = Services.env.get("FLUXION_BRANDING_CACHE_DRIVER");
  const prefix = "fluxion.branding.upgrade";
  const assert = (value, message) => { if (!value) throw Error(message); };
  const delay = ms => new Promise(resolve => window.setTimeout(resolve, ms));
  const wait = async (condition, message) => {
    const deadline = Date.now() + 20000;
    while (!(await condition())) { assert(Date.now() < deadline, message); await delay(50); }
  };
  const report = { phase, nativeLabels: [], windows: {} };
  async function run() {
    assert(/\/fluxion-branding-upgrade\.[^/]+\/profile$/.test(PathUtils.profileDir), "Owned upgrade profile required");
    assert(driver === PathUtils.parent(PathUtils.profileDir), "Upgrade driver/profile mismatch");
    Services.prefs.clearUserPref(`${prefix}.health`);
    Services.prefs.clearUserPref(`${prefix}.error`);
    Services.prefs.setBoolPref("browser.warnOnQuit", false);
    Services.prefs.setBoolPref("browser.tabs.warnOnClose", false);
    await SessionStore.promiseAllWindowsRestored;
    await wait(() => window.gBrowserInit.delayedStartupFinished && window.FluxionUI, "Startup did not settle");
    if (phase === "seed") Services.prefs.setStringPref(`${prefix}.sentinel`, "retained across chrome cache invalidation");
    assert(Services.prefs.getStringPref(`${prefix}.sentinel`, "") === "retained across chrome cache invalidation", "Existing profile state was lost");
    report.cachePending = Services.env.get("FLUXION_CHROME_CACHE_PENDING");
    if (phase === "repaired") assert(report.cachePending === "1", "Upgrade did not request native cache invalidation");
    if (phase === "warm") assert(report.cachePending === "0", "Warm launch discarded the startup cache again");
    const expected = ["seed", "legacy"].includes(phase) ? "Firefox" : "Fluxion";
    for (const [name, host] of [["browser", window], ["hidden", Services.appShell.hiddenDOMWindow]]) {
      report.windows[name] = Object.fromEntries(["aboutName", "menu_mac_hide_app", "menu_FileQuitItem"].map(id =>
        [id, String(host.document.getElementById(id)?.getAttribute("label") || "").replace(/[\u2066-\u2069]/g, "")]));
    }
    await IOUtils.writeUTF8(PathUtils.join(driver, "cache-menu.ready"), phase);
    await wait(() => IOUtils.exists(PathUtils.join(driver, "cache-menu.sent")), "Native upgrade menu not captured");
    report.nativeLabels = (await IOUtils.readUTF8(PathUtils.join(driver, "cache-menu.txt"))).trim().split(/\r?\n/);
    for (const action of ["About", "Hide", "Quit"]) {
      assert(report.nativeLabels.includes(`${action} ${expected}`), `${phase}: native ${action} menu must say ${expected}`);
    }
    const brand = Services.strings.createBundle("chrome://branding/locale/brand.properties");
    report.currentResourceBrand = brand.GetStringFromName("brandShortName");
    assert(report.currentResourceBrand === (phase === "seed" ? "Firefox" : "Fluxion"), "Candidate resource identity is wrong");
    if (phase === "repaired" || phase === "warm") {
      await wait(async () => (await IOUtils.readUTF8(PathUtils.join(PathUtils.profileDir, ".fluxion-chrome-cache"))) ===
        `${Services.env.get("FLUXION_CHROME_CACHE_ID")}\n`, "Native invalidation was not acknowledged");
    }
    // Allow Gecko's normal cache writer and clean shutdown to persist the
    // translated prototype; do not inject labels or fabricate cache bytes.
    await delay(1500);
    Services.prefs.setStringPref(`${prefix}.health`, phase);
  }
  run().catch(error => {
    Services.prefs.setStringPref(`${prefix}.error`, String(error?.stack || error)); Cu.reportError(error);
  }).finally(() => {
    Services.prefs.setStringPref(`${prefix}.report`, JSON.stringify(report));
    Services.prefs.savePrefFile(null);
    Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit);
  });
})(window);
