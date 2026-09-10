"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../chrome/fluxion-settings-accessibility-verification.js"), "utf8");
const start = source.indexOf("  async function seedExclusionList()");
const end = source.indexOf("  async function verifyResponsiveSettings(root)", start);
assert.ok(start > 0 && end > start);
function fixture({ saved = null, failSave = false, failRemove = false, invalid = false } = {}) {
  let raw = saved;
  let state = { valid: !invalid, readOnly: false, revision: "1", lists: [] };
  const calls = [];
  const context = vm.createContext({
    assert: (condition, message) => { if (!condition) throw new Error(message); },
    Services: { prefs: {
      prefHasUserValue: () => raw !== null, getStringPref: () => raw,
      setStringPref: (_key, value) => { raw = value; calls.push("restore"); },
      clearUserPref: () => { raw = null; calls.push("clear"); }, savePrefFile() {},
    } },
    window: { FluxionMemory: {
      exclusionPolicy: () => structuredClone(state),
      async saveExclusionList(item, revision) {
        assert.equal(revision, "1"); calls.push("save");
        state = { ...state, revision: "2", lists: [{ ...item, id: "fixture" }] }; raw = "fixture policy";
        if (failSave) throw new Error("cleanup failed after commit");
        return structuredClone(state);
      },
      async deleteExclusionList(id, revision) {
        assert.equal(id, "fixture"); assert.equal(revision, "2"); calls.push("delete");
        if (failRemove) throw new Error("cannot remove fixture");
        state = { ...state, lists: [] };
      },
    } },
  });
  vm.runInContext(source.slice(start, end) + "\nglobalThis.seed = seedExclusionList;", context);
  return { seed: context.seed, calls, raw: () => raw };
}
test("native Settings geometry seed uses real API contract and restores exact prior canonical preference", async () => {
  for (const saved of [null, '{"version":1,"directDomains":[],"lists":[]}']) {
    const h = fixture({ saved }); const value = await h.seed();
    assert.equal(value.id, "fixture"); assert.equal(h.raw(), "fixture policy");
    await value.restore(); assert.equal(h.raw(), saved);
    assert.deepEqual(h.calls, ["save", "delete", saved === null ? "clear" : "restore"]);
  }
});
test("native fixture cleans committed seed after rejection and fails closed when restoration cannot complete", async () => {
  const failed = fixture({ failSave: true }); await assert.rejects(failed.seed(), /cleanup failed after commit/);
  assert.equal(failed.raw(), null); assert.deepEqual(failed.calls, ["save", "delete", "clear"]);
  const blocked = fixture({ failRemove: true }); const value = await blocked.seed();
  await assert.rejects(value.restore(), /cannot remove fixture/);
  assert.equal(blocked.raw(), "fixture policy", "must not replace persisted policy after failed cleanup");
});
test("invalid policy cannot be overwritten just to run responsive verification", async () => {
  const h = fixture({ invalid: true }); await assert.rejects(h.seed(), /valid writable exclusion policy/);
  assert.deepEqual(h.calls, []);
});
