/* global Services, SessionStore, Ci, Cu */
(function verifyExternalOpen(window) {
  "use strict";
  if (Services.env.get("FLUXION_EXTERNAL_OPEN_TEST") !== "1") return;
  const prefix = "fluxion.externalOpen";
  if (Services.prefs.getBoolPref(`${prefix}.claimed`, false)) return;
  Services.prefs.setBoolPref(`${prefix}.claimed`, true);
  Services.prefs.setIntPref(`${prefix}.pid`, Services.appinfo.processID);
  Services.prefs.savePrefFile(null);
  const origin = Services.env.get("FLUXION_EXTERNAL_OPEN_ORIGIN");
  const fileURL = Services.env.get("FLUXION_EXTERNAL_OPEN_FILE_URL");
  const report = { transport: "macOS LaunchServices open -a", processID: Services.appinfo.processID, checks: [] };
  const pause = () => new Promise(resolve => window.setTimeout(resolve, 50));
  const write = (name, value) => {
    Services.prefs.setStringPref(`${prefix}.${name}`, value);
    Services.prefs.savePrefFile(null);
  };
  async function observeSelected(url, title, label) {
    const deadline = Date.now() + 30000;
    do {
      for (const browserWindow of Services.wm.getEnumerator("navigator:browser")) {
        const tab = browserWindow.gBrowser?.selectedTab;
        const browser = tab?.linkedBrowser;
        let matches = browser?.currentURI?.spec === url;
        if (!matches && url === fileURL && browser?.currentURI?.scheme === "file") {
          // LaunchServices may canonicalize /var symlinks or filesystem Unicode
          // spelling. Compare actual local-file identity, not cosmetic URI text.
          const actualFile = browser.currentURI.QueryInterface(Ci.nsIFileURL).file;
          const expectedFile = Services.io.newURI(fileURL).QueryInterface(Ci.nsIFileURL).file;
          actualFile.normalize();
          expectedFile.normalize();
          // APFS resolves composed and decomposed Unicode names to the same
          // file, but nsIFile.equals can still compare their path spellings.
          matches = actualFile.exists() && expectedFile.exists() &&
            actualFile.path.normalize("NFC") === expectedFile.path.normalize("NFC");
        }
        // Only observe actual Gecko state. Never navigate or manufacture tabs
        // here: the shell must deliver every URL/file through LaunchServices.
        if (matches && !tab.hasAttribute("busy") && browser.contentTitle === title) {
          report.checks.push({ label, url: browser.currentURI.spec, title: browser.contentTitle, selected: true,
            windowCount: [...Services.wm.getEnumerator("navigator:browser")].length });
          write("report", JSON.stringify(report));
          write("stage", label);
          return;
        }
      }
      await pause();
    } while (Date.now() < deadline);
    const tabs = [...Services.wm.getEnumerator("navigator:browser")].flatMap(browserWindow =>
      [...(browserWindow.gBrowser?.tabs || [])].map(tab => ({
        url: tab.linkedBrowser?.currentURI?.spec, title: tab.linkedBrowser?.contentTitle,
        selected: tab === browserWindow.gBrowser.selectedTab, busy: tab.hasAttribute("busy"),
      })));
    throw new Error(`${label} did not arrive in a selected rendered tab: ${JSON.stringify(tabs)}`);
  }
  async function run() {
    if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin) || !fileURL.startsWith("file:///")) {
      throw new Error("External-open verifier requires isolated loopback and local-file targets");
    }
    await SessionStore.promiseAllWindowsRestored;
    await observeSelected(`${origin}/`, "Fluxion browsing fixture", "cold-url-rendered");
    await observeSelected(`${origin}/upload`, "Fluxion upload form", "warm-url-rendered");
    await observeSelected(fileURL, "Fluxion external file — JavaScript ran", "local-file-rendered");
    await observeSelected(`${origin}/?fluxion-external-cli=1`, "Fluxion browsing fixture", "direct-cli-url-rendered");
    if (Services.appinfo.processID !== report.processID) throw new Error("External-open process changed unexpectedly");
    write("health", "launchservices-cold-warm-unicode-file-and-cli-rendered");
  }
  run().catch(error => {
    write("error", `${error?.message || error}\n${error?.stack || ""}`);
    Cu.reportError(error);
  });
})(window);
