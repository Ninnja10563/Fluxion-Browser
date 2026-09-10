/* global Services, SessionStore, ChromeUtils, Ci, Cu */
(function verifyUpdates(window) {
  "use strict";
  if (Services.env.get("FLUXION_UPDATE_TEST") !== "1") return;
  const prefix = "fluxion.updateVerification";
  if (Services.prefs.getBoolPref(`${prefix}.claimed`, false)) return;
  Services.prefs.setBoolPref(`${prefix}.claimed`, true);
  const endpoint = "https://api.github.com/repos/Ninnja10563/Fluxion-Browser/releases?per_page=100";
  const report = { requests: 0, assetRequests: 0, requestHeaders: [] };
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const pause = ms => new Promise(resolve => window.setTimeout(resolve, ms));
  const waitFor = async (predicate, message) => {
    const deadline = Date.now() + 20000;
    do { if (predicate()) return; await pause(50); } while (Date.now() < deadline);
    throw new Error(message);
  };
  const observer = { observe(subject) {
    const channel = subject.QueryInterface(Ci.nsIHttpChannel);
    const url = channel.URI.spec;
    if (url.startsWith("https://github.com/Ninnja10563/Fluxion-Browser/releases/download/")) report.assetRequests++;
    if (url !== endpoint) return;
    report.requests++;
    const header = name => { try { return channel.getRequestHeader(name); } catch (_) { return ""; } };
    report.requestHeaders.push({ cookie: Boolean(header("Cookie")), authorization: Boolean(header("Authorization")),
      referrer: Boolean(header("Referer")), method: channel.requestMethod });
  } };
  Services.obs.addObserver(observer, "http-on-modify-request");
  async function run() {
    await SessionStore.promiseAllWindowsRestored;
    const { Downloads } = ChromeUtils.importESModule("resource://gre/modules/Downloads.sys.mjs");
    const downloads = await Downloads.getList(Downloads.ALL);
    const beforeDownloads = (await downloads.getAll()).length;
    const tab = window.gBrowser.addTrustedTab("about:preferences?fluxion=about", { skipAnimation: true });
    window.FluxionUI.setTabWorkspace(tab, window.FluxionUI.currentWorkspace());
    window.gBrowser.selectedTab = tab;
    const get = suffix => window.document.getElementById(`fluxion-update-${suffix}`);
    await waitFor(() => get("check")?.getBoundingClientRect().height > 0, "About update controls did not become visible");
    for (const id of ["check", "releases"]) {
      const range = window.document.createRange();
      range.selectNodeContents(get(id));
      assert(range.getClientRects().length === 1, `Update ${id} action label wrapped instead of fitting its compact control`);
      assert(get(id).getAttribute("aria-label"), `Update ${id} action has no explicit accessible name`);
    }
    report.compactActionLabels = true;
    assert(get("status").dataset.state === "idle", "Opening About started an update check automatically");
    await pause(250);
    assert(report.requests === 0 && report.assetRequests === 0, "Update traffic occurred before the user action");
    const tabs = window.gBrowser.tabs.length;
    get("check").click();
    assert(get("check").disabled && get("status").dataset.state === "checking", "Check action did not show immediate busy feedback");
    await waitFor(() => !get("check").disabled, "Update check did not settle within its deadline");
    const state = get("status").dataset.state;
    report.state = state;
    report.installed = get("status").dataset.installed;
    report.latest = get("status").dataset.latest;
    report.message = get("status").textContent;
    assert(["current", "available"].includes(state), `Real release check failed: ${report.message}`);
    assert(report.installed === Services.env.get("FLUXION_EXPECTED_RELEASE"), "Installed release or preview channel did not match the product package");
    assert(report.latest && report.message.includes(report.latest), "Latest compatible version was not displayed");
    assert(get("download").hidden === (state !== "available"), "Download action does not match update availability");
    assert(report.requests === 1 && report.requestHeaders.every(headers => headers.method === "GET" &&
      !headers.cookie && !headers.authorization && !headers.referrer), "Update request included credentials, referrer, or duplicates");
    assert(report.assetRequests === 0 && (await downloads.getAll()).length === beforeDownloads,
      "Checking for updates started an automatic asset download");
    assert(window.gBrowser.tabs.length === tabs && window.gBrowser.selectedTab === tab,
      "Checking for updates navigated away from About");
  }
  run().then(() => {
    Services.prefs.setStringPref(`${prefix}.health`, "explicit-release-check-without-automatic-download");
  }).catch(error => {
    Services.prefs.setStringPref(`${prefix}.error`, `${error.message}\n${error.stack || ""}`);
    Cu.reportError(error);
  }).finally(() => {
    Services.obs.removeObserver(observer, "http-on-modify-request");
    Services.prefs.setStringPref(`${prefix}.report`, JSON.stringify(report));
    Services.prefs.savePrefFile(null);
  });
})(window);
