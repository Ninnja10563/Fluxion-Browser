/* global Services, SessionStore, PathUtils, IOUtils, Cc, Ci, Cu */
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
    assert(/\/fluxion-settings-accessibility\.[^/]+\/profile\/?$/.test(PathUtils.profileDir), "Settings verification requires its isolated profile");
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
    await verifyResponsiveSettings(root);
  }
  async function verifyResponsiveSettings(root) {
    deadline = Date.now() + 90000;
    const { document, FluxionUI: ui } = window;
    const main = root.querySelector(".fluxion-settings-main");
    const service = Cc["@mozilla.org/accessibilityService;1"].getService(Ci.nsIAccessibilityService);
    const original = { width: window.outerWidth, height: window.outerHeight };
    const principal = Services.scriptSecurityManager.createContentPrincipal(
      Services.io.newURI("https://settings-layout-fixture.invalid"), {});
    for (const [type, expiry, time] of [["camera", Ci.nsIPermissionManager.EXPIRE_NEVER, 0],
      ["microphone", Ci.nsIPermissionManager.EXPIRE_SESSION, 0],
      ["geo", Ci.nsIPermissionManager.EXPIRE_TIME, Date.now() + 86400000]]) {
      Services.perms.addFromPrincipal(principal, type, Ci.nsIPermissionManager.ALLOW_ACTION, expiry, time);
    }
    const geometry = { sizes: [], interactiveControls: 0, permissionExpiry: [], source: "Actual privileged Settings DOM; no external AI requests" };
    report.geometry = geometry;
    const sections = [...root.querySelectorAll("[data-section]")];
    assert(sections.length >= 10, "Settings geometry corpus omitted sections");
    const show = async panel => {
      const title = normalize(panel.querySelector("h2").textContent);
      const navigation = [...root.querySelectorAll(".fluxion-settings-nav button")].find(node => normalize(node.textContent) === title);
      assert(navigation, `Missing real navigation button for ${title}`);
      navigation.click();
      await waitFor(() => !panel.hidden && navigation.getAttribute("aria-current") === "true", `Cannot show ${title}`);
      main.scrollTop = 0;
    };
    const rect = node => {
      const value = node.getBoundingClientRect();
      return { left: value.left, right: value.right, width: value.width, height: value.height };
    };
    const visible = node => !node.closest("[hidden]") && window.getComputedStyle(node).display !== "none" &&
      window.getComputedStyle(node).visibility !== "hidden";
    const check = (node, section, size, area = main) => {
      const actual = rect(node), available = rect(area);
      const evidence = { size, section, name: node.getAttribute("aria-label") || node.textContent?.slice(0, 90) || node.localName,
        actual, available, scrollWidth: main.scrollWidth, clientWidth: main.clientWidth };
      assert(actual.width > 0 && actual.height > 0 && actual.left >= available.left - 2 && actual.right <= available.right + 2,
        `Settings control clipped: ${JSON.stringify(evidence)}`);
      return evidence;
    };
    ui.setSidebarState("expanded");
    for (const size of [320, 600]) {
      window.resizeTo(size + window.FluxionSidebarWidth.effectiveWidth(), Math.max(850, original.height));
      await waitFor(() => Math.abs(root.getBoundingClientRect().width - size) < 2, `Settings root did not reach ${size}px`);
      const summary = { rootWidth: root.getBoundingClientRect().width, sections: [] };
      geometry.sizes.push(summary);
      for (const navigation of root.querySelectorAll(".fluxion-settings-nav button, .fluxion-settings-nav h1")) {
        check(navigation, "navigation", size, root);
      }
      for (const panel of sections) {
        await show(panel);
        const section = panel.dataset.section;
        if (size === 320 && section === "workspaces") {
          const current = ui.workspaces().find(item => item.id === ui.currentWorkspace());
          const currentName = [...panel.querySelectorAll(".fluxion-settings-workspace-name")].find(node => node.value === current.name);
          assert(currentName, "Current workspace editor is missing");
          const activeName = "Long current research workspace";
          currentName.value = activeName;
          currentName.dispatchEvent(new window.Event("input", { bubbles: true }));
          currentName.dispatchEvent(new window.Event("change", { bubbles: true }));
          await waitFor(() => ui.workspaces().find(item => item.id === current.id)?.name === activeName, "Current workspace rename failed");
          const form = panel.querySelector(".fluxion-workspace-create"), name = form.querySelector("input");
          name.value = "Long research workspace name";
          form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
          await waitFor(() => ui.workspaces().some(item => item.name === "Long research workspace name"), "Narrow workspace form failed to create workspace");
          const rename = [...panel.querySelectorAll(".fluxion-settings-workspace-name")].find(node => node.value === "Long research workspace name");
          assert(rename, "Created workspace name field is missing");
          rename.value = "Renamed narrow research workspace";
          rename.dispatchEvent(new window.Event("input", { bubbles: true }));
          rename.dispatchEvent(new window.Event("change", { bubbles: true }));
          await waitFor(() => ui.workspaces().some(item => item.name === "Renamed narrow research workspace"), "Narrow workspace rename failed");
          geometry.workspaceEdit = "actual-create-form-and-rename-control-persisted";
        }
        let count = 0;
        for (const control of panel.querySelectorAll("input, select, textarea, button, a[href]")) {
          if (!visible(control)) continue;
          control.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
          check(control, section, size); count++;
        }
        if (section === "permissions") {
          const siteResets = [...panel.querySelectorAll(".fluxion-permission-site-head button")]
            .filter(node => node.closest(".fluxion-permission-site").textContent.includes("settings-layout-fixture.invalid"));
          assert(siteResets.length === 1, "Fixture permission site action was missing or ambiguous");
          for (const reset of siteResets) {
            const label = normalize(reset.getAttribute("aria-label"));
            assert(label.includes("https://settings-layout-fixture.invalid") && /\([^()]+\)$/.test(label),
              "Permission site action omitted its origin or browsing context");
            reset.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
            await waitFor(() => normalize(service.getAccessibleFor(reset)?.name) === label,
              "Native accessible Reset site name did not expose origin and context");
          }
          const expiries = [...panel.querySelectorAll(".fluxion-permission-expiry")];
          assert(expiries.length >= 3, "Genuine native permission records did not render");
          for (const expiry of expiries) {
            assert(visible(expiry) && normalize(expiry.textContent), "Narrow layout hid permission expiry information");
            expiry.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
            check(expiry, section, size);
            geometry.permissionExpiry.push({ size, text: normalize(expiry.textContent) });
          }
        }
        assert(count > 0, `${section} has no visible interactive controls`);
        for (const heading of panel.querySelectorAll("h2")) check(heading, section, size);
        assert(main.scrollWidth <= main.clientWidth + 2,
          `${section}/${size}: Settings requires horizontal scrolling (${main.scrollWidth}/${main.clientWidth})`);
        summary.sections.push({ section, controls: count, mainWidth: main.clientWidth, scrollWidth: main.scrollWidth });
        geometry.interactiveControls += count;
        write("report", JSON.stringify(report));
      }
    }
    if (Services.env.get("FLUXION_SETTINGS_ACCESSIBILITY_ARTIFACT_DIR")) {
      window.resizeTo(320 + window.FluxionSidebarWidth.effectiveWidth(), Math.max(850, original.height));
      await waitFor(() => Math.abs(root.getBoundingClientRect().width - 320) < 2, "Screenshot did not reach narrow width");
      await show(sections.find(panel => panel.dataset.section === "workspaces"));
      root.querySelector('.fluxion-workspace-create input').focus();
      const driver = PathUtils.parent(PathUtils.profileDir);
      await IOUtils.writeUTF8(PathUtils.join(driver, "capture.ready"), "ready");
      do {
        if (await IOUtils.exists(PathUtils.join(driver, "capture.sent"))) break;
        assert(Date.now() < deadline, "Narrow Settings screenshot driver did not respond"); await pause();
      } while (true);
    }
    window.resizeTo(original.width, original.height);
    write("report", JSON.stringify(report));
    write("geometry.health", "all-settings-sections-fit-320-and-600px");
  }
  run().catch(error => {
    write("report", JSON.stringify(report));
    write("error", `${error?.message || error}\n${error?.stack || ""}`);
    Cu.reportError(error);
  });
})(window);
