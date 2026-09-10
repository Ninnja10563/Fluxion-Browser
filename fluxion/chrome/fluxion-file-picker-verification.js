/* global Services, ChromeUtils, IOUtils, PathUtils, Cu */
(function verifyNativeFilePicker(window) {
  "use strict";
  if (Services.env.get("FLUXION_FILE_PICKER_TEST") !== "1") return;
  const prefix = "fluxion.filePicker";
  if (Services.prefs.getBoolPref(`${prefix}.claimed`, false)) return;
  Services.prefs.setBoolPref(`${prefix}.claimed`, true);
  const origin = Services.env.get("FLUXION_FILE_PICKER_ORIGIN");
  const driver = Services.env.get("FLUXION_FILE_PICKER_DRIVER_DIR");
  const expectedHash = Services.env.get("FLUXION_FILE_PICKER_EXPECTED_SHA256");
  const expectedSize = Number(Services.env.get("FLUXION_FILE_PICKER_EXPECTED_SIZE"));
  const { gBrowser, document } = window;
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const stage = value => { Services.prefs.setStringPref(`${prefix}.stage`, value); Services.prefs.savePrefFile(null); };
  const report = { transport: "native-system-events-and-NSOpenPanel", checks: [] };
  const waitFor = async (condition, message, timeout = 30000) => {
    const deadline = Date.now() + timeout;
    do {
      const result = await condition();
      if (result) return result;
      await new Promise(resolve => window.setTimeout(resolve, 100));
    } while (Date.now() < deadline);
    throw new Error(message);
  };
  let tab;
  const command = name => tab.linkedBrowser.browsingContext.currentWindowGlobal
    .getActor("FluxionFilePickerVerification").sendQuery(`FluxionFilePicker:${name}`, { origin });
  const serverState = async () => {
    const response = await window.fetch(`${origin}/state`, { credentials: "omit", cache: "no-store" });
    assert(response.ok, "Picker fixture state could not be read");
    return response.json();
  };
  async function requestPicker(mode) {
    assert(Services.focus.activeWindow === window && document.hasFocus(), "Owned picker window lost foreground focus");
    tab.linkedBrowser.focus();
    const focused = await command("Focus");
    assert(focused.focused, "The actual file input did not receive content focus");
    await IOUtils.writeUTF8(PathUtils.join(driver, `${mode}.ready`), "ready\n");
    await waitFor(() => IOUtils.exists(PathUtils.join(driver, `${mode}.sent`)), `Native ${mode} driver did not finish`, 45000);
  }
  async function run() {
    assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(origin) && /^[a-f0-9]{64}$/.test(expectedHash) && expectedSize > 0,
      "Native picker fixture configuration is invalid");
    assert(/\/fluxion-file-picker-check\.[^/]+\/profile\/?$/.test(PathUtils.profileDir) &&
      driver === PathUtils.join(PathUtils.parent(PathUtils.profileDir), "driver"), "Native picker fixture paths are not isolated");
    stage("waiting-for-owned-window-foreground");
    await waitFor(() => IOUtils.exists(PathUtils.join(driver, "foreground.ready")), "Native picker window was not activated");
    await waitFor(() => Services.focus.activeWindow === window && document.hasFocus(), "Owned browser did not receive native focus");
    tab = await waitFor(() => [...gBrowser.tabs].find(item => item.linkedBrowser.currentURI.spec === `${origin}/file-picker`),
      "The real file picker document was not opened");
    window.FluxionUI.selectTab(tab);
    await waitFor(async () => !tab.hasAttribute("busy") && (await command("Read")).title === "Fluxion native file picker",
      "The actual file picker page did not render");
    assert((await serverState()).filePickerUploads === 0, "Picker fixture already received an upload");
    stage("canceling-native-picker");
    await requestPicker("cancel");
    const canceled = await waitFor(async () => { const value = await command("Read"); return value.events.cancel === 1 ? value : null; },
      "Native picker cancellation did not produce a trusted content cancel event");
    assert(!canceled.events.change && !canceled.events.input && !canceled.events.untrusted && canceled.files.length === 0,
      "Canceling the native picker altered the file input");
    assert((await serverState()).filePickerUploads === 0, "Canceling the picker uploaded a file");
    report.cancel = canceled;
    report.checks.push("owned-native-picker-cancel-with-trusted-event-and-no-upload");
    stage("choosing-file-in-native-picker");
    await requestPicker("accept");
    const selected = await waitFor(async () => { const value = await command("Read"); return value.events.change === 1 ? value : null; },
      "Native picker selection did not produce a trusted change event");
    assert(selected.events.cancel === 1 && selected.events.input === 1 && !selected.events.untrusted &&
      selected.files.length === 1 && selected.files[0].name.normalize("NFC") === "Fluxion café upload.txt" &&
      selected.files[0].size === expectedSize, "Native picker returned an unexpected file or event sequence");
    report.selection = selected;
    stage("submitting-real-multipart-upload");
    await command("Submit");
    await waitFor(async () => tab.linkedBrowser.currentURI.spec === `${origin}/file-picker-upload` &&
      !tab.hasAttribute("busy") && (await command("Read")).title === "Fluxion native picker upload complete",
      "The native-selected file did not complete the real upload form navigation");
    const state = await serverState();
    assert(state.filePickerUploads === 1 && state.filePickerUpload.verified &&
      state.filePickerUpload.filename.normalize("NFC") === "Fluxion café upload.txt" &&
      state.filePickerUpload.sha256 === expectedHash && state.filePickerUpload.bytes === expectedSize,
      "Server did not receive the exact file chosen in the native picker");
    report.server = state.filePickerUpload;
    report.checks.push("native-unicode-and-space-path-selection", "real-native-selected-multipart-bytes-verified");
  }
  run().then(() => Services.prefs.setStringPref(`${prefix}.health`, "native-picker-cancel-and-multipart-upload-verified"))
    .catch(error => { Services.prefs.setStringPref(`${prefix}.error`, `${error?.message || error}\n${error?.stack || ""}`); Cu.reportError(error); })
    .finally(() => { Services.prefs.setStringPref(`${prefix}.report`, JSON.stringify(report)); Services.prefs.savePrefFile(null); });
})(window);
