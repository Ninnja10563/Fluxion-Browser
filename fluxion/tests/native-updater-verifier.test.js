"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../chrome/fluxion-native-updater-verification.js"), "utf8");

test("production windows do no updater-verifier filesystem work or native initialization", async () => {
  const prefs = [], errors = [];
  const context = { window: {}, Services: { prefs: { getBoolPref: (name, fallback) => { prefs.push([name, fallback]); return fallback; } } },
    Cu: { reportError: error => errors.push(error) },
    IOUtils: new Proxy({}, { get() { throw Error("Production verifier must not access filesystem"); } }),
    ChromeUtils: { importESModule() { throw Error("Production verifier must not initialize native updater"); } },
  };
  await vm.runInNewContext(source, context);
  assert.deepEqual(prefs, [["fluxion.verification.nativeUpdater", false]]);
  assert.deepEqual(errors, []);
});

test("a verifier preference alone cannot run the gate without its test-app configuration", async () => {
  const reads = [], errors = [];
  await vm.runInNewContext(source, { window: {}, Ci: { nsIFile: {} },
    Services: { prefs: { getBoolPref: () => true }, dirsvc: { get: () => ({ path: "/owned/Fluxion.app/Contents/Resources" }) } },
    PathUtils: { join: (...parts) => parts.join("/") },
    IOUtils: { exists: async filename => { reads.push(filename); return false; } },
    ChromeUtils: { importESModule() { throw Error("Missing configuration cannot initialize updater"); } },
    Cu: { reportError: error => errors.push(error) },
  });
  assert.deepEqual(reads, ["/owned/Fluxion.app/Contents/Resources/fluxion/runtime/updater-test-gate.json"]);
  assert.deepEqual(errors, []);
});
