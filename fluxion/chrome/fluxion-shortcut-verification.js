/* global Services, SessionStore, IOUtils, Cu */
(function verifyShortcutEditing(window) {
  "use strict";
  if (Services.env.get("FLUXION_SHORTCUT_TEST") !== "1") return;
  const prefix = "fluxion.shortcutVerification";
  if (Services.prefs.getBoolPref(`${prefix}.claimed`, false)) return;
  Services.prefs.setBoolPref(`${prefix}.claimed`, true);
  const report = { eventSource: "synthetic-DOM-keyboard-events-in-packaged-Gecko", nativeOSKeyboardTest: false,
    keyboardEventTrustedFlags: [], checks: [] };
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
    const capture = button("Cycle Flow sidebar");
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
    await focusControl(capture, "Shortcut capture"); capture.click();
    key(capture, "KeyK", { altKey: true, shiftKey: true });
    const custom = "Accel+Alt+Shift+KeyK";
    assert(capture.dataset.capturing === "false" && window.FluxionShortcuts.get("sidebar") === custom &&
      companion.FluxionShortcuts.get("sidebar") === custom &&
      JSON.parse(Services.prefs.getStringPref("fluxion.shortcuts")).sidebar === custom,
    "Shortcut editing did not save and propagate the binding");
    report.checks.push("settings-custom-save-cross-window-and-persisted-pref");
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
