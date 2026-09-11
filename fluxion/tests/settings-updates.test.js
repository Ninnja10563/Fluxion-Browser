"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const settingsFixture = require("./settings-window-fixture.js");
const installed = require("../package.json").version;
const settle = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const calls = [];
  const h = settingsFixture("about:preferences?fluxion=about", [], { updates: {
    check: (...args) => new Promise((resolve, reject) => calls.push({ args, resolve, reject })),
  } });
  const get = suffix => h.document.getElementById(`fluxion-update-${suffix}`);
  return { ...h, calls, check: get("check"), status: get("status"), download: get("download"),
    click(control = get("check")) { control.dispatchEvent({ type: "click" }); } };
}
test("About checks only on request and passes the full installed preview version", async () => {
  const h = fixture(); await settle();
  assert.equal(h.calls.length, 0);
  assert.equal(h.status.dataset.state, "idle");
  h.click(); h.click();
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.calls[0].args, [installed, "Darwin"]);
  assert.equal(h.check.disabled, true);
  assert.equal(h.status.dataset.state, "checking");
  h.calls[0].resolve({ state: "current", installed, latest: installed }); await settle();
  assert.equal(h.check.disabled, false);
  assert.equal(h.download.hidden, true);
  assert.match(h.status.textContent, /No newer compatible release found/);
  assert.deepEqual(h.opened, []);
});
test("a validated available release is downloaded only after the separate user action", async () => {
  const h = fixture(); h.click();
  const downloadURL = "https://github.com/Ninnja10563/Fluxion-Browser/releases/download/v1.0.0/Fluxion-1.0.0-macOS-universal.dmg";
  h.calls[0].resolve({ state: "available", installed, latest: "1.0.0", downloadURL }); await settle();
  assert.equal(h.download.hidden, false);
  assert.deepEqual(h.opened, []);
  h.click(h.download);
  assert.deepEqual(h.opened, [downloadURL]);
});
test("a failed recheck clears the old download target and allows an explicit retry", async () => {
  const h = fixture(); h.click();
  h.calls[0].resolve({ state: "available", latest: "1.0.0", downloadURL: "old-download" }); await settle();
  h.click();
  assert.equal(h.download.hidden, true);
  h.calls[1].reject(new Error("GitHub rate limit reached")); await settle();
  assert.equal(h.status.dataset.state, "error");
  assert.match(h.status.textContent, /rate limit/);
  assert.equal(h.check.disabled, false);
  h.click(h.download);
  assert.deepEqual(h.opened, []);
  h.click(); assert.equal(h.calls.length, 3);
});
test("window closure suppresses late update UI and download changes", async () => {
  const h = fixture(); h.click(); h.unload();
  h.calls[0].resolve({ state: "available", latest: "1.0.0", downloadURL: "late-download" }); await settle();
  assert.equal(h.download.hidden, true);
  assert.equal(h.status.dataset.state, "checking");
  assert.deepEqual(h.opened, []);
});
test("unsupported or incomplete release data is not described as up to date", async () => {
  for (const state of ["unsupported", "unavailable"]) {
    const h = fixture(); h.click(); h.calls[0].resolve({ state, installed }); await settle();
    assert.equal(h.status.dataset.state, state);
    assert.equal(h.download.hidden, true);
    assert.doesNotMatch(h.status.textContent, /No newer compatible|up to date/i);
  }
});

test("structured network failures are shown as failures rather than no compatible release", async () => {
  for (const reason of ["rate-limit", "timeout", "too-large", "http", "invalid-feed"]) {
    const h = fixture(); h.click();
    h.calls[0].resolve({ state: "unavailable", installed, reason }); await settle();
    assert.equal(h.status.dataset.state, "error");
    assert.equal(h.status.dataset.reason, reason);
    assert.equal(h.check.disabled, false);
    assert.equal(h.download.hidden, true);
    assert.doesNotMatch(h.status.textContent, /No compatible downloadable release was found/);
  }
});

test("expired feed clears prior release evidence and download actions without claiming current", async () => {
  const h = fixture(); h.click();
  h.calls[0].resolve({ state: "available", latest: "1.0.0", downloadURL: "old-download",
    evidence: { sourceCommit: "a".repeat(40) } }); await settle();
  assert.equal(JSON.parse(h.status.dataset.releaseEvidence).sourceCommit, "a".repeat(40));
  h.click(); assert.equal(h.status.dataset.releaseEvidence, undefined);
  h.calls[1].resolve({ state: "unavailable", reason: "invalid-feed" }); await settle();
  assert.equal(h.download.hidden, true); assert.equal(h.check.disabled, false);
  assert.match(h.status.textContent, /expired or could not be verified/);
  assert.doesNotMatch(h.status.textContent, /No newer|up to date/i);
  h.click(h.download); assert.deepEqual(h.opened, []);
});

test("compact release control retains a descriptive name and opens the correct destination", async () => {
  const h = fixture();
  const releases = h.document.getElementById("fluxion-update-releases");
  assert.equal(releases.textContent, "All releases");
  assert.equal(releases.getAttribute("aria-label"), "Open Fluxion releases");
  h.click(releases);
  assert.deepEqual(h.opened, ["https://github.com/Ninnja10563/Fluxion-Browser/releases"]);
  h.click();
  const releaseURL = "https://github.com/Ninnja10563/Fluxion-Browser/releases/tag/v1.0.0";
  h.calls[0].resolve({ state: "available", latest: "1.0.0", releaseURL, downloadURL: "download" }); await settle();
  assert.equal(releases.textContent, "Release notes");
  assert.equal(releases.getAttribute("aria-label"), "Open Fluxion 1.0.0 release notes");
  h.click(releases);
  assert.equal(h.opened[1], releaseURL);
});

test("rate-limit advice displays the server retry time without offering a download", async () => {
  const h = fixture(); h.click();
  const retryAt = Date.now() + 120000;
  h.calls[0].resolve({ state: "unavailable", reason: "rate-limit", status: 403, installed, retryAt }); await settle();
  assert.equal(h.status.dataset.state, "error");
  assert.equal(h.status.dataset.retryAt, String(retryAt));
  assert.match(h.status.textContent, /Check again after/);
  assert.match(h.status.textContent, /temporarily refused/);
  assert.equal(h.download.hidden, true);
  assert.deepEqual(h.opened, []);
});
