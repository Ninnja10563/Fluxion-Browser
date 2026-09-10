"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
require("../chrome/core/settings.js");

function settingsFixture(initialURL = "about:preferences", saved = []) {
  const preferences = new Map(saved);
  const elements = [];
  class Element {
    constructor() {
      this.children = []; this.dataset = {}; this.value = "";
      this.attributes = new Map(); this.listeners = new Map();
      this.classList = { add() {} };
      elements.push(this);
    }
    append(...children) { this.children.push(...children); }
    appendChild(child) { this.append(child); return child; }
    replaceChildren(...children) { this.children = children; }
    querySelector(selector) {
      const value = selector.match(/value="([^"]+)"/)?.[1];
      return this.children.find(child => child.value === value) || null;
    }
    setAttribute(key, value) { this.attributes.set(key, value); }
    hasAttribute(key) { return this.attributes.has(key); }
    removeAttribute(key) { this.attributes.delete(key); }
    toggleAttribute(key, value) { if (value) this.setAttribute(key, ""); else this.removeAttribute(key); }
    addEventListener(type, callback) {
      this.listeners.set(type, [...(this.listeners.get(type) || []), callback]);
    }
    dispatchEvent(event) { for (const callback of this.listeners.get(event.type) || []) callback(event); }
  }
  const browserRoot = new Element(); browserRoot.id = "browser";
  const deck = new Element(); deck.id = "tabbrowser-tabbox";
  const document = {
    documentElement: new Element(),
    getElementById: id => elements.find(element => element.id === id),
    createElementNS: () => new Element(),
  };
  const firstBrowser = { currentURI: { spec: initialURL } };
  let progress;
  const gBrowser = {
    selectedBrowser: firstBrowser, tabContainer: new Element(),
    addTabsProgressListener(listener) { progress = listener; },
  };
  const window = Object.assign(new Element(), {
    document, Event: class { constructor(type) { this.type = type; } },
    FluxionUI: { workspaces: () => [], currentWorkspace: () => "work" },
    FluxionTheme: { current: () => "system" },
    FluxionAI: { config: () => ({ provider: "disabled", endpoint: "", model: "" }) },
    FluxionShortcuts: { actions: () => [] },
  });
  const errors = [];
  const prefs = {
    getBoolPref: (_, fallback) => fallback, getIntPref: (_, fallback) => fallback,
    getStringPref: (key, fallback) => preferences.get(key) ?? fallback,
    setStringPref: (key, value) => preferences.set(key, value), savePrefFile() {},
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../chrome/fluxion-settings.js"), "utf8"), {
    window, gBrowser,
    ChromeUtils: { importESModule: () => ({ SearchService: { init: async () => {}, getVisibleEngines: async () => [] } }) },
    Services: { prefs, env: { get: () => "" }, appinfo: { platformVersion: "155.0.1", platformBuildID: "20260901000000" } },
    Cu: { reportError: error => errors.push(error) },
    FluxionSettings: globalThis.FluxionSettings,
    FluxionAIProviders: require("../chrome/core/ai-providers.js"),
    FluxionPermissionPolicy: require("../chrome/core/permissions.js"),
    FluxionWorkspaces: require("../chrome/core/workspaces.js"),
  });
  const root = document.getElementById("fluxion-settings");
  return {
    gBrowser, firstBrowser, root, deck, errors, preferences,
    homepage: elements.find(element => element.type === "text" && element.spellcheck === false),
    section: () => elements.find(element => element.dataset.section && !element.hidden)?.dataset.section,
    choose(label) {
      const nav = elements.find(element => element.className === "fluxion-settings-nav");
      const button = nav.children.find(element => element.textContent === label);
      assert.ok(button, `Settings section ${label} exists`);
      button.dispatchEvent({ type: "click" });
    },
    select(browser) {
      gBrowser.selectedBrowser = browser;
      gBrowser.tabContainer.dispatchEvent({ type: "TabSelect" });
    },
    location(browser, isTopLevel = true) { progress.onLocationChange(browser, { isTopLevel }); },
  };
}

test("home setting maps new-tab choice to Fluxion and preserves explicit custom addresses", () => {
  const url = "file:///Applications/Fluxion.app/Contents/Resources/fluxion/newtab/index.html";
  const h = settingsFixture("about:preferences", [["fluxion.newtab.url", url]]);
  for (const value of ["about:newtab", "https://example.com/home", "about:blank", "file:///Users/test/home.html"]) {
    h.homepage.value = value;
    h.homepage.dispatchEvent({ type: "change" });
    assert.equal(h.preferences.get("browser.startup.homepage"), value === "about:newtab" ? url : value);
    assert.equal(h.homepage.value, value);
  }
});

test("settings respects the initial query and hash deep links", () => {
  assert.equal(settingsFixture("about:preferences?fluxion=search").section(), "search");
  assert.equal(settingsFixture("about:preferences#privacy").section(), "privacy");
});

test("same-URI progress preserves the section selected in settings", () => {
  const h = settingsFixture("about:preferences?fluxion=search");
  h.choose("Workspaces");
  h.location(h.firstBrowser);
  assert.equal(h.section(), "workspaces");
});

test("background browser and subframe progress cannot reroute settings", () => {
  const h = settingsFixture();
  h.choose("Privacy");
  h.firstBrowser.currentURI.spec = "about:preferences?fluxion=search";
  h.location({ currentURI: { spec: "https://example.com/" } });
  assert.equal(h.section(), "privacy");
  h.location(h.firstBrowser, false);
  assert.equal(h.section(), "privacy");
  h.location(h.firstBrowser);
  assert.equal(h.section(), "search");
});

test("each settings tab retains its own section when switching through a webpage", () => {
  const h = settingsFixture();
  h.choose("Privacy");
  const second = { currentURI: { spec: "about:preferences" } };
  h.select(second);
  assert.equal(h.section(), "general");
  h.choose("Appearance");
  h.select({ currentURI: { spec: "https://example.com/" } });
  assert.equal(h.root.hidden, true);
  assert.equal(h.deck.hidden, false);
  h.select(h.firstBrowser);
  assert.equal(h.section(), "privacy");
  assert.equal(h.root.hidden, false);
  assert.equal(h.deck.hidden, true);
  h.select(second);
  assert.equal(h.section(), "appearance");
});

test("a new settings URI overrides the remembered section for that browser", () => {
  const h = settingsFixture("about:preferences?fluxion=search");
  h.choose("Appearance");
  h.firstBrowser.currentURI.spec = "about:preferences?fluxion=privacy";
  h.location(h.firstBrowser);
  assert.equal(h.section(), "privacy");
  h.firstBrowser.currentURI.spec = "about:preferences";
  h.location(h.firstBrowser);
  assert.equal(h.section(), "general");
});
