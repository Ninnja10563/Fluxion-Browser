/* global Services, SessionStore, IOUtils, Cu */
(function verifyShortcutEditing(window) {
  "use strict";
  if (Services.env.get("FLUXION_SHORTCUT_TEST") !== "1") return;
  const prefix = "fluxion.shortcutVerification";
  if (Services.prefs.getBoolPref(`${prefix}.claimed`, false)) return;
  Services.prefs.setBoolPref(`${prefix}.claimed`, true);
  const report = { eventSource: "synthetic-DOM-keyboard-events-in-packaged-Gecko", nativeOSKeyboardTest: false,
    keyboardEventTrustedFlags: [], nativeKeys: [], checks: [] };
  const { document, gBrowser } = window;
  const assert = (value, message) => { if (!value) throw new Error(message); };
  let companion;
  const waitFor = async (check, message) => {
    const deadline = Date.now() + 20000;
    do {
      const value = await check(); if (value) return value;
      await new Promise(resolve => window.setTimeout(resolve, 50));
    } while (Date.now() < deadline);
    throw new Error(message);
  };
  const stage = value => {
    Services.prefs.setStringPref(`${prefix}.stage`, value);
    Services.prefs.savePrefFile(null);
  };
  const focusControl = async (control, label) => {
    control.focus();
    await waitFor(() => document.activeElement === control, `${label} did not receive real DOM focus`);
  };
  async function verifyLivePreferences() {
    stage("live-general-and-appearance-preferences");
    const companionSettings = companion.gBrowser.addTrustedTab("about:preferences", { skipAnimation: true });
    companion.FluxionUI.setTabWorkspace(companionSettings, companion.FluxionUI.currentWorkspace());
    companion.gBrowser.selectedTab = companionSettings;
    await waitFor(() => companionSettings.linkedBrowser.currentURI.spec === "about:preferences" &&
      !companionSettings.hasAttribute("busy") && companion.document.getElementById("fluxion-settings")?.hidden === false,
    "Companion Settings did not become visible");
    const section = async (owner, name) => {
      const button = [...owner.document.querySelectorAll(".fluxion-settings-nav button")]
        .find(node => node.textContent === name);
      assert(button, `Missing ${name} Settings navigation`);
      button.click();
      return waitFor(() => {
        const panel = owner.document.querySelector(`.fluxion-settings-section[data-section="${name.toLowerCase()}"]`);
        return panel?.getBoundingClientRect().height > 0 && panel;
      }, `${name} Settings did not become visible`);
    };
    const field = (panel, title) => {
      const row = [...panel.querySelectorAll(".fluxion-setting")]
        .find(node => node.querySelector(".fluxion-setting-copy b")?.textContent === title);
      const control = row?.querySelector("input, select");
      assert(control, `Missing live preference field: ${title}`);
      return control;
    };
    const change = (owner, control, value) => {
      if (control.type === "checkbox") control.checked = value;
      else control.value = value;
      control.dispatchEvent(new owner.Event("change", { bubbles: true }));
    };
    const appearance = await section(window, "Appearance");
    const remoteAppearance = await section(companion, "Appearance");
    const sidebar = field(appearance, "Flow sidebar");
    window.FluxionUI.setSidebarState("expanded");
    const cycle = document.querySelector('.fluxion-workspaces > button.fluxion-icon-button');
    assert(cycle, "The shipped Flow sidebar toggle button is missing");
    assert(cycle.getAttribute("aria-label") === "Collapse sidebar",
      "Expanded sidebar control does not describe its next action");
    cycle.click();
    await waitFor(() => sidebar.value === "focus" && field(remoteAppearance, "Flow sidebar").value === "focus",
      "Toolbar sidebar change left an open Settings window stale");
    assert(cycle.getAttribute("aria-label") === "Expand sidebar",
      "Collapsed sidebar control does not describe its next action");
    change(companion, field(remoteAppearance, "Flow sidebar"), "expanded");
    change(companion, field(remoteAppearance, "Tab density"), "roomy");
    change(companion, field(remoteAppearance, "Interface motion"), false);
    await waitFor(() => sidebar.value === "expanded" && field(appearance, "Tab density").value === "roomy" &&
      !field(appearance, "Interface motion").checked, "Companion Appearance edits left Settings controls stale");
    report.checks.push("toolbar-and-cross-window-appearance-controls-refresh");

    const general = await section(window, "General");
    const remoteGeneral = await section(companion, "General");
    change(companion, field(remoteGeneral, "When Fluxion starts"), "0");
    change(companion, field(remoteGeneral, "Open links in tabs"), false);
    change(companion, field(remoteGeneral, "Home page"), "https://remote.example/initial");
    const homepage = field(general, "Home page");
    await waitFor(() => field(general, "When Fluxion starts").value === "0" &&
      !field(general, "Open links in tabs").checked && homepage.value === "https://remote.example/initial",
    "Companion General edits left Settings controls stale");
    Services.focus.focusedWindow = window;
    await waitFor(() => Services.focus.activeWindow === window && document.hasFocus(),
      "Primary Settings window did not regain native focus");
    await focusControl(homepage, "Homepage draft");
    homepage.value = "https://draft.example/my-page";
    homepage.dispatchEvent(new window.Event("input", { bubbles: true }));
    change(companion, field(remoteGeneral, "Home page"), "https://remote.example/changed");
    assert(homepage.value === "https://draft.example/my-page" && document.activeElement === homepage,
      "An external preference update replaced or defocused an unsaved homepage draft");
    homepage.dispatchEvent(new window.Event("change", { bubbles: true }));
    await waitFor(() => Services.prefs.getStringPref("browser.startup.homepage") === "https://draft.example/my-page" &&
      field(remoteGeneral, "Home page").value === "https://draft.example/my-page",
    "Committing the local homepage draft did not update the other Settings window");
    await focusControl(field(general, "When Fluxion starts"), "Committed draft blur destination");
    change(companion, field(remoteGeneral, "Home page"), "about:blank");
    await waitFor(() => homepage.value === "about:blank", "Committed homepage remained protected as a stale draft");
    report.checks.push("cross-window-general-refresh-and-focused-homepage-draft-preservation");
    Services.prefs.setStringPref(`${prefix}.preferences.health`, "live-general-appearance-and-homepage-draft-verified");
  }
  async function run() {
    await SessionStore.promiseAllWindowsRestored;
    await waitFor(() => window.FluxionUI && window.FluxionShortcuts, "Shortcut registry did not initialize");
    const settingsTab = gBrowser.addTrustedTab("about:preferences?fluxion=keyboard", { skipAnimation: true });
    window.FluxionUI.setTabWorkspace(settingsTab, window.FluxionUI.currentWorkspace());
    gBrowser.selectedTab = settingsTab;
    const panel = await waitFor(() => {
      const node = document.querySelector('.fluxion-settings-section[data-section="keyboard"]');
      return settingsTab.linkedBrowser.currentURI.spec === "about:preferences?fluxion=keyboard" &&
        !settingsTab.hasAttribute("busy") && node?.getBoundingClientRect().height > 0 && node;
    }, "Keyboard Settings did not become visible");
    const button = label => panel.querySelector(`button[aria-label="Change ${label} shortcut"]`);
    const capture = button("Toggle Flow sidebar");
    assert(capture, "Sidebar shortcut capture control is missing");
    const key = (target, code, extra = {}) => {
      const event = new window.KeyboardEvent("keydown", {
        key: code === "Escape" ? "Escape" : code.replace(/^Key/, "").toLowerCase(), code,
        metaKey: true, bubbles: true, cancelable: true, ...extra,
      });
      target.dispatchEvent(event);
      // Privileged Gecko chrome can mark script-created events trusted. Their
      // construction here, not isTrusted, identifies this as DOM-only input.
      report.keyboardEventTrustedFlags.push(Boolean(event.isTrusted));
      return event;
    };
    stage("capture-conflicts");
    const workspace = window.FluxionUI.currentWorkspace();
    const flowState = document.getElementById("fluxion-flow").dataset.state;
    capture.focus(); capture.click();
    for (const [code, extra] of [["KeyK", {}], ["KeyA", { shiftKey: true }], ["BracketRight", { altKey: true }]]) {
      const event = key(capture, code, extra);
      assert(event.defaultPrevented && capture.dataset.capturing === "true" &&
        /Already used/.test(panel.querySelector(".fluxion-settings-note")?.textContent || ""),
      "Existing global shortcut did not reach Settings conflict validation");
      assert(document.getElementById("fluxion-palette-layer").hidden && window.FluxionUI.currentWorkspace() === workspace &&
        document.getElementById("fluxion-flow").dataset.state === flowState && gBrowser.selectedTab === settingsTab,
      "Capturing a conflicting shortcut triggered a global browser action");
    }
    report.checks.push("real-settings-global-capture-suppression-and-conflict-feedback");
    stage("cross-window-save");
    const before = new Set(Services.wm.getEnumerator("navigator:browser"));
    window.OpenBrowserWindow();
    companion = await waitFor(() => [...Services.wm.getEnumerator("navigator:browser")]
      .find(candidate => !before.has(candidate) && candidate.FluxionShortcuts && candidate.gBrowserInit?.delayedStartupFinished),
    "Shortcut companion window did not finish browser startup");
    const foregroundAck = Services.env.get("FLUXION_SHORTCUT_FOREGROUND_ACK");
    assert(foregroundAck, "Shortcut foreground handshake path is missing");
    Services.prefs.setStringPref(`${prefix}.foreground`, "requested");
    Services.prefs.savePrefFile(null);
    await waitFor(() => IOUtils.exists(foregroundAck), "The owned shortcut application was not activated");
    // nsIFocusManager.focusedWindow raises this exact top-level window; the
    // readonly activeWindow below remains an independent activation assertion.
    Services.focus.focusedWindow = window;
    await waitFor(() => Services.focus.activeWindow === window && document.hasFocus(),
      "Primary shortcut fixture window did not regain native focus");
    Services.prefs.setStringPref(`${prefix}.foreground`, "confirmed");
    const nativeKey = async action => {
      const location = `${foregroundAck.slice(0, foregroundAck.lastIndexOf("/"))}/${action}`;
      const observed = [], listener = event => {
        if (event.metaKey && ["KeyW", "KeyK"].includes(event.code)) {
          const record = { code: event.code, meta: event.metaKey, alt: event.altKey, shift: event.shiftKey,
            ctrl: event.ctrlKey, altGraph: event.getModifierState("AltGraph"), composing: event.isComposing,
            key: event.key, capturedChord: window.FluxionShortcuts.capture(event),
            trusted: event.isTrusted, captureTarget: event.target === capture };
          observed.push(record); report.nativeKeys.push({ action, ...record });
        }
      };
      window.addEventListener("keydown", listener, true);
      try {
        await IOUtils.writeUTF8(`${location}.ready`, "ready");
        await waitFor(() => IOUtils.exists(`${location}.sent`), `Native shortcut driver did not acknowledge ${action}`);
        await waitFor(() => observed.some(event => event.trusted), `No trusted OS shortcut arrived for ${action}`);
        assert(observed.length === 1, `Native shortcut ${action} arrived more than once`);
      } finally { window.removeEventListener("keydown", listener, true); }
    };
    const pointerClick = control => {
      const box = control.getBoundingClientRect(), x = box.left + box.width / 2, y = box.top + box.height / 2;
      assert(box.width >= 24 && box.height >= 24 && control.contains(document.elementFromPoint(x, y)),
        "Shortcut recording button is clipped or obscured");
      assert(typeof window.synthesizeMouseEvent === "function", "Gecko widget pointer routing is unavailable");
      for (const type of ["mousemove", "mousedown", "mouseup"]) window.synthesizeMouseEvent(type, x, y, {
        identifier: window.windowUtils.DEFAULT_MOUSE_POINTER_ID, button: 0, buttons: type === "mousedown" ? 1 : 0,
        clickCount: type === "mousemove" ? 0 : 1, modifiers: 0, inputSource: window.MouseEvent.MOZ_SOURCE_MOUSE,
      }, { isDOMEventSynthesized: true, isWidgetEventSynthesized: false, isAsyncEnabled: false, toWindow: true });
    };
    await focusControl(button("Command palette"), "Unfocused recording origin");
    assert(document.activeElement !== capture, "Recording regression requires an initially unfocused button");
    pointerClick(capture);
    await waitFor(() => document.activeElement === capture && capture.dataset.capturing === "true",
      "Pointer recording did not explicitly acquire keyboard focus on macOS");
    const tabCount = gBrowser.tabs.length;
    await nativeKey("shortcut-reserved");
    assert(gBrowser.tabs.length === tabCount && gBrowser.selectedTab === settingsTab && capture.dataset.capturing === "true" &&
      /reserved/.test(panel.querySelector(".fluxion-settings-note")?.textContent || ""),
    "Native Cmd-W escaped recording instead of reporting a protected shortcut");
    await nativeKey("shortcut-save");
    const custom = "Accel+Alt+Shift+KeyK";
    assert(capture.dataset.capturing === "false" && window.FluxionShortcuts.get("sidebar") === custom &&
      companion.FluxionShortcuts.get("sidebar") === custom &&
      JSON.parse(Services.prefs.getStringPref("fluxion.shortcuts")).sidebar === custom,
    "Shortcut editing did not save and propagate the binding");
    report.checks.push("settings-custom-save-cross-window-and-persisted-pref");
    const beforeActivation = document.getElementById("fluxion-flow").dataset.state;
    await nativeKey("shortcut-activate");
    await waitFor(() => document.getElementById("fluxion-flow").dataset.state !== beforeActivation,
      "Saved native keyboard shortcut did not activate the actual sidebar command");
    window.FluxionUI.setSidebarState(flowState);
    report.nativeOSKeyboardTest = true;
    report.eventSource = "mixed DOM fixture events and native macOS System Events shortcut recording/activation";
    report.pointerSource = "Gecko widget-routed pointer click, not OS mouse movement";
    report.checks.push("unfocused-pointer-recording-acquires-focus-and-native-reserved-save-activation");
    stage("capture-exit-and-dispatch");
    await focusControl(capture, "Escape capture"); capture.click(); key(capture, "Escape", { metaKey: false });
    assert(capture.dataset.capturing === "false", "Escape did not end shortcut capture");
    key(capture, "KeyK");
    assert(!document.getElementById("fluxion-palette-layer").hidden, "Normal palette shortcut was not restored after capture");
    const paletteInput = document.getElementById("fluxion-palette-input");
    await waitFor(() => document.activeElement === paletteInput, "Opened palette did not receive its scheduled input focus");
    key(paletteInput, "Escape", { metaKey: false });
    await waitFor(() => document.getElementById("fluxion-palette-layer").hidden && document.activeElement === capture,
      "Palette close did not restore the prior shortcut control focus");
    await focusControl(capture, "Blur capture"); capture.click();
    await focusControl(button("Command palette"), "Blur destination");
    await waitFor(() => capture.dataset.capturing === "false", "Blur did not end shortcut capture");
    report.checks.push("escape-blur-release-and-normal-palette-dispatch");
    companion.FluxionShortcuts.reset("sidebar");
    assert(window.FluxionShortcuts.get("sidebar") === "Accel+Shift+Backslash" &&
      capture.textContent === window.FluxionShortcuts.format("sidebar"), "Cross-window reset left stale Settings shortcut text");
    report.checks.push("cross-window-reset-and-control-refresh");
    await verifyLivePreferences();
    Services.prefs.setStringPref(`${prefix}.health`, "packaged-settings-shortcut-capture-and-cross-window-save-verified");
  }
  run().catch(error => {
    report.failureFocus = { documentFocused: document.hasFocus(), activeWindow: Services.focus.activeWindow === window,
      activeTag: document.activeElement?.localName, activeId: document.activeElement?.id,
      activeClass: document.activeElement?.className, settingsURL: gBrowser.selectedBrowser?.currentURI?.spec };
    Services.prefs.setStringPref(`${prefix}.error`, `${error?.message || error}\n${error?.stack || ""}`);
    Cu.reportError(error);
  }).finally(() => {
    if (companion && !companion.closed) companion.close();
    Services.prefs.setStringPref(`${prefix}.report`, JSON.stringify(report));
    Services.prefs.savePrefFile(null);
  });
})(window);
