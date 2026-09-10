"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../chrome/fluxion-memory-corruption-verification.js"), "utf8");
const prefix = "fluxion.memory.corruptionVerification";
async function check(options = {}) {
  const owned = "/private/tmp/fluxion-memory-corruption.unit/profile";
  const prefs = new Map([[`${prefix}.baseline`, JSON.stringify({ id: 7, bytes: "0000803E", hash: "1234" })]]);
  if (options.initialized) prefs.set("places.semanticHistory.initialized", true);
  if (options.enabled) prefs.set(options.enabled, true);
  const events = [], errors = [], configs = [];
  let purged = false, elapsed = 0;
  const row = fields => ({ getResultByName: key => fields[key] });
  const file = initial => ({ path: initial, initWithPath(value) { this.path = value; }, normalize() {},
    equals(other) { return this.path === other.path; } });
  vm.runInNewContext(source, {
    window: { FluxionMemory: { enabled: () => false, exclusionPolicy: () => ({ valid: Boolean(options.validPolicy) }) },
      setTimeout(callback) { elapsed += 10000; callback(); } },
    Date: { now: () => elapsed }, PathUtils: { profileDir: owned, join: (...parts) => parts.join("/") },
    Cc: { "@mozilla.org/file/local;1": { createInstance: () => file("") } }, Ci: { nsIFile: {} },
    Cu: { reportError: error => errors.push(error) },
    Services: { env: { get: key => key === "FLUXION_MEMORY_CORRUPTION_TEST" ? "check" : owned },
      dirsvc: { get: () => file(options.wrongProfile ? "/another/profile" : owned) },
      prefs: { getBoolPref: (key, fallback) => prefs.get(key) ?? fallback,
        getStringPref: (key, fallback) => prefs.get(key) ?? fallback, prefHasUserValue: key => prefs.has(key),
        setBoolPref: (key, value) => prefs.set(key, value), setStringPref: (key, value) => prefs.set(key, value),
        clearUserPref: key => prefs.delete(key), savePrefFile() {
          if (options.saveHealthError && prefs.has(`${prefix}.check.health`)) throw new Error("health flush failed");
        } } },
    ChromeUtils: { importESModule(uri) {
      if (uri.includes("PlacesBrowserStartup")) return { PlacesBrowserStartup: { _placesBrowserInitComplete: !options.startupStall } };
      if (uri.includes("PlacesUtils")) return { PlacesUtils: { history: { async fetch() { events.push("places-fetch");
        return { visits: options.missingVisit ? [] : [{}] }; } } } };
      if (uri.includes("PlacesSemanticHistoryManager")) return { getPlacesSemanticHistoryManager() {
        events.push("direct-native-factory"); return { async getConnection() {
          events.push("native-initialized"); return options.nativeAvailable ? {} : null;
        } };
      } };
      if (uri.includes("FluxionNativeMemory")) return { FluxionNativeMemory: { async purge() {
        events.push("explicit-purge"); if (options.purgeError) throw new Error("fixture purge failed"); purged = true;
      } } };
      if (uri.includes("Sqlite")) return { Sqlite: { async openConnection(config) {
        configs.push(config); events.push("raw-open");
        return { async execute(sql) {
          assert.match(sql, /^SELECT /, "Verifier raw connection must never mutate data");
          events.push(purged ? "read-purged" : "read-retained");
          if (purged) return [row({ vectors: options.purgeRetains ? 1 : 0, mappings: 0 })];
          assert.match(sql, /CAST\(m\.url_hash AS TEXT\)/, "Mapping hashes must avoid numeric precision loss");
          return options.missingVector ? [] : [row({ rowid: 7, bytes: options.changedVector ? "FFFFFFFF" : "0000803E", hash: options.changedMapping ? "1235" : "1234" })];
        }, async close() { events.push("raw-close"); if (options.closeError) throw new Error("fixture close failed"); } };
      } } };
      throw new Error(`Unexpected import ${uri}`);
    } },
  });
  for (let i = 0; i < 30 && !prefs.has(`${prefix}.check.health`) && !prefs.has(`${prefix}.error`); i++) {
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.ok(prefs.has(`${prefix}.check.health`) || prefs.has(`${prefix}.error`), "Verifier did not terminate");
  return { prefs, events, errors, configs, elapsed };
}
test("full shipped corruption verifier bypasses adapter, verifies retained bytes before explicit purge, and closes readers before success", async () => {
  const result = await check();
  assert.equal(result.prefs.get(`${prefix}.check.health`), "native-corruption-retention-verified");
  assert.deepEqual(result.events, ["direct-native-factory", "native-initialized", "raw-open", "read-retained", "raw-close",
    "places-fetch", "explicit-purge", "raw-open", "read-purged", "raw-close"]);
  assert.equal(result.configs.length, 2);
  for (const config of result.configs) { assert.equal(config.readOnly, true); assert.match(config.path, /\/places_semantic\.sqlite$/); }
});
test("lost or changed native vector cannot pass or initiate explicit purge", async () => {
  for (const option of ["missingVector", "changedVector", "changedMapping", "missingVisit"]) {
    const result = await check({ [option]: true });
    assert.ok(result.prefs.has(`${prefix}.error`), option);
    assert.equal(result.prefs.has(`${prefix}.check.health`), false);
    assert.equal(result.events.includes("explicit-purge"), false);
  }
});
test("activation marker, enabled native gate, available manager, and wrong profile fail closed", async () => {
  for (const options of [{ initialized: true }, { enabled: "browser.ml.enable" }, { nativeAvailable: true }, { wrongProfile: true }, { validPolicy: true }]) {
    const result = await check(options);
    assert.equal(result.prefs.has(`${prefix}.check.health`), false);
    assert.ok(result.prefs.has(`${prefix}.error`));
    assert.equal(result.configs.length, 0);
  }
});
test("explicit purge rejection, residual data, or reader cleanup failure cannot publish health", async () => {
  for (const option of ["purgeError", "purgeRetains", "closeError"]) {
    const result = await check({ [option]: true });
    assert.ok(result.prefs.has(`${prefix}.error`), option);
    assert.equal(result.prefs.has(`${prefix}.check.health`), false);
  }
});
test("missing Places startup readiness has bounded failure before native construction", async () => {
  const result = await check({ startupStall: true });
  assert.ok(result.elapsed >= 45000 && result.elapsed <= 55000);
  assert.equal(result.events.length, 0);
  assert.match(result.prefs.get(`${prefix}.error`), /Places startup did not finish/);
});
test("failed health flush clears in-memory success before persisting diagnostic failure", async () => {
  const result = await check({ saveHealthError: true });
  assert.equal(result.prefs.has(`${prefix}.check.health`), false);
  assert.match(result.prefs.get(`${prefix}.error`), /health flush failed/);
  assert.equal(result.events.filter(event => event === "raw-close").length, 2);
});
