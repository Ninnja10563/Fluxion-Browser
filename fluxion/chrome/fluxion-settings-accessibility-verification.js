/* global Services, SessionStore, Cc, Ci, Cu */
(function verifySettingsAccessibility(window) {
  "use strict";
  if (Services.env.get("FLUXION_SETTINGS_ACCESSIBILITY_TEST") !== "1") return;
  const prefix = "fluxion.settingsAccessibility";
  if (Services.prefs.getBoolPref(`${prefix}.claimed`, false)) return;
  Services.prefs.setBoolPref(`${prefix}.claimed`, true);
  const report = { engine: "Gecko nsIAccessibilityService", sections: [], controls: [] };
  const normalize = text => String(text || "").replace(/\s+/g, " ").trim();
  const write = (key, value) => {
    Services.prefs.setStringPref(`${prefix}.${key}`, value);
    Services.prefs.savePrefFile(null);
  };
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const pause = () => new Promise(resolve => window.setTimeout(resolve, 50));
  let deadline;
  async function waitFor(predicate, message) {
    do { if (predicate()) return; await pause(); } while (Date.now() < deadline);
    throw new Error(message);
  }
  async function run() {
    await SessionStore.promiseAllWindowsRestored;
    deadline = Date.now() + 30000;
    const service = Cc["@mozilla.org/accessibilityService;1"].getService(Ci.nsIAccessibilityService);
    const tab = window.gBrowser.addTrustedTab("about:preferences?fluxion=general", { skipAnimation: true });
    window.FluxionUI.setTabWorkspace(tab, window.FluxionUI.currentWorkspace());
    window.gBrowser.selectedTab = tab;
    const root = window.document.getElementById("fluxion-settings");
    await waitFor(() => tab.linkedBrowser.currentURI.spec === "about:preferences?fluxion=general" &&
      root && !root.hidden && root.getBoundingClientRect().height > 0, "Native Settings route did not become visible");
    for (const section of ["general", "appearance", "tabs", "search", "ai"]) {
      const panel = root.querySelector(`[data-section="${section}"]`);
      assert(panel, `Missing ${section} panel`);
      const heading = normalize(panel.querySelector("h2").textContent);
      const navigation = [...root.querySelectorAll(".fluxion-settings-nav button")]
        .find(button => normalize(button.textContent) === heading);
      assert(navigation, `Missing ${section} navigation action`);
      navigation.click();
      await waitFor(() => !panel.hidden && panel.getBoundingClientRect().height > 0 &&
        navigation.getAttribute("aria-current") === "true", `${section} did not become the visible section`);
      let fields = 0;
      for (const row of panel.querySelectorAll(".fluxion-setting")) {
        const label = normalize(row.querySelector(".fluxion-setting-copy b")?.textContent);
        const description = normalize(row.querySelector(".fluxion-setting-copy small")?.textContent);
        assert(label && description, `${section} has an unlabeled settings row`);
        for (const control of row.querySelectorAll("input, select, textarea, button, a")) {
          const isAction = ["button", "a"].includes(control.localName);
          const expectedName = isAction ? normalize(control.getAttribute("aria-label") || control.textContent) : label;
          const expectedDescription = !isAction || control.classList.contains("fluxion-settings-control") ? description : null;
          control.scrollIntoView({ block: "center", behavior: "instant" });
          let actual = null;
          try {
            await waitFor(() => {
              const accessible = service.getAccessibleFor(control);
              actual = accessible ? { name: normalize(accessible.name), description: normalize(accessible.description) } : null;
              return actual?.name === expectedName && (expectedDescription === null || actual.description === expectedDescription);
            }, `${section}/${label}: native accessible name or description did not match visible copy`);
          } catch (error) {
            throw new Error(`${error.message}: ${JSON.stringify({ actual, expectedName, expectedDescription,
              tag: control.localName, disabled: control.disabled, connected: control.isConnected })}`);
          }
          assert(control.getBoundingClientRect().height > 0, `${section}/${label} control is not rendered`);
          report.controls.push({ section, setting: label, type: control.type || control.localName,
            disabled: Boolean(control.disabled), ...actual, expectedName, expectedDescription });
          if (!isAction) fields++;
          write("report", JSON.stringify(report));
        }
      }
      assert(fields >= 3, `${section} did not expose its expected native fields`);
      report.sections.push({ section, fields });
    }
    write("report", JSON.stringify(report));
    write("health", "native-control-names-and-descriptions-verified");
  }
  run().catch(error => {
    write("error", `${error?.message || error}\n${error?.stack || ""}`);
    Cu.reportError(error);
  });
})(window);
