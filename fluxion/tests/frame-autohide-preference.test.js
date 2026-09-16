"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const source = fs.readFileSync(require.resolve("../chrome/fluxion-frame-verification.js"), "utf8");
const start = source.indexOf("  async function withSavedAutohideDisabled("), end = source.indexOf("  function newTabGeometryEvidence(", start);
assert.ok(start > 0 && end > start);
function fixture(userValue) {
  const original = userValue, writes = [], observers = new Set();
  const changed = () => { for (const observer of observers) observer.observe(); };
  const prefs = {
    prefHasUserValue: () => userValue !== undefined,
    getBoolPref: () => userValue ?? true,
    setBoolPref(name, value) { userValue = value; writes.push(value); changed(); },
    clearUserPref() { userValue = undefined; writes.push("clear"); changed(); },
    savePrefFile() { writes.push("save"); },
    addObserver: (name, observer) => observers.add(observer),
    removeObserver: (name, observer) => observers.delete(observer),
  };
  const run = vm.runInNewContext(`${source.slice(start, end)}; withSavedAutohideDisabled`, {
    Services: { prefs }, assert: (ok, message) => { if (!ok) throw Error(message); },
  });
  return { prefs, run, writes, original, value: () => userValue, observers };
}
test("saved-autohide gate seeds false only in the fixture and restores original preference provenance", async () => {
  for (const original of [undefined, false, true]) {
    const f = fixture(original);
    const result = await f.run(async () => {
      assert.equal(f.prefs.getBoolPref(), false);
      assert.equal(f.prefs.prefHasUserValue(), true);
      assert.deepEqual(f.writes, [false, "save"]);
    });
    assert.equal(result.observedProductWrites, 0);
    assert.equal(f.value(), original);
    assert.equal(f.observers.size, 0);
  }
});
test("saved-autohide gate rejects even transient product preference writes and restores on every failure", async () => {
  const f = fixture();
  await assert.rejects(f.run(async () => {
    f.prefs.setBoolPref("browser.fullscreen.autohide", true);
    f.prefs.setBoolPref("browser.fullscreen.autohide", false);
  }), /changed the user's saved/);
  assert.equal(f.value(), undefined); assert.equal(f.observers.size, 0);
  const failed = fixture(true);
  await assert.rejects(failed.run(async () => { throw Error("Native hover failed"); }), /Native hover failed/);
  assert.equal(failed.value(), true); assert.equal(failed.observers.size, 0);
});
