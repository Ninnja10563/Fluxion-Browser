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

test("updater seed waits for exact live and naturally delivered session state without accepting extras or duplicates", () => {
  const start = source.indexOf("  function sessionEvidence() {");
  const end = source.indexOf("  async function snapshot", start);
  assert.ok(start > 0 && end > start);
  const urls = ["data:pinned", "data:research", "data:other"];
  let cached = [urls[0], urls[1], "about:blank"];
  const tabs = urls.map(url => ({ linkedBrowser: { currentURI: { spec: url } }, closing: false }));
  const inspect = vm.runInNewContext(`${source.slice(start, end)}; sessionEvidence`, {
    urls, window: { gBrowser: { tabs } }, stateURLs: state => state.tabs,
    SessionStore: { getWindowState: () => ({ windows: [{ tabs: cached }] }) },
  });
  assert.equal(inspect().ready, false);
  assert.deepEqual(Array.from(inspect().cached), cached);
  cached = [...urls]; assert.equal(inspect().ready, true);
  cached = [...urls, "about:blank"]; assert.equal(inspect().ready, false);
  cached = [urls[0], urls[0], urls[2]]; assert.equal(inspect().ready, false);
  cached = [...urls]; tabs[1].closing = true; assert.equal(inspect().ready, false);
  tabs[1].closing = false; tabs.push({ linkedBrowser: { currentURI: { spec: "about:blank" } } });
  assert.equal(inspect().ready, false);
  tabs.pop(); assert.equal(inspect().ready, true);
  assert.doesNotMatch(source, /SessionSaver\.run|TabStateFlusher/);
});
