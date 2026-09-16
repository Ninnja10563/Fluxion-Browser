"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const settingsFixture = require("./settings-window-fixture.js");
const installed = require("../package.json").version;
const settle = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const calls = [], watchers = new Set();
  let state = { state: "idle", installed, automatic: true, canCheck: true, canInstall: false, canCancel: false, canRetry: false };
  const coordinator = { getState: () => state, watch(window, callback) { watchers.add(callback); callback(state); return () => watchers.delete(callback); },
    setAutomatic(value) { calls.push({ action: "automatic", value }); emit({ ...state, automatic: value }); } };
  function emit(next) { state = Object.freeze(next); for (const callback of watchers) callback(state); }
  for (const action of ["check", "install", "cancel", "retry"]) coordinator[action] = () =>
    new Promise((resolve, reject) => calls.push({ action, resolve, reject }));
  const h = settingsFixture("about:preferences?fluxion=about", [], { updateCoordinator: coordinator });
  const get = suffix => h.document.getElementById(`fluxion-update-${suffix}`);
  return { ...h, calls, get, emit, watchers, coordinator, check: get("check"), status: get("status"), download: get("download"),
    click(control = get("check")) { return control.dispatchEvent({ type: "click" }); } };
}
test("About subscribes without starting a duplicate check and delegates exactly one explicit check", async () => {
  const h = fixture(); await settle();
  assert.equal(h.calls.length, 0); assert.equal(h.status.dataset.state, "idle");
  h.click(); h.click(); assert.deepEqual(h.calls.map(call => call.action), ["check"]);
  assert.equal(h.check.disabled, true);
  h.emit({ state: "checking", installed, automatic: true, canCheck: false });
  assert.equal(h.status.dataset.state, "checking");
  h.emit({ state: "current", installed, latest: installed, automatic: true, canCheck: true });
  h.calls[0].resolve(); await settle();
  assert.equal(h.check.disabled, false); assert.equal(h.download.hidden, true);
  assert.match(h.status.textContent, /No newer compatible release found/);
  assert.deepEqual(h.opened, []);
});
test("install, cancel and retry use coordinator permissions; background state drives precise progress", async () => {
  const h = fixture();
  await h.click(h.get("install")); assert.equal(h.calls.length, 0);
  h.emit({ state: "available", installed, latest: "1.0.0", canInstall: true, canCheck: true });
  h.click(h.get("install")); h.click(h.get("install"));
  assert.deepEqual(h.calls.map(call => call.action), ["install"]);
  h.emit({ state: "downloading", installed, latest: "1.0.0", progress: .42, canCancel: true });
  assert.equal(h.get("install").hidden, true); assert.equal(h.get("cancel").hidden, false);
  assert.equal(h.get("progress").hidden, false); assert.equal(h.get("progress").value, .42);
  assert.equal(h.get("progress").getAttribute("aria-label"), "Fluxion update progress");
  h.click(h.get("cancel")); assert.equal(h.calls.at(-1).action, "cancel");
  h.emit({ state: "retry", installed, canRetry: true, detail: "The download was interrupted." });
  assert.equal(h.get("progress").hidden, true); assert.match(h.status.textContent, /interrupted/);
  h.click(h.get("retry")); assert.equal(h.calls.at(-1).action, "retry");
  h.emit({ state: "installing", installed, progress: null });
  assert.equal(h.get("progress").hidden, true, "unknown progress cannot claim a percentage");
  assert.equal(h.get("cancel").hidden, true); assert.equal(h.get("retry").hidden, true);
  assert.deepEqual(h.opened, []);
});
test("unsupported native installation retains a separate, clearly named manual DMG action", async () => {
  const h = fixture();
  const downloadURL = "https://github.com/Ninnja10563/Fluxion-Browser/releases/download/v1.0.0/Fluxion-1.0.0-macOS-universal.dmg";
  h.emit({ state: "unsupported", installed, latest: "1.0.0", canInstall: false, canCheck: true, downloadURL });
  assert.equal(h.get("install").hidden, true); assert.equal(h.download.hidden, false);
  assert.match(h.download.textContent, /install manually/); assert.deepEqual(h.opened, []);
  await h.click(h.download); assert.deepEqual(h.opened, [downloadURL]);
  assert.doesNotMatch(h.status.textContent, /up to date/i);
});
test("stale metadata and actions are cleared on recheck and signed-feed failure", async () => {
  const h = fixture();
  h.emit({ state: "available", latest: "1.0.0", downloadURL: "verified-download", releaseURL: "verified-release",
    evidence: { sourceCommit: "a".repeat(40) }, canInstall: true, canCheck: true });
  assert.equal(JSON.parse(h.status.dataset.releaseEvidence).sourceCommit, "a".repeat(40));
  h.emit({ state: "checking", installed });
  assert.equal(h.status.dataset.releaseEvidence, undefined); assert.equal(h.status.dataset.latest, undefined);
  assert.equal(h.download.hidden, true); assert.equal(h.get("install").hidden, true);
  const retryAt = Date.now() + 120000;
  h.emit({ state: "error", installed, canCheck: true, reason: "invalid-feed", retryAt,
    detail: "The signed feed is expired or could not be verified." });
  assert.equal(h.status.dataset.reason, "invalid-feed"); assert.equal(h.status.dataset.retryAt, String(retryAt));
  assert.equal(h.get("releases").textContent, "All releases");
  await h.click(h.download); assert.deepEqual(h.opened, []);
  assert.match(h.status.textContent, /expired or could not be verified/);
  h.emit({ state: "current", installed, canCheck: true });
  assert.equal(h.status.dataset.reason, undefined); assert.equal(h.status.dataset.retryAt, undefined);
});
test("automatic-check changes delegate once and reflect shared state without downloading", async () => {
  const h = fixture(), checkbox = h.get("automatic");
  assert.equal(checkbox.checked, true); checkbox.checked = false;
  await checkbox.dispatchEvent({ type: "change" });
  assert.deepEqual(h.calls, [{ action: "automatic", value: false }]);
  assert.equal(checkbox.checked, false);
  h.emit({ state: "idle", installed, automatic: true, canCheck: true });
  assert.equal(checkbox.checked, true); assert.equal(h.calls.length, 1);
});
test("two About windows share update progress and automatic choice without starting duplicate work", async () => {
  const first = fixture(), second = settingsFixture("about:preferences?fluxion=about", [], { updateCoordinator: first.coordinator });
  assert.equal(first.watchers.size, 2); assert.equal(first.calls.length, 0);
  first.emit({ state: "downloading", installed, progress: .66, automatic: true, canCancel: true });
  assert.equal(first.get("progress").value, .66);
  assert.equal(second.document.getElementById("fluxion-update-progress").value, .66);
  const choice = second.document.getElementById("fluxion-update-automatic");
  choice.checked = false; await choice.dispatchEvent({ type: "change" });
  assert.equal(first.get("automatic").checked, false);
  assert.deepEqual(first.calls, [{ action: "automatic", value: false }]);
  second.unload(); assert.equal(first.watchers.size, 1);
  first.emit({ state: "downloading", installed, progress: .8, automatic: false, canCancel: true });
  assert.equal(first.get("progress").value, .8);
  assert.equal(second.document.getElementById("fluxion-update-progress").value, .66);
});
test("window closure unsubscribes and prevents late callbacks, downloads or action mutations", async () => {
  const h = fixture(); h.click(); h.unload();
  assert.equal(h.watchers.size, 0);
  h.emit({ state: "available", latest: "1.0.0", downloadURL: "late-download", canInstall: true });
  h.calls[0].resolve(); await settle();
  assert.equal(h.download.hidden, true); assert.equal(h.status.dataset.state, "idle");
  await h.click(h.get("install")); await h.click(h.download);
  assert.equal(h.calls.length, 1); assert.deepEqual(h.opened, []);
});
test("unexpected action rejection remains readable and allows an explicit retry", async () => {
  const h = fixture(); h.click(); h.calls[0].reject(new Error("native bridge unavailable")); await settle();
  assert.match(h.status.textContent, /native bridge unavailable/); assert.equal(h.check.disabled, false);
  h.click(); assert.equal(h.calls.length, 2);
});
test("release controls retain descriptive names and coordinator-validated destinations", async () => {
  const h = fixture(), releases = h.get("releases");
  assert.equal(releases.getAttribute("aria-label"), "Open Fluxion releases");
  await h.click(releases); assert.deepEqual(h.opened, ["https://github.com/Ninnja10563/Fluxion-Browser/releases"]);
  const releaseURL = "https://github.com/Ninnja10563/Fluxion-Browser/releases/tag/v1.0.0";
  h.emit({ state: "available", latest: "1.0.0", releaseURL });
  assert.equal(releases.getAttribute("aria-label"), "Open Fluxion 1.0.0 release notes");
  await h.click(releases); assert.equal(h.opened[1], releaseURL);
});
