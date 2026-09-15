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
    for (const section of ["general", "appearance", "tabs", "search", "ai", "privacy"]) {
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
      const colorNames = new Map();
      for (const mode of ["light", "dark"]) for (const part of ["base", "accent"]) {
        const id = `fluxion-color-${mode}-${part}`;
        colorNames.set(id, `${mode === "light" ? "Light" : "Dark"} ${part} color, six-digit hexadecimal`);
        colorNames.set(`${id}-picker`, `Pick ${mode} ${part} color`);
      }
      let colorFields = 0;
      for (const row of panel.querySelectorAll(".fluxion-setting")) {
        const label = normalize(row.querySelector(".fluxion-setting-copy b")?.textContent);
        const description = normalize(row.querySelector(".fluxion-setting-copy small")?.textContent);
        assert(label && description, `${section} has an unlabeled settings row`);
        for (const control of row.querySelectorAll("input, select, textarea, button, a")) {
          const isAction = ["button", "a"].includes(control.localName);
          // Composite palettes have four distinct inputs per row, not four
          // indistinguishable "Light colors" fields. Keep exact expectations.
          const expectedName = colorNames.get(control.id) ||
            (isAction ? normalize(control.getAttribute("aria-label") || control.textContent) : label);
          if (colorNames.has(control.id)) colorFields++;
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
          if (control.localName === "select" && !control.multiple && !control.hasAttribute("size")) {
            const style = window.getComputedStyle(control);
            assert(style.backgroundImage.includes("chrome://global/skin/icons/arrow-down-12.svg") &&
              Number.parseFloat(style.paddingInlineEnd) >= 28 && style.fill === style.color,
            `${section}/${label} dropdown lost its visible, color-matched disclosure or text clearance`);
          }
          report.controls.push({ section, setting: label, type: control.type || control.localName,
            disabled: Boolean(control.disabled), ...actual, expectedName, expectedDescription });
          if (!isAction) fields++;
          write("report", JSON.stringify(report));
        }
      }
      assert(fields >= 3, `${section} did not expose its expected native fields`);
      if (section === "appearance") assert(colorFields === 8, "Appearance did not expose all eight distinctly named color inputs");
      report.sections.push({ section, fields });
    }
    await verifyBrowserPreferences(root);
    write("report", JSON.stringify(report));
    write("health", "native-control-names-and-descriptions-verified");
    await verifyResponsiveSettings(root);
  }
  async function verifyBrowserPreferences(root) {
    deadline = Date.now() + 45000;
    // Keep this expectation independent of the binding definitions: a wrong
    // native preference or inversion must fail the packaged browser gate.
    const definitions = [
      ["smooth-scrolling", "general", "general.smoothScroll", false],
      ["hardware-acceleration", "general", "layers.acceleration.disabled", true],
      ["ask-download-location", "general", "browser.download.useDownloadDir", true],
      ["save-passwords", "privacy", "signon.rememberSignons", false],
      ["block-popups", "privacy", "dom.disable_open_during_load", false],
      ["https-only", "privacy", "dom.security.https_only_mode", false],
    ];
    const originals = definitions.map(([, , pref]) => ({ pref,
      hadUserValue: Services.prefs.prefHasUserValue(pref), value: Services.prefs.getBoolPref(pref) }));
    assert(originals.every(item => !Services.prefs.prefIsLocked(item.pref)),
      "Browser-preference round trip requires unlocked preferences in its isolated profile");
    let companion;
    let lockedFixturePref;
    const evidence = { controls: [], source: "Actual Settings checkbox clicks, shared Gecko preferences and persisted prefs.js" };
    report.browserPreferences = evidence;
    const show = async section => {
      const panel = root.querySelector(`[data-section="${section}"]`);
      const heading = normalize(panel.querySelector("h2").textContent);
      const navigation = [...root.querySelectorAll(".fluxion-settings-nav button")]
        .find(button => normalize(button.textContent) === heading);
      navigation.click();
      await waitFor(() => !panel.hidden, `Browser controls section ${section} did not open`);
    };
    const checkbox = (owner, id) => owner.document.getElementById(`fluxion-browser-${id}`);
    try {
      for (const [id, section, pref, inverse] of definitions) {
        await show(section);
        const control = checkbox(window, id);
        const original = Services.prefs.getBoolPref(pref);
        assert(control && !control.disabled && control.checked === (inverse ? !original : original),
          `${id} did not read the existing Gecko preference without retuning it`);
        control.scrollIntoView({ block: "center", behavior: "instant" });
        assert(control.getBoundingClientRect().height > 0, `${id} is not visible`);
        control.focus();
        control.click();
        await waitFor(() => Services.prefs.getBoolPref(pref) === !original &&
          control.checked === (inverse ? original : !original), `${id} did not persist its native preference`);
        assert(window.document.activeElement === control, `${id} lost focus during preference synchronization`);
        if (id === "hardware-acceleration") {
          assert(/restart/i.test(root.querySelector('[data-section="general"] .fluxion-settings-note')?.textContent || ""),
            "Hardware acceleration did not disclose its restart requirement");
        }
        evidence.controls.push({ id, pref, inverse, before: original, after: !original });
      }
      Services.prefs.savePrefFile(null);
      evidence.persistenceReads = await waitForPersistedPreferences(evidence.controls);
      evidence.persisted = true;
      companion = window.OpenBrowserWindow();
      await waitFor(() => !companion.closed && companion.FluxionUI && checkbox(companion, "https-only"),
        "Companion browser window did not initialize its custom Settings controls");
      for (const [id, , pref, inverse] of definitions) {
        const expected = Services.prefs.getBoolPref(pref);
        assert(checkbox(companion, id).checked === (inverse ? !expected : expected),
          `${id} did not restore the saved native preference in a new window`);
      }
      evidence.restoredInNewWindow = true;
      for (const section of ["general", "privacy"]) {
        await show(section);
        const reset = window.document.getElementById(`fluxion-browser-reset-${section}`);
        assert(reset && !reset.disabled, `${section} reset must be available after user changes`);
        reset.click();
        for (const [id, owner, pref, inverse] of definitions.filter(item => item[1] === section)) {
          const expected = Services.prefs.getDefaultBranch("").getBoolPref(pref);
          await waitFor(() => !Services.prefs.prefHasUserValue(pref) && Services.prefs.getBoolPref(pref) === expected &&
            checkbox(window, id).checked === (inverse ? !expected : expected) &&
            checkbox(companion, id).checked === (inverse ? !expected : expected),
          `${owner}/${id} did not reset to the Gecko default across both windows`);
        }
      }
      evidence.resetAcrossWindows = true;
      await show("general");
      const managed = checkbox(window, "smooth-scrolling");
      managed.click();
      lockedFixturePref = "general.smoothScroll";
      Services.prefs.lockPref(lockedFixturePref);
      await waitFor(() => managed.disabled && checkbox(companion, "smooth-scrolling").disabled,
        "Live policy lock did not disable the managed control in both windows");
      const lockedValue = Services.prefs.getBoolPref(lockedFixturePref);
      managed.checked = !lockedValue;
      managed.dispatchEvent(new window.Event("change", { bubbles: true }));
      assert(Services.prefs.getBoolPref(lockedFixturePref) === lockedValue && managed.checked === lockedValue,
        "A synthetic change bypassed the native preference lock");
      evidence.policyLockAcrossWindows = true;
    } finally {
      if (lockedFixturePref) Services.prefs.unlockPref(lockedFixturePref);
      for (const { pref, hadUserValue, value } of originals) {
        if (hadUserValue) Services.prefs.setBoolPref(pref, value);
        else Services.prefs.clearUserPref(pref);
      }
      Services.prefs.savePrefFile(null);
      if (companion && !companion.closed) companion.close();
      window.focus();
    }
    write("report", JSON.stringify(report));
  }
  async function waitForPersistedPreferences(expected) {
    // Gecko's service savePrefFile(null) schedules/coalesces background writes;
    // returning does not mean prefs.js already contains the newest snapshot.
    // Observe real disk completion without introducing blocking product I/O.
    let attempts = 0, missing = expected.map(item => item.id);
    do {
      const persisted = await IOUtils.readUTF8(PathUtils.join(PathUtils.profileDir, "prefs.js"));
      attempts++;
      const lines = new Set(persisted.split(/\r?\n/).map(line => line.trim()));
      missing = expected.filter(item => !lines.has(`user_pref("${item.pref}", ${item.after});`) ||
        !Services.prefs.prefHasUserValue(item.pref) || Services.prefs.getBoolPref(item.pref) !== item.after)
        .map(item => item.id);
      if (!missing.length) return attempts;
      await pause();
    } while (Date.now() < deadline);
    throw new Error(`Preferences were not saved to prefs.js after ${attempts} reads: ${missing.join(", ")}`);
  }
  async function seedExclusionList() {
    const memory = window.FluxionMemory;
    const pref = "fluxion.memory.exclusionPolicy";
    const hadPref = Services.prefs.prefHasUserValue(pref);
    const savedPref = hadPref ? Services.prefs.getStringPref(pref) : null;
    const before = memory.exclusionPolicy();
    assert(before.valid && !before.readOnly, "Native Settings fixture requires a valid writable exclusion policy");
    const previousIds = new Set(before.lists.map(item => item.id));
    const fixtureName = "Long private research domain collection";
    const fixtureDomain = "long-sensitive-research-subdomain.settings-layout-fixture.invalid";
    const restore = async () => {
      const current = memory.exclusionPolicy();
      for (const item of current.lists.filter(item => !previousIds.has(item.id) && item.name === fixtureName &&
        item.domains.length === 1 && item.domains[0] === fixtureDomain)) {
        await memory.deleteExclusionList(item.id, memory.exclusionPolicy().revision);
      }
      if (hadPref) Services.prefs.setStringPref(pref, savedPref);
      else Services.prefs.clearUserPref(pref);
      Services.prefs.savePrefFile(null);
    };
    try {
      const saved = await memory.saveExclusionList({ name: fixtureName, enabled: true,
        domains: [fixtureDomain] }, before.revision);
      const created = saved.lists.filter(item => !previousIds.has(item.id));
      assert(created.length === 1, "Actual Memory API did not create one exclusion list");
      return { id: created[0].id, restore };
    } catch (error) { await restore(); throw error; }
  }
  async function verifyResponsiveSettings(root) {
    deadline = Date.now() + 90000;
    const { document, FluxionUI: ui } = window;
    const main = root.querySelector(".fluxion-settings-main");
    const service = Cc["@mozilla.org/accessibilityService;1"].getService(Ci.nsIAccessibilityService);
    const original = { width: window.outerWidth, height: window.outerHeight };
    const exclusionFixture = await seedExclusionList();
    try {
    const principal = Services.scriptSecurityManager.createContentPrincipal(
      Services.io.newURI("https://settings-layout-fixture.invalid"), {});
    for (const [type, expiry, time] of [["camera", Ci.nsIPermissionManager.EXPIRE_NEVER, 0],
      ["microphone", Ci.nsIPermissionManager.EXPIRE_SESSION, 0],
      ["geo", Ci.nsIPermissionManager.EXPIRE_TIME, Date.now() + 86400000]]) {
      Services.perms.addFromPrincipal(principal, type, Ci.nsIPermissionManager.ALLOW_ACTION, expiry, time);
    }
    const geometry = { sizes: [], interactiveControls: 0, permissionExpiry: [], source: "Actual privileged Settings DOM; no external AI requests" };
    report.geometry = geometry;
    const resizeSettings = async size => {
      const before = root.getBoundingClientRect().width;
      assert(before > 0, "Settings must be visible before measuring native window overhead");
      // Measure the existing chrome and frame rather than assuming Settings
      // touches the outer window edge. The content-width assertion stays exact.
      const overhead = window.outerWidth - before;
      const target = Math.round(size + overhead);
      geometry.resizeRequests ||= [];
      geometry.resizeRequests.push({ requestedRootWidth: size, beforeRootWidth: before,
        beforeOuterWidth: window.outerWidth, measuredOverhead: overhead, targetOuterWidth: target });
      window.resizeTo(target, Math.max(850, original.height));
      await waitFor(() => Math.abs(root.getBoundingClientRect().width - size) < 2,
        `Settings root did not reach ${size}px with ${overhead}px measured window overhead`);
    };
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
      await resizeSettings(size);
      const summary = { rootWidth: root.getBoundingClientRect().width, sections: [] };
      geometry.sizes.push(summary);
      for (const navigation of root.querySelectorAll(".fluxion-settings-nav button, .fluxion-settings-nav h1")) {
        check(navigation, "navigation", size, root);
      }
      for (const panel of sections) {
        await show(panel);
        const section = panel.dataset.section;
        if (section === "search") {
          const editor = panel.querySelector(`[data-exclusion-list-id="${exclusionFixture.id}"]`);
          assert(editor, "Actual saved exclusion list was not rendered in Settings");
          const disclosure = editor.querySelector("summary");
          if (!editor.open) disclosure.click();
          await waitFor(() => editor.open && editor.querySelector("textarea").getBoundingClientRect().height > 0,
            "Saved exclusion-list disclosure did not open");
          check(disclosure, "exclusion-list-disclosure", size);
          const fields = [];
          for (const control of editor.querySelectorAll("input, textarea, button")) {
            const expectedName = normalize(control.getAttribute("aria-label") || control.textContent);
            assert(expectedName && !control.disabled, "Exclusion-list control is unnamed or unexpectedly disabled");
            control.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
            await waitFor(() => normalize(service.getAccessibleFor(control)?.name) === expectedName,
              `Native exclusion-list accessible name does not match ${expectedName}`);
            control.focus();
            assert(document.activeElement === control, `Exclusion-list control cannot receive keyboard focus: ${expectedName}`);
            if (control.type === "checkbox") {
              const bounds = rect(control);
              assert(bounds.width > 0 && bounds.width <= 20 && bounds.height > 0 && bounds.height <= 20,
                `Exclusion-list checkbox stretched beyond native size: ${JSON.stringify(bounds)}`);
            }
            fields.push({ ...check(control, "exclusion-list", size), accessibleName: expectedName, focused: true });
          }
          assert(fields.length === 6, "Exclusion-list editor omitted name/domains/enabled or Save/Cancel/Remove");
          geometry.exclusionLists ||= [];
          geometry.exclusionLists.push({ size, listId: exclusionFixture.id, fields,
            inputSource: "DOM focus and actual native accessibility; not OS keyboard injection" });
        }
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
          const renamedName = "Renamed narrow research lab";
          assert(renamedName.length <= rename.maxLength, "Workspace fixture exceeds the real name field limit");
          rename.value = renamedName;
          rename.dispatchEvent(new window.Event("input", { bubbles: true }));
          rename.dispatchEvent(new window.Event("change", { bubbles: true }));
          await waitFor(() => ui.workspaces().some(item => item.name === renamedName), "Narrow workspace rename failed");
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
      await resizeSettings(320);
      await show(sections.find(panel => panel.dataset.section === "workspaces"));
      root.querySelector('.fluxion-workspace-create input').focus();
      await captureNarrowSettings("workspaces");
      await show(sections.find(panel => panel.dataset.section === "search"));
      const editor = root.querySelector(`[data-exclusion-list-id="${exclusionFixture.id}"]`);
      assert(editor, "Seeded exclusion list disappeared before screenshot");
      if (!editor.open) editor.querySelector("summary").click();
      const name = editor.querySelector('input[type="text"]');
      await waitFor(() => editor.open && name.getBoundingClientRect().height > 0,
        "Exclusion-list screenshot editor did not become visible");
      name.focus();
      editor.scrollIntoView({ block: "start", inline: "nearest", behavior: "instant" });
      assert(document.activeElement === name, "Exclusion-list screenshot lost its field focus");
      await captureNarrowSettings("exclusion-lists");
      geometry.screenshots = ["narrow-workspaces.png", "narrow-exclusion-lists.png"];
    }
    window.resizeTo(original.width, original.height);
    write("report", JSON.stringify(report));
    } finally {
      window.resizeTo(original.width, original.height);
      await exclusionFixture.restore();
    }
    write("geometry.health", "all-settings-sections-fit-320-and-600px");
  }
  async function captureNarrowSettings(surface) {
    const name = surface === "workspaces" ? "capture" : surface === "exclusion-lists" ? "capture-exclusions" : null;
    assert(name, "Unknown Settings screenshot surface");
    const driver = PathUtils.parent(PathUtils.profileDir);
    await IOUtils.writeUTF8(PathUtils.join(driver, `${name}.ready`), "ready");
    do {
      if (await IOUtils.exists(PathUtils.join(driver, `${name}.sent`))) return;
      assert(Date.now() < deadline, `Narrow ${surface} screenshot driver did not respond`);
      await pause();
    } while (true);
  }
  run().catch(error => {
    write("report", JSON.stringify(report));
    write("error", `${error?.message || error}\n${error?.stack || ""}`);
    Cu.reportError(error);
  });
})(window);
