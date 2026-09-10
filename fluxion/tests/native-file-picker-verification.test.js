"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../chrome/fluxion-file-picker-verification.js"), "utf8");

// These exercise the complete verifier's orchestration, not native NSOpenPanel,
// trusted DOM events, or multipart transport. The macOS gate supplies that proof.
async function runFixture(options = {}) {
  const origin = "http://127.0.0.1:42123";
  const profile = "/tmp/fluxion-file-picker-check.unit/profile";
  const driver = "/tmp/fluxion-file-picker-check.unit/driver";
  const hash = "a".repeat(64), size = 37;
  const prefs = new Map(), requests = [], commands = [], errors = [];
  let now = 0, focused = true, phase = "initial", browserFocus = 0, submitted = 0;
  let done;
  const completion = new Promise(resolve => { done = resolve; });
  const selection = () => ({
    title: "Fluxion native file picker",
    events: { cancel: phase === "initial" ? 0 : 1, input: 0, change: 0, untrusted: 0 },
    files: [],
  });
  function read() {
    const result = selection();
    if (phase === "pending" && options.pendingUntrusted) result.events.untrusted = 1;
    if (phase === "selected" || phase === "submitted") {
      result.events.input = 1;
      result.events.change = 1;
      result.events.untrusted = options.untrusted ? 1 : 0;
      result.files = [{ name: "Fluxion cafe\u0301 upload.txt", size }];
    }
    if (phase === "canceled" && options.badCancel) result.events.input = 1;
    if (phase === "submitted") result.title = "Fluxion native picker upload complete";
    return result;
  }
  const actor = {
    async sendQuery(name, payload) {
      assert.equal(payload.origin, origin);
      const command = name.replace("FluxionFilePicker:", "");
      commands.push(command);
      if (command === "Focus") return { focused: !options.inputFocusFailure };
      if (command === "Read") return read();
      assert.equal(command, "Submit");
      submitted++;
      phase = "submitted";
      browser.currentURI.spec = `${origin}/file-picker-upload`;
    },
  };
  const browser = {
    currentURI: { spec: `${origin}/file-picker` },
    focus() { browserFocus++; },
    browsingContext: { currentWindowGlobal: { getActor(name) {
      assert.equal(name, "FluxionFilePickerVerification"); return actor;
    } } },
  };
  const tab = { linkedBrowser: browser, hasAttribute: () => false };
  const window = {
    document: { hasFocus: () => focused },
    gBrowser: { tabs: [tab] },
    FluxionUI: { selectTab(value) { assert.equal(value, tab); } },
    setTimeout(callback, ms) { now += ms; queueMicrotask(callback); },
    async fetch(url, init) {
      assert.equal(url, `${origin}/state`);
      assert.equal(init.credentials, "omit");
      const uploads = submitted || (options.earlyUpload && phase === "selected" ? 1 : 0);
      return { ok: true, async json() { return {
        filePickerUploads: uploads,
        filePickerUpload: {
          verified: true, filename: "Fluxion cafe\u0301 upload.txt",
          sha256: options.badHash ? "b".repeat(64) : hash,
          bytes: options.badBytes ? size + 1 : size,
        },
      }; } };
    },
  };
  const env = {
    FLUXION_FILE_PICKER_TEST: "1", FLUXION_FILE_PICKER_ORIGIN: origin,
    FLUXION_FILE_PICKER_DRIVER_DIR: driver, FLUXION_FILE_PICKER_EXPECTED_SHA256: hash,
    FLUXION_FILE_PICKER_EXPECTED_SIZE: String(size),
  };
  const Services = {
    env: { get: key => env[key] || "" }, appinfo: { processID: 42 },
    focus: { activeWindow: window },
    prefs: {
      getBoolPref: (key, fallback) => prefs.get(key) ?? fallback,
      setBoolPref: (key, value) => prefs.set(key, value),
      setIntPref: (key, value) => prefs.set(key, value),
      setStringPref(key, value) { prefs.set(key, value); if (key.endsWith(".report")) done(); },
      savePrefFile() {},
    },
  };
  const IOUtils = {
    async exists(file) {
      if (file === `${driver}/foreground.ready`) return true;
      return requests.some(request => file === `${driver}/${request.mode}.sent`);
    },
    async writeUTF8(file, contents) {
      assert.equal(contents, "ready\n");
      const mode = path.basename(file, ".ready");
      assert.equal(file, `${driver}/${mode}.ready`);
      requests.push({ mode, browserFocus, actorFocus: commands.filter(item => item === "Focus").length, focused });
      if (mode === "cancel") { phase = "canceled"; focused = !options.cancelFocusFailure; }
      else if (mode === "accept" && (options.modal || options.restoredWithoutSelection)) {
        phase = "pending"; focused = !!options.restoredWithoutSelection;
      } else {
        assert.ok(mode === "accept" || mode === "open");
        phase = "selected"; focused = !options.selectionFocusFailure;
      }
    },
  };
  vm.runInNewContext(source, {
    window, Services, IOUtils,
    PathUtils: { profileDir: profile, join: path.posix.join, parent: path.posix.dirname },
    Date: { now: () => now }, Cu: { reportError: error => errors.push(error.message) },
  }, { filename: "fluxion-file-picker-verification.js" });
  await completion;
  return {
    health: prefs.get("fluxion.filePicker.health"), error: prefs.get("fluxion.filePicker.error"),
    report: JSON.parse(prefs.get("fluxion.filePicker.report")),
    requests, commands, browserFocus, submitted, errors, elapsed: now,
  };
}

