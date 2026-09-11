"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../chrome/fluxion-structure-verification.js"), "utf8");
const start = source.indexOf("  function complete(primaryError");
assert.ok(start >= 0);
// Execute the shipped completion and its real promise wiring. The 1000-tab
// operation body is outside this cleanup test; no browser behavior is simulated.
const completion = source.slice(start, source.lastIndexOf("})(window);"));
async function fixture({ primary = false, restore = false, remove = false, persist = false, healthFlush = false } = {}) {
  const events = [], prefs = new Map(), logged = [];
  const report = { complete: true, checks: ["native operations completed"] };
  const context = {
    report, prefix: "fluxion.structure.verification", fixtures: [{ parentNode: {} }], original: { parentNode: {} },
    observer: { disconnect() { events.push("disconnect"); } },
    gBrowser: { set selectedTab(value) { events.push("restore"); if (restore) throw Error("restore failed"); },
      removeTabs() { events.push("remove"); if (remove) throw Error("remove failed"); } },
    write(key, value) {
      events.push(key);
      if (key === "report" && persist) throw Error("report flush failed");
      prefs.set(key, value);
      if (key === "health" && healthFlush) throw Error("health flush failed");
    },
    Services: { prefs: { clearUserPref() { prefs.delete("health"); } } },
    Cu: { reportError(error) { logged.push(error.message); } },
    run: () => primary ? Promise.reject(Error("native assertion failed")) : Promise.resolve(),
  };
  await vm.runInNewContext(completion, context);
  return { events, prefs, logged, report };
}

test("shipped completion cleans up and persists report before publishing success", async () => {
  const result = await fixture();
  assert.deepEqual(result.events, ["disconnect", "restore", "remove", "report", "health"]);
  assert.equal(result.prefs.get("health"), "keyed-1000-tab-hierarchical-structure-verified");
  assert.equal(result.prefs.has("error"), false);
});

test("cleanup failures cannot publish success and do not hide the original native failure", async () => {
  const result = await fixture({ primary: true, restore: true, remove: true });
  assert.equal(result.prefs.has("health"), false);
  for (const message of ["native assertion failed", "restore failed", "remove failed"]) assert.ok(result.prefs.get("error").includes(message));
  assert.equal(JSON.parse(result.prefs.get("report")).complete, false);
  assert.ok(result.events.includes("remove"), "restore failure must not skip fixture removal");
  const cleanupOnly = await fixture({ remove: true });
  assert.equal(cleanupOnly.prefs.has("health"), false);
  assert.match(cleanupOnly.prefs.get("error"), /remove failed/);
});

test("report persistence failure prevents success and remains visible", async () => {
  const result = await fixture({ persist: true });
  assert.equal(result.events.includes("health"), false);
  assert.match(result.prefs.get("error"), /report flush failed/);
  assert.equal(result.report.complete, false);
});

test("failed success-pref flush removes its in-memory success marker", async () => {
  const result = await fixture({ healthFlush: true });
  assert.equal(result.prefs.has("health"), false);
  assert.match(result.prefs.get("error"), /health flush failed/);
});
