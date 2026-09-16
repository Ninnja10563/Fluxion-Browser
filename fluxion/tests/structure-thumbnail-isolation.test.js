"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), vm = require("node:vm");
const source = fs.readFileSync(require.resolve("../chrome/fluxion-structure-verification.js"), "utf8");
const begin = source.indexOf("  function isolateThumbnailCapture()"), end = source.indexOf("  function observeSetupChannels", begin);
assert.ok(begin > 0 && end > begin);
function fixture(initial, { locked = false, failsAfterWrite = false } = {}) {
  const user = new Map(initial === undefined ? [] : [["browser.pagethumbnails.capturing_disabled", initial]]);
  const writes = [], context = { report: {}, restoreThumbnailPreference() {},
    assert: (ok, message) => assert.ok(ok, message), Services: { prefs: {
      prefIsLocked: () => locked, prefHasUserValue: key => user.has(key),
      getBoolPref: key => user.get(key) ?? false,
      setBoolPref(key, value) { user.set(key, value); writes.push([key, value]);
        if (failsAfterWrite && writes.length === 1) throw Error("fixture write interrupted"); },
      clearUserPref: key => user.delete(key),
    } } };
  vm.createContext(context); vm.runInContext(source.slice(begin, end), context);
  return { context, user, writes };
}
test("fixture isolates thumbnail capture and restores absent, false and true user preference provenance", () => {
  for (const initial of [undefined, false, true]) {
    const f = fixture(initial); f.context.isolateThumbnailCapture();
    assert.equal(f.user.get("browser.pagethumbnails.capturing_disabled"), true);
    f.context.restoreThumbnailPreference(); f.context.restoreThumbnailPreference();
    assert.equal(f.user.get("browser.pagethumbnails.capturing_disabled"), initial);
    assert.equal(f.context.report.thumbnailIsolation.restored, true);
    assert.equal(f.writes.length, initial === undefined ? 1 : 2, "restoration is idempotent");
  }
});
test("partial setup failures remain restorable and managed preferences are never overwritten", () => {
  const failed = fixture(false, { failsAfterWrite: true });
  assert.throws(() => failed.context.isolateThumbnailCapture(), /interrupted/);
  failed.context.restoreThumbnailPreference();
  assert.equal(failed.user.get("browser.pagethumbnails.capturing_disabled"), false);
  const locked = fixture(false, { locked: true });
  assert.throws(() => locked.context.isolateThumbnailCapture(), /managed thumbnail/);
  assert.equal(locked.writes.length, 0);
});
test("isolation is behind the isolated-profile assertion and never weakens strict document load invariants", () => {
  assert.match(source, /assert\([^\n]+Requires isolated structure profile[^\n]+\n\s*isolateThumbnailCapture\(\);/);
  assert.match(source, /assert\(baselineLoads === 4,/);
  assert.match(source, /assert\(loads === baselineLoads,/);
  assert.ok(source.indexOf("isolateThumbnailCapture();") < source.indexOf("tab.linkedBrowser.loadURI("));
});
