"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../chrome/fluxion-memory-policy-verification.js"), "utf8");
const prefix = "fluxion.memory.policyVerification";
async function checkPhase(options = {}) {
  const owned = "/private/tmp/fluxion-memory-policy.unit/profile";
  const prefs = new Map([[`${prefix}.safeBytes`, "0000803E0000803E"]]);
  if (options.enabledPref) prefs.set(options.enabledPref, true);
  const imports = [], sql = [], connections = [], errors = [];
  let elapsed = 0, closed = 0, fetches = 0;
  const row = fields => ({ getResultByName: key => fields[key] });
  const file = initial => ({ path: initial, initWithPath(value) { this.path = value; }, normalize() {},
    equals(other) { return this.path === other.path; } });
  const db = {
    async execute(statement) {
      sql.push(statement);
      if (statement.includes("FROM pages WHERE id=1")) return [row({ n: options.blockedPage ? 1 : elapsed < (options.cleanupDelay || 0) ? 1 : 0 })];
      if (statement.includes("FROM page_vectors WHERE rowid=1")) return [row({ n: options.blockedVector ? 1 : 0 })];
      if (statement.includes("FROM pages WHERE id=2")) return options.missingSafePage ? [] : [row({
        url: "https://memory-policy-fixture.invalid/article", content: options.changedSafePage ? "Changed" : "Original evidence",
      })];
      if (statement.includes("FROM page_vectors WHERE rowid=2")) return options.missingSafeVector ? [] : [row({
        bytes: options.changedSafeVector ? "FFFFFFFF" : prefs.get(`${prefix}.safeBytes`),
      })];
      throw new Error(`Unexpected SQL: ${statement}`);
    },
    async close() { closed++; },
  };
  vm.runInNewContext(source, {
    window: { FluxionMemory: { enabled: () => Boolean(options.memoryEnabled) },
      setTimeout(callback) { elapsed += 5000; callback(); } },
    Date: { now: () => elapsed },
    PathUtils: { profileDir: owned, join: (...parts) => parts.join("/") },
    Cc: { "@mozilla.org/file/local;1": { createInstance: () => file("") } }, Ci: { nsIFile: {} },
    Cu: { reportError: error => errors.push(error) },
    Services: {
      env: { get: key => key === "FLUXION_MEMORY_POLICY_TEST" ? "check" : options.requestedProfile || owned },
      dirsvc: { get: () => file(options.actualProfile || owned) },
      prefs: {
        getBoolPref: (key, fallback) => prefs.get(key) ?? fallback,
        getStringPref: (key, fallback) => prefs.get(key) ?? fallback,
        setBoolPref: (key, value) => prefs.set(key, value),
        setStringPref: (key, value) => prefs.set(key, value), savePrefFile() {},
      },
    },
    ChromeUtils: { importESModule(uri) {
      imports.push(uri);
      if (uri === "resource://gre/modules/Sqlite.sys.mjs") return { Sqlite: { async openConnection(config) { connections.push(config); return db; } } };
      if (uri === "resource://gre/modules/PlacesUtils.sys.mjs") return { PlacesUtils: { history: {
        async fetch() { fetches++; return options.missingVisit ? { visits: [] } : { visits: [{}] }; },
      } } };
      if (uri.includes("PlacesBrowserStartup.sys.mjs")) return { PlacesBrowserStartup: { _placesBrowserInitComplete: true } };
      throw new Error(`Verifier must not import a cleanup implementation: ${uri}`);
    } },
  });
  for (let i = 0; i < 20 && !prefs.has(`${prefix}.check.health`) && !prefs.has(`${prefix}.error`); i++) {
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.ok(prefs.has(`${prefix}.check.health`) || prefs.has(`${prefix}.error`), "Shipped verifier did not finish");
  assert.ok(imports.every(uri => !uri.includes("FluxionMemoryStore")), "Check phase imported Store and could cause its own cleanup");
  assert.ok(sql.every(statement => statement.startsWith("SELECT ")), "Check phase mutated fixture storage");
  return { prefs, imports, sql, connections, errors, elapsed, closed, fetches };
}

test("shipped check phase observes delayed startup cleanup without importing Store or writing SQL", async () => {
  const result = await checkPhase({ cleanupDelay: 10000 });
  assert.equal(result.prefs.get(`${prefix}.check.health`), "disabled-startup-policy-cleanup-verified");
  assert.equal(result.prefs.has(`${prefix}.error`), false);
  assert.equal(result.connections.length, 1);
  assert.equal(result.connections[0].readOnly, true);
  assert.equal(result.elapsed, 10000);
  assert.equal(result.closed, 1);
  assert.equal(result.fetches, 2);
  assert.equal(JSON.parse(result.prefs.get(`${prefix}.report`)).checks.length, 3);
});

test("retained sensitive page reaches bounded deadline; retained vector separately fails", async () => {
  const page = await checkPhase({ blockedPage: true });
  assert.equal(page.elapsed, 45000);
  assert.match(page.prefs.get(`${prefix}.error`), /retained sensitive evidence/);
  assert.equal(page.closed, 1);
  const vector = await checkPhase({ blockedVector: true });
  assert.match(vector.prefs.get(`${prefix}.error`), /Sensitive vector survived/);
  assert.equal(vector.prefs.has(`${prefix}.check.health`), false);
  assert.equal(vector.closed, 1);
});

test("changed or missing safe evidence cannot pass selective-cleanup verification", async () => {
  for (const key of ["missingSafePage", "changedSafePage", "missingSafeVector", "changedSafeVector"]) {
    const result = await checkPhase({ [key]: true });
    assert.match(result.prefs.get(`${prefix}.error`), /Safe (evidence|native vector bytes) changed/, key);
    assert.equal(result.prefs.has(`${prefix}.check.health`), false, key);
    assert.equal(result.closed, 1, key);
  }
});

test("loss of a Places visit fails even when evidence storage is correct", async () => {
  const result = await checkPhase({ missingVisit: true });
  assert.match(result.prefs.get(`${prefix}.error`), /removed an ordinary Places visit/);
  assert.equal(result.prefs.has(`${prefix}.check.health`), false);
});

test("enabled Memory or model gates fail before opening any storage", async () => {
  for (const options of [{ memoryEnabled: true }, ...["fluxion.memory.enabled", "browser.ml.enable", "places.semanticHistory.featureGate"].map(enabledPref => ({ enabledPref }))]) {
    const result = await checkPhase(options);
    assert.match(result.prefs.get(`${prefix}.error`), /unexpectedly enabled|Unexpected enabled gate/);
    assert.equal(result.connections.length, 0);
  }
});

test("wrong owned-profile path or actual Gecko profile fails before storage access", async () => {
  for (const options of [{ requestedProfile: "/private/tmp/user-profile" }, { actualProfile: "/private/tmp/other-profile" }]) {
    const result = await checkPhase(options);
    assert.match(result.prefs.get(`${prefix}.error`), /isolated Memory policy profile|differs from owned fixture/);
    assert.equal(result.imports.length, 0);
    assert.equal(result.connections.length, 0);
  }
});
