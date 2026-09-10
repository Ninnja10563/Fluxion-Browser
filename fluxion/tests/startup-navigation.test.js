"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function startupFixture(selectedURL) {
  const preferences = new Map();
  const loadedScripts = [];
  const navigations = [];
  const errors = [];
  const AboutNewTab = {};
  let startupObserver;
  class File {
    constructor(filePath = "") { this.path = filePath; }
    initWithPath(filePath) { this.path = filePath; }
    clone() { return new File(this.path); }
    append(part) { this.path += `/${part}`; }
    exists() { return true; }
    isFile() { return true; }
  }
  const Services = {
    env: { get: name => name === "FLUXION_ROOT" ? "/app/fluxion" : "" },
    io: {
      newFileURI: file => ({ spec: `file://${file.path}` }),
      newURI: spec => ({ spec }),
      getProtocolHandler: () => ({ QueryInterface: () => ({ setSubstitution() {} }) }),
    },
    prefs: {
      setStringPref: (key, value) => preferences.set(key, value),
      setBoolPref: (key, value) => preferences.set(key, value),
      getStringPref: (key, fallback) => preferences.get(key) ?? fallback,
      getBoolPref: (key, fallback) => preferences.get(key) ?? fallback,
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
  return { preferences, loadedScripts, navigations, errors, AboutNewTab, window, selectedBrowser };
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
