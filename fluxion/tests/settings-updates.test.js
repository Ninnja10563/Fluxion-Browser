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
  for (const reason of ["rate-limit", "timeout", "too-large", "http"]) {
    const h = fixture(); h.click();
    h.calls[0].resolve({ state: "unavailable", installed, reason }); await settle();
    assert.equal(h.status.dataset.state, "error");
    assert.equal(h.status.dataset.reason, reason);
    assert.equal(h.check.disabled, false);
    assert.equal(h.download.hidden, true);
    assert.doesNotMatch(h.status.textContent, /No compatible downloadable release was found/);
  }
});
