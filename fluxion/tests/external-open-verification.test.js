"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");
const settle = () => new Promise(resolve => setImmediate(resolve));

function fixture({ actualPath = "/private/fixture/cafe\u0301 document.html", actualExists = true, expectedExists = true } = {}) {
  const expectedPath = "/private/fixture/caf\u00e9 document.html";
  const expectedURL = pathToFileURL(expectedPath).href;
  const origin = "http://127.0.0.1:9999";
  const prefs = new Map(), timers = [], errors = [];
  let now = 0, normalizations = 0;
  const file = (path, exists) => ({ path, normalize() { normalizations++; }, exists: () => exists });
  const browserWindow = (url, title, local = null) => {
    const tab = { hasAttribute: () => false, linkedBrowser: {
      contentTitle: title, currentURI: { spec: url, scheme: local ? "file" : "http",
        QueryInterface: () => ({ file: local }) },
    } };
    return { gBrowser: { selectedTab: tab, tabs: [tab] } };
  };
  // The fixture observes four preexisting selected native-document stand-ins.
  // No navigation/add-tab method is supplied, so it cannot simulate delivery.
  const windows = [browserWindow(`${origin}/`, "Fluxion browsing fixture"),
    browserWindow(`${origin}/upload`, "Fluxion upload form"),
    browserWindow(pathToFileURL(actualPath).href, "Fluxion external file — JavaScript ran", file(actualPath, actualExists)),
    browserWindow(`${origin}/?fluxion-external-cli=1`, "Fluxion browsing fixture")];
  const environment = { FLUXION_EXTERNAL_OPEN_TEST: "1", FLUXION_EXTERNAL_OPEN_ORIGIN: origin,
    FLUXION_EXTERNAL_OPEN_FILE_URL: expectedURL };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../chrome/fluxion-external-open-verification.js"), "utf8"), {
    window: { setTimeout(callback) { timers.push(callback); } },
    SessionStore: { promiseAllWindowsRestored: Promise.resolve() },
    Date: { now: () => now }, Ci: { nsIFileURL: {} }, Cu: { reportError: error => errors.push(error) },
    Services: { env: { get: name => environment[name] || "" }, appinfo: { processID: 42 },
      wm: { getEnumerator: () => windows }, io: { newURI: () => ({ QueryInterface: () => ({ file: file(expectedPath, expectedExists) }) }) },
      prefs: { getBoolPref: (name, fallback) => prefs.get(name) ?? fallback,
        setBoolPref: (name, value) => prefs.set(name, value), setIntPref: (name, value) => prefs.set(name, value),
        setStringPref: (name, value) => prefs.set(name, value), savePrefFile() {} },
    },
  });
  return { prefs, errors, normalizations: () => normalizations,
    expire() { now += 31000; timers.splice(0).forEach(callback => callback()); } };
}

test("external-open observer accepts existing composed/decomposed spellings of the same local file", async () => {
  const f = fixture(); await settle();
  assert.equal(f.prefs.get("fluxion.externalOpen.health"), "launchservices-cold-warm-unicode-file-and-cli-rendered");
  assert.equal(JSON.parse(f.prefs.get("fluxion.externalOpen.report")).checks.length, 4);
  assert.ok(f.normalizations() >= 2);
  assert.deepEqual(f.errors, []);
});

test("external-open observer rejects a different existing file with the expected document title", async () => {
  const f = fixture({ actualPath: "/private/fixture/other document.html" });
  await settle(); f.expire(); await settle();
  assert.equal(f.prefs.has("fluxion.externalOpen.health"), false);
  assert.match(f.prefs.get("fluxion.externalOpen.error"), /local-file-rendered did not arrive/);
});

test("Unicode-equivalent paths do not pass when either local file is missing", async () => {
  for (const options of [{ actualExists: false }, { expectedExists: false }]) {
    const f = fixture(options); await settle(); f.expire(); await settle();
    assert.equal(f.prefs.has("fluxion.externalOpen.health"), false);
    assert.match(f.prefs.get("fluxion.externalOpen.error"), /local-file-rendered did not arrive/);
  }
});
