"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function startupFixture(selectedURL, saved = [], options = {}) {
  const preferences = new Map(saved);
  const defaults = new Map();
  const loadedScripts = [];
  const navigations = [];
  const errors = [];
  const registeredManifests = [];
  const AboutNewTab = {};
  let startupObserver;
  class File {
    constructor(filePath = "") { this.path = filePath; }
    initWithPath(filePath) { this.path = filePath; }
    clone() { return new File(this.path); }
    append(part) { this.path += `/${part}`; }
    exists() { return !(options.missingDefaults && this.path.endsWith("/chrome.manifest")); }
    isFile() { return true; }
  }
  const Services = {
    dirsvc: { get: key => { assert.equal(key, "GreD"); return new File("/app"); } },
    env: { get: name => name === "FLUXION_ROOT" ? "/app/fluxion" : "" },
    io: {
      newFileURI: file => ({ spec: `file://${file.path}` }),
      newURI: spec => ({ spec }),
      getProtocolHandler: () => ({ QueryInterface: () => ({ setSubstitution() {} }) }),
    },
    prefs: {
      setStringPref: (key, value) => preferences.set(key, value),
      setBoolPref: (key, value) => preferences.set(key, value),
      getStringPref: (key, fallback) => preferences.get(key) ?? defaults.get(key) ?? fallback,
      getBoolPref: (key, fallback) => preferences.get(key) ?? fallback,
      prefHasUserValue: key => preferences.has(key),
      getDefaultBranch: () => ({ setStringPref: (key, value) => defaults.set(key, value) }),
      clearUserPref: key => preferences.delete(key),
      savePrefFile() {},
    },
    scriptloader: { loadSubScript: uri => loadedScripts.push(uri) },
    obs: { addObserver(observer, topic) {
      assert.equal(topic, "browser-delayed-startup-finished");
      startupObserver = observer;
    } },
    scriptSecurityManager: { getSystemPrincipal: () => ({}) },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../runtime/fluxion.cfg"), "utf8"), {
    Services,
    Components: { manager: { QueryInterface: () => ({ autoRegister(file) {
      assert.equal(startupObserver, undefined, "Defaults must register before browser startup observation");
      registeredManifests.push(file.path);
    } }) } },
    Ci: {}, Cc: { "@mozilla.org/file/local;1": { createInstance: () => new File() } },
    Cu: { reportError: error => errors.push(error) },
    ChromeUtils: { registerWindowActor() {}, importESModule: () => ({ AboutNewTab }) },
  });
  const selectedBrowser = {
    currentURI: { spec: selectedURL },
    loadURI(...args) { navigations.push(args); },
    fixupAndLoadURIString(...args) { navigations.push(args); },
  };
  const selectedTab = { linkedBrowser: selectedBrowser };
  const window = {
    document: { documentURI: "chrome://browser/content/browser.xhtml" },
    gBrowser: { selectedBrowser, selectedTab, tabs: [selectedTab], loadURI(...args) { navigations.push(args); } },
  };
  startupObserver.observe(window, "browser-delayed-startup-finished");
  return { preferences, defaults, registeredManifests, loadedScripts, navigations, errors, AboutNewTab, window, selectedBrowser };
}

test("only the bundled default-bookmark resource registers before Places startup", () => {
  const h = startupFixture("about:blank");
  assert.deepEqual(h.registeredManifests, ["/app/fluxion-defaults/chrome.manifest"]);
  assert.equal(h.preferences.has("browser.places.importBookmarksHTML"), false);
  assert.equal(h.preferences.has("browser.bookmarks.restore_default_bookmarks"), false);
});

test("missing packaged defaults is reported without navigating or editing the profile", () => {
  const h = startupFixture("https://example.com/restored", [], { missingDefaults: true });
  assert.match(h.preferences.get("fluxion.defaults.error"), /manifest is missing/);
  assert.equal(h.registeredManifests.length, 0);
  assert.equal(h.window.__fluxionLoaded, true);
  assert.deepEqual(h.navigations, []);
});

for (const homepage of ["https://example.com/home", "about:blank", "file:///Users/test/home.html"]) {
  test(`startup retains the user's homepage ${homepage} and bookmarks choice`, () => {
    const h = startupFixture("about:blank", [
      ["browser.startup.homepage", homepage],
      ["browser.toolbars.bookmarks.visibility", "always"],
      ["browser.startup.page", 0],
    ]);
    assert.deepEqual(h.errors, []);
    assert.equal(h.preferences.get("browser.startup.homepage"), homepage);
    assert.equal(h.preferences.get("browser.toolbars.bookmarks.visibility"), "always");
    assert.equal(h.preferences.get("browser.startup.page"), 0);
    assert.equal(h.defaults.get("browser.startup.homepage"), h.AboutNewTab.newTabURL);
  });
}

for (const savedHomepage of ["file:///old/Fluxion.app/fluxion/newtab/index.html", "about:newtab"]) {
  test(`managed homepage ${savedHomepage} follows the installed bundle location`, () => {
    const h = startupFixture("about:blank", [
      ["fluxion.newtab.url", "file:///old/Fluxion.app/fluxion/newtab/index.html"],
      ["browser.startup.homepage", savedHomepage],
    ]);
    assert.deepEqual(h.errors, []);
    assert.equal(h.preferences.has("browser.startup.homepage"), false);
    assert.equal(h.defaults.get("browser.startup.homepage"), "file:///app/fluxion/newtab/index.html");
  });
}

for (const selectedURL of [
  "about:blank", "about:home", "about:newtab",
  "https://example.com/restored-split-a", "file:///Users/test/document.html",
]) {
  test(`startup preserves the selected browser at ${selectedURL}`, () => {
    const h = startupFixture(selectedURL);
    assert.equal(h.window.__fluxionLoaded, true);
    assert.deepEqual(h.errors, []);
    assert.ok(h.loadedScripts.includes("resource://fluxion/chrome/fluxion-session-recovery.js"));
    assert.deepEqual(h.navigations, [], "startup must leave SessionStore's selected browser untouched");
    assert.equal(h.selectedBrowser.currentURI.spec, selectedURL);
    assert.equal(h.AboutNewTab.newTabURL, "file:///app/fluxion/newtab/index.html");
    assert.equal(h.preferences.get("fluxion.newtab.url"), h.AboutNewTab.newTabURL);
  });
}
