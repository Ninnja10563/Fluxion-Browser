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

function captureFixture({ exclusionsReceipt = true } = {}) {
  const captureStart = source.indexOf("  async function captureNarrowSettings(surface)");
  const captureEnd = source.indexOf("  run().catch(error =>", captureStart);
  assert.ok(captureStart > 0 && captureEnd > captureStart);
  let elapsed = 0;
  const writes = [], reads = [];
  const context = vm.createContext({
    assert: (value, message) => { if (!value) throw new Error(message); },
    deadline: 100, Date: { now: () => elapsed }, pause: async () => { elapsed += 25; },
    PathUtils: { profileDir: "/owned/profile", parent: () => "/owned", join: (...parts) => parts.join("/") },
    IOUtils: {
      async writeUTF8(file, value) { writes.push({ file, value }); },
      async exists(file) {
        reads.push(file);
        return file === "/owned/capture.sent" ||
          (file === "/owned/capture-exclusions.sent" && exclusionsReceipt && elapsed >= 50);
      },
    },
  });
  vm.runInContext(source.slice(captureStart, captureEnd) + "\nglobalThis.capture = captureNarrowSettings;", context);
  return { capture: context.capture, writes, reads, elapsed: () => elapsed };
}
test("native screenshot handshake preserves Workspaces receipt and requires a separate exclusion-list receipt", async () => {
  const h = captureFixture();
  await h.capture("workspaces"); await h.capture("exclusion-lists");
  assert.deepEqual(h.writes, [{ file: "/owned/capture.ready", value: "ready" },
    { file: "/owned/capture-exclusions.ready", value: "ready" }]);
  assert.equal(h.elapsed(), 50, "Workspaces receipt cannot acknowledge exclusion-list capture");
  assert.equal(h.reads.filter(file => file.endsWith("capture-exclusions.sent")).length, 3);
});
test("missing second capture fails boundedly and unknown surface never touches the driver", async () => {
  const h = captureFixture({ exclusionsReceipt: false });
  await assert.rejects(h.capture("exclusion-lists"), /Narrow exclusion-lists screenshot driver did not respond/);
  assert.equal(h.elapsed(), 100);
  const invalid = captureFixture(); await assert.rejects(invalid.capture("../../other"), /Unknown Settings screenshot surface/);
  assert.deepEqual(invalid.writes, []); assert.deepEqual(invalid.reads, []);
});