test("selection with the first Return does not request another native confirmation", async () => {
  const result = await runFixture();
  assert.equal(result.health, "native-picker-cancel-and-multipart-upload-verified");
  assert.equal(result.error, undefined);
  assert.deepEqual(result.requests.map(item => item.mode), ["cancel", "accept"]);
  assert.equal(result.report.pathConfirmation, "selected-with-first-return");
  assert.equal(result.submitted, 1);
});

test("pending native modal requests Open without refocusing browser or file input", async () => {
  const result = await runFixture({ modal: true });
  assert.ok(result.health);
  assert.deepEqual(result.requests.map(item => item.mode), ["cancel", "accept", "open"]);
  assert.deepEqual(result.requests[2], { mode: "open", browserFocus: 2, actorFocus: 2, focused: false });
  assert.equal(result.browserFocus, 2);
  assert.equal(result.report.pathConfirmation, "separate-native-open-confirmation");
  assert.ok(result.elapsed >= 2000);
  assert.equal(result.submitted, 1);
});

test("restored content focus without selection fails without sending a second Return", async () => {
  const result = await runFixture({ restoredWithoutSelection: true });
  assert.equal(result.health, undefined);
  assert.match(result.error, /returned to content without selecting a file/);
  assert.deepEqual(result.requests.map(item => item.mode), ["cancel", "accept"]);
  assert.equal(result.submitted, 0);
});

for (const [name, options, message, submits] of [
  ["untrusted selection", { untrusted: true }, /unexpected file or event sequence/, 0],
  ["altered cancel events", { badCancel: true }, /Canceling the native picker altered/, 0],
  ["untrusted pending event", { modal: true, pendingUntrusted: true }, /unexpected events before confirmation/, 0],
  ["file input focus failure", { inputFocusFailure: true }, /file input did not receive content focus/, 0],
  ["cancel focus not restored", { cancelFocusFailure: true }, /cancellation did not restore browser focus/, 0],
  ["selection focus not restored", { selectionFocusFailure: true }, /selection did not restore browser focus/, 0],
  ["incorrect upload bytes", { badBytes: true }, /Server did not receive the exact file/, 1],
  ["incorrect upload digest", { badHash: true }, /Server did not receive the exact file/, 1],
  ["premature form submission", { earlyUpload: true }, /confirmation unexpectedly submitted/, 0],
]) {
  test(`${name} cannot produce a successful native picker health marker`, async () => {
    const result = await runFixture(options);
    assert.equal(result.health, undefined);
    assert.match(result.error, message);
    assert.equal(result.errors.length, 1);
    assert.equal(result.submitted, submits);
    if (options.pendingUntrusted) assert.deepEqual(result.requests.map(item => item.mode), ["cancel", "accept"]);
  });
}
