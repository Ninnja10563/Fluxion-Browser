"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), vm = require("node:vm");
const policy = require("../chrome/core/memory-policy.js");
function fixture() {
  const values = new Map(), observers = new Map();
  let queue = Promise.resolve();
  const prefs = {
    getPrefType: key => !values.has(key) ? 0 : typeof values.get(key) === "string" ? 32 : 128,
    getStringPref: (key, fallback) => values.has(key) ? values.get(key) : fallback,
    setStringPref(key, value) { values.set(key, value); observers.get(key)?.observe(); },
    addObserver: (key, observer) => observers.set(key, observer), savePrefFile() {},
  };
  const context = vm.createContext({ Services: { prefs }, Cu: { reportError(error) { throw error; } },
    FluxionMemoryPolicy: policy, FluxionNativeMemory: { runControl(callback) {
      const result = queue.then(callback); queue = result.catch(() => {}); return result;
    } } });
  vm.runInContext(fs.readFileSync(require.resolve("../modules/FluxionExclusionPolicy.sys.mjs"), "utf8")
    .replace(/^import .*;\n/gm, "").replace("export const FluxionExclusionPolicy", "globalThis.api"), context);
  return { api: context.api, prefs, values };
}
test("pref notifications invalidate even successive wrong-type policies before an explicit recovery can overwrite them", async () => {
  const f = fixture();
  f.prefs.setStringPref(policy.POLICY_PREF, true);
  const before = f.api.snapshot();
  let invalidations = 0, cleanup = 0;
  const unsubscribe = f.api.subscribe(() => { invalidations++; });
  f.prefs.setStringPref(policy.POLICY_PREF, false);
  assert.equal(invalidations, 1);
  assert.notEqual(f.api.snapshot().revision, before.revision);
  await assert.rejects(f.api.update(value => value, before.revision, () => { cleanup++; }, { reset: true }),
    error => error.code === "POLICY_CONFLICT");
  assert.equal(cleanup, 0); assert.equal(f.values.get(policy.POLICY_PREF), false);
  unsubscribe(); f.prefs.setStringPref(policy.POLICY_PREF, "{");
  assert.equal(invalidations, 1);
});
test("legacy migration commits one canonical document and returns its own revision after awaited cleanup", async () => {
  const f = fixture(); f.prefs.setStringPref(policy.LEGACY_PREF, '["old.example"]');
  const before = f.api.snapshot();
  let during;
  const result = await f.api.update(value => ({ ...value, lists: [{ id: "health", name: "Health", enabled: true, domains: ["medical.example"] }] }),
    before.revision, async domains => { during = f.api.snapshot(); assert.deepEqual(Array.from(domains), ["old.example", "medical.example"]); });
  assert.equal(result.revision, during.revision);
  assert.equal(result.legacy, false);
  assert.equal(f.values.get(policy.LEGACY_PREF), '["old.example"]');
  assert.equal(result.lists[0].id, "health");
});
