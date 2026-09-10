"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
require("../chrome/core/settings.js");

function settingsFixture(initialURL = "about:preferences", saved = [], { sharedPrefs, memory, updates, ai } = {}) {
  const preferences = new Map(saved);
  const elements = [];
  class Element {
    constructor() {
      this.children = []; this.dataset = {}; this.value = "";
      this.attributes = new Map(); this.listeners = new Map();
      this.classList = { add() {} };
      elements.push(this);
    }
    append(...children) {
      this.children.push(...children);
      if (this.tagName === "select") {
        const selected = children.find(child => child.selected);
        if (selected) this.value = selected.value;
      }
    }
    appendChild(child) { this.append(child); return child; }
    replaceChildren(...children) { this.children = children; }
    querySelector(selector) {
      if (selector === "input") return this.children.find(child => child.tagName === "input");
      const value = selector.match(/value="([^"]+)"/)?.[1];
      return this.children.find(child => child.value === value) || null;
    }
    setAttribute(key, value) { this.attributes.set(key, value); }
    getAttribute(key) { return this.attributes.get(key) ?? null; }
    hasAttribute(key) { return this.attributes.has(key); }
    removeAttribute(key) { this.attributes.delete(key); }
    toggleAttribute(key, value) { if (value) this.setAttribute(key, ""); else this.removeAttribute(key); }
    addEventListener(type, callback) {
      this.listeners.set(type, [...(this.listeners.get(type) || []), callback]);
    }
    remove() {}
    removeEventListener(type, callback) { this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item !== callback)); }
    dispatchEvent(event) { for (const callback of this.listeners.get(event.type) || []) callback(event); }
  }
  const browserRoot = new Element(); browserRoot.id = "browser";
  const deck = new Element(); deck.id = "tabbrowser-tabbox";
  const document = {
    documentElement: new Element(),
    getElementById: id => elements.find(element => element.id === id),
    createElementNS: (_ns, tag) => Object.assign(new Element(), { tagName: tag }),
  };
  const firstBrowser = { currentURI: { spec: initialURL } };
  const opened = [];
  let progress;
  const gBrowser = {
    selectedBrowser: firstBrowser, tabContainer: new Element(),
    addTabsProgressListener(listener) { progress = listener; }, removeTabsProgressListener() {},
    addTrustedTab(url) { opened.push(url); return { linkedBrowser: { currentURI: { spec: url } } }; },
  };
  const window = Object.assign(new Element(), {
    document, FluxionMemory: memory, Event: class { constructor(type) { this.type = type; } },
    FluxionUI: { workspaces: () => [], currentWorkspace: () => "work", setTabWorkspace() {} },
    FluxionTheme: { current: () => "system" },
    FluxionAI: ai || { config: () => ({ provider: "disabled", endpoint: "", model: "" }) },
    FluxionShortcuts: { actions: () => [] },
  });
  const errors = [];
  const prefs = sharedPrefs || {
    addObserver() {}, removeObserver() {},
    getBoolPref: (_, fallback) => fallback, getIntPref: (_, fallback) => fallback,
    getStringPref: (key, fallback) => preferences.get(key) ?? fallback,
    setStringPref: (key, value) => preferences.set(key, value), savePrefFile() {},
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../chrome/fluxion-settings.js"), "utf8"), {
    window, gBrowser,
    ChromeUtils: { importESModule: name => name.includes("FluxionUpdates") ? { FluxionUpdates: updates }
      : { SearchService: { init: async () => {}, getVisibleEngines: async () => [] } } },
    Services: { prefs, env: { get: () => "" }, appinfo: { OS: "Darwin", platformVersion: "155.0.1", platformBuildID: "20260901000000" } },
    Cu: { reportError: error => errors.push(error) },
    FluxionSettings: globalThis.FluxionSettings,
    FluxionAIProviders: require("../chrome/core/ai-providers.js"),
    FluxionPermissionPolicy: require("../chrome/core/permissions.js"),
    FluxionWorkspaces: require("../chrome/core/workspaces.js"),
    FluxionWorkspaceEditor: require("../chrome/core/workspace-editor.js"),
  });
  const root = document.getElementById("fluxion-settings");
  return {
    gBrowser, firstBrowser, root, deck, errors, preferences, window, document, opened,
    unload() { window.dispatchEvent({ type: "unload" }); },
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

module.exports = settingsFixture;
