"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function startupFixture(selectedURL, saved = [], options = {}) {
  const preferences = new Map(saved);
  const defaults = new Map(options.defaults || []);
  const locked = new Set(options.locked || []);
  const effectivePref = key => locked.has(key) ? defaults.get(key) : preferences.get(key) ?? defaults.get(key);
  const loadedScripts = [];
  const navigations = [];
  const errors = [];
  const registeredManifests = [];
  const AboutNewTab = {};
  let startupObserver;
  let profileObserver;
  let managerCalls = 0;
  const boundaryEvents = [];
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
    env: { get: name => name === "FLUXION_ROOT" ? "/app/fluxion" : options.env?.[name] ?? "" },
    io: {
      newFileURI: file => ({ spec: `file://${file.path}` }),
      newURI: spec => ({ spec }),
      getProtocolHandler: () => ({ QueryInterface: () => ({ setSubstitution() {} }) }),
    },
    prefs: {
      setStringPref: (key, value) => preferences.set(key, value),
      setBoolPref: (key, value) => preferences.set(key, value),
      getStringPref: (key, fallback) => effectivePref(key) ?? fallback,
      getBoolPref: (key, fallback) => effectivePref(key) ?? fallback,
      getIntPref: (key, fallback) => effectivePref(key) ?? fallback,
      prefHasUserValue: key => preferences.has(key),
      prefIsLocked: key => locked.has(key),
      lockPref: key => locked.add(key),
      getPrefType: key => effectivePref(key) === undefined ? 0 : typeof effectivePref(key) === "string" ? 32 : 128,
      getDefaultBranch: () => ({
        setStringPref: (key, value) => defaults.set(key, value),
        setBoolPref: (key, value) => defaults.set(key, value),
        setIntPref: (key, value) => defaults.set(key, value),
        getBoolPref: (key, fallback) => defaults.get(key) ?? fallback,
      }),
      clearUserPref: key => preferences.delete(key),
      savePrefFile() {},
    },
    scriptloader: { loadSubScript: uri => loadedScripts.push(uri) },
    obs: { addObserver(observer, topic) {
      if (topic === "profile-after-change") { profileObserver = observer; return; }
      assert.equal(topic, "browser-delayed-startup-finished");
      startupObserver = observer;
    }, removeObserver(observer, topic) {
      assert.equal(topic, "profile-after-change");
      assert.equal(observer, profileObserver);
      profileObserver = undefined;
    } },
    scriptSecurityManager: { getSystemPrincipal: () => ({}) },
  };
  vm.runInNewContext(options.runtimeSource ?? fs.readFileSync(path.join(__dirname, "../runtime/fluxion.cfg"), "utf8"), {
    Services,
    Components: { manager: { QueryInterface: () => ({ autoRegister(file) {
      assert.equal(startupObserver, undefined, "Defaults must register before browser startup observation");
      registeredManifests.push(file.path);
    } }) } },
    Ci: {}, Cc: { "@mozilla.org/file/local;1": { createInstance: () => new File() } },
    Cu: { reportError: error => errors.push(error) },
    ChromeUtils: { registerWindowActor() {}, importESModule: uri => {
      if (uri.endsWith("FluxionMemoryPolicy.sys.mjs")) return { FluxionMemoryPolicy: require("../chrome/core/memory-policy.js") };
      if (uri.endsWith("FluxionUrlbarMemory.sys.mjs")) return { FluxionUrlbarMemory: { ensurePolicyBoundary() {
        boundaryEvents.push("urlbar");
        if (options.boundaryError) throw new Error("URL-bar boundary unavailable");
      } } };
      if (uri.endsWith("FluxionNativeMemory.sys.mjs")) return { FluxionNativeMemory: { getManager() {
        boundaryEvents.push("native");
        managerCalls++;
        if (options.managerError) throw new Error("native manager unavailable");
      } } };
      return { AboutNewTab };
    } },
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
  return { preferences, defaults, prefs: Services.prefs, registeredManifests, loadedScripts, navigations, errors, AboutNewTab, window, selectedBrowser,
    profileReady() { profileObserver?.(); }, get profilePending() { return !!profileObserver; },
    get managerCalls() { return managerCalls; }, boundaryEvents };
}

// Frozen from 0.74 (c2e67888): gating must preserve the dependency order of
// every production script and each explicitly enabled native verifier.
const startupLoadOrder = require("./fixtures/startup-load-order.json");
const verificationRules = [
  ["tab-links", "FLUXION_TAB_LINKS_TEST"],
  ["duplicate-tabs", "FLUXION_DUPLICATE_TABS_TEST"],
  ["tab-transfer", "FLUXION_TAB_TRANSFER_TEST"],
  ["browsing", "FLUXION_VISUAL_BROWSING_TEST"],
  ["library", "FLUXION_LIBRARY_SCALE_TEST"],
  ["memory-candidate", "FLUXION_MEMORY_PRIVACY_TEST"],
  ["memory-privacy", "FLUXION_MEMORY_PRIVACY_TEST"],
  ["memory-migration", "FLUXION_SEMANTIC_MODEL_TEST"],
  ["update", "FLUXION_UPDATE_TEST"],
  ["external-open", "FLUXION_EXTERNAL_OPEN_TEST"],
  ["settings-accessibility", "FLUXION_SETTINGS_ACCESSIBILITY_TEST"],
  ["ai-privacy", "FLUXION_AI_PRIVACY_TEST"],
  ["workspace", "FLUXION_WORKSPACE_TEST"],
  ["file-picker", "FLUXION_FILE_PICKER_TEST"],
  ["shortcut", "FLUXION_SHORTCUT_TEST"],
  ["selection", "FLUXION_SELECTION_TEST"],
  ["structure", "FLUXION_STRUCTURE_TEST"],
  ["frame", "FLUXION_FRAME_TEST"],
  ["new-tab", "FLUXION_NEW_TAB_TEST"],
  ["product-chrome", "FLUXION_PRODUCT_CHROME_TEST"],
  ["branding", "FLUXION_VERIFY_BRANDING"],
  ["migration", "FLUXION_MIGRATION_TEST"],
  ["workspace-gesture", "FLUXION_WORKSPACE_GESTURE_TEST"],
  ["last-window", "FLUXION_LAST_WINDOW_TEST", ["seed", "restore", "existing", "existing-restore", "existing-quit-restore", "choice0", "choice1"]],
  ["memory-policy", "FLUXION_MEMORY_POLICY_TEST", ["seed", "check"]],
  ["memory-corruption", "FLUXION_MEMORY_CORRUPTION_TEST", ["seed", "check"]],
  ["default-bookmarks", "FLUXION_DEFAULT_BOOKMARKS_TEST", ["seed", "restore"]],
  ["branding-upgrade", "FLUXION_BRANDING_CACHE_PHASE", ["seed", "legacy", "repaired", "warm"]],
  ["sidebar-width", "FLUXION_SIDEBAR_WIDTH_PHASE", ["seed", "restore"], "FLUXION_SIDEBAR_WIDTH_TEST"],
  ["colors", "FLUXION_COLORS_PHASE", ["seed", "restore"], "FLUXION_COLORS_TEST"],
].map(([name, environment, values = ["1"], prerequisite]) => ({
  file: `chrome/fluxion-${name}-verification.js`, environment, values, prerequisite,
}));
const recoveryFlags = [
  "FLUXION_SESSION_SEED_TEST", "FLUXION_SESSION_RESTORE_TEST",
  "FLUXION_PRIVATE_ISOLATION_TEST", "FLUXION_PRIVATE_ABSENCE_TEST",
  "FLUXION_STARTUP_PREFERENCES_SEED_TEST", "FLUXION_STARTUP_HOMEPAGE_TEST",
  "FLUXION_STARTUP_BLANK_SEED_TEST", "FLUXION_STARTUP_BLANK_TEST",
  "FLUXION_CRASH_SEED_TEST", "FLUXION_CRASH_RESTORE_TEST",
];
const recoveryScript = "chrome/fluxion-session-recovery.js";
const updaterScript = "chrome/fluxion-native-updater-verification.js";
const updaterPreference = "fluxion.verification.nativeUpdater";
const verificationFiles = new Set([...verificationRules.map(rule => rule.file), recoveryScript, updaterScript]);

function assertStartupLoads(env = {}, updater = false) {
  const enabled = new Set(verificationRules.filter(rule =>
    rule.values.includes(env[rule.environment]) && (!rule.prerequisite || env[rule.prerequisite] === "1"),
  ).map(rule => rule.file));
  if (recoveryFlags.some(name => env[name] === "1")) enabled.add(recoveryScript);
  if (updater) enabled.add(updaterScript);
  const expected = startupLoadOrder.filter(file => !verificationFiles.has(file) || enabled.has(file));
  expected.splice(expected.indexOf("chrome/fluxion-chrome.js"), 0, "chrome/fluxion-empty-workspace.js");
  const fixture = startupFixture("https://example.com/restored", [[updaterPreference, updater]], { env });
  assert.deepEqual(fixture.errors, []);
  assert.deepEqual(fixture.loadedScripts, expected.map(file => `resource://fluxion/${file}`));
  assert.deepEqual(fixture.navigations, []);
  return fixture;
}

test("normal startup skips all 32 native-test payloads and preserves production dependency order", () => {
  assert.equal(startupLoadOrder.length, 105);
  assert.equal(verificationFiles.size, 32);
  assert.ok([...verificationFiles].every(file => startupLoadOrder.includes(file)));
  const fixture = assertStartupLoads();
  assert.equal(fixture.loadedScripts.length, 74);
  assert.ok(fixture.loadedScripts.includes("resource://fluxion/chrome/fluxion-tab-sleeping.js"));
  assert.ok(fixture.loadedScripts.includes("resource://fluxion/chrome/core/session-recovery.js"));
});

for (const rule of verificationRules) {
  test(`startup gates ${path.basename(rule.file)} on its exact native-test modes`, () => {
    const prerequisite = rule.prerequisite ? { [rule.prerequisite]: "1" } : {};
    for (const value of rule.values) assertStartupLoads({ ...prerequisite, [rule.environment]: value });
    for (const value of ["", "0", "false", "true", "yes", "2", "future-mode"]) {
      assertStartupLoads({ ...prerequisite, [rule.environment]: value });
    }
    if (rule.prerequisite) {
      for (const value of rule.values) for (const flag of ["", "0", "true"]) {
        assertStartupLoads({ [rule.environment]: value, [rule.prerequisite]: flag });
      }
    }
  });
}

test("every session recovery test retains its exact opt-in without loading it for production", () => {
  for (const environment of recoveryFlags) {
    assertStartupLoads({ [environment]: "1" });
    for (const value of ["", "0", "false", "true", "2"]) assertStartupLoads({ [environment]: value });
  }
});

test("native updater follows its persistent verification preference, including relaunch", () => {
  assertStartupLoads({}, true);
  assertStartupLoads({ FLUXION_NATIVE_UPDATER_TEST: "1" });
});

test("unrecognized test flags do not enable any verification scripts", () => {
  assertStartupLoads({ FLUXION_TEST: "1", FLUXION_ANY_TEST: "1", FLUXION_UNKNOWN_TEST: "1" });
});

test("all explicitly enabled verifiers retain the original complete startup order", () => {
  const env = Object.fromEntries(verificationRules.flatMap(rule => [
    [rule.environment, rule.values[0]], ...(rule.prerequisite ? [[rule.prerequisite, "1"]] : []),
  ]));
  env[recoveryFlags[0]] = "1";
  assert.equal(assertStartupLoads(env, true).loadedScripts.length, 106);
});

test("native fullscreen autohide is a product default without overriding saved or managed choices", () => {
  const name = "browser.fullscreen.autohide";
  const fresh = startupFixture("about:blank");
  assert.equal(fresh.prefs.getBoolPref(name), true);
  assert.equal(fresh.preferences.has(name), false);
  assert.equal(fresh.prefs.prefIsLocked(name), false);
  const saved = startupFixture("about:blank", [[name, false]]);
  assert.equal(saved.prefs.getBoolPref(name), false);
  assert.equal(saved.defaults.get(name), true);
  const managed = startupFixture("about:blank", [], { defaults: [[name, false]], locked: [name] });
  assert.equal(managed.prefs.getBoolPref(name), false);
  assert.equal(managed.defaults.get(name), false);
  assert.equal(managed.prefs.prefIsLocked(name), true);
});

test("fresh profiles restore normal sessions and show bookmarks using defaults, not user overrides", () => {
  const h = startupFixture("about:blank");
  assert.deepEqual(h.errors, []);
  assert.equal(h.prefs.getIntPref("browser.startup.page"), 3);
  assert.equal(h.prefs.getStringPref("browser.toolbars.bookmarks.visibility"), "always");
  for (const name of ["browser.startup.page", "browser.toolbars.bookmarks.visibility"]) {
    assert.equal(h.preferences.has(name), false);
    assert.equal(h.prefs.prefIsLocked(name), false);
  }
});

for (const startup of [0, 1, 3]) for (const visibility of ["always", "newtab", "never"]) {
  test(`startup preserves explicit session=${startup} and bookmarks=${visibility}`, () => {
    const h = startupFixture("https://example.com/restored", [
      ["browser.startup.page", startup], ["browser.toolbars.bookmarks.visibility", visibility],
    ]);
    assert.deepEqual(h.errors, []);
    assert.equal(h.prefs.getIntPref("browser.startup.page"), startup);
    assert.equal(h.prefs.getStringPref("browser.toolbars.bookmarks.visibility"), visibility);
    assert.deepEqual(h.navigations, []);
  });
}

test("full startup disables an inherited Firefox VPN enrollment without altering the selected page", () => {
  const h = startupFixture("https://example.com/restored", [["browser.ipProtection.enabled", true]]);
  assert.deepEqual(h.errors, []);
  assert.equal(h.prefs.getBoolPref("browser.ipProtection.enabled"), false);
  assert.equal(h.prefs.getDefaultBranch("").getBoolPref("browser.ipProtection.enabled"), false);
  assert.equal(h.prefs.prefIsLocked("browser.ipProtection.enabled"), true);
  h.prefs.setBoolPref("browser.ipProtection.enabled", true);
  assert.equal(h.prefs.getBoolPref("browser.ipProtection.enabled"), false);
  assert.deepEqual(h.navigations, []);
});

test("startup removes suggestion marketing headings without disabling bookmark results", () => {
  const h = startupFixture("https://example.com/restored", [
    ["browser.urlbar.groupLabels.enabled", true], ["browser.urlbar.suggest.bookmark", true],
  ]);
  assert.deepEqual(h.errors, []);
  assert.equal(h.prefs.getBoolPref("browser.urlbar.groupLabels.enabled"), false);
  assert.equal(h.prefs.getBoolPref("browser.urlbar.suggest.bookmark"), true);
  assert.deepEqual(h.navigations, []);
});

for (const removal of [false, true]) {
  test(`invalid startup policy blocks native construction and preserves removal=${removal}`, () => {
    const h = startupFixture("about:blank", [
      ["fluxion.memory.enabled", true], ["fluxion.memory.exclusionPolicy", "{"],
      ["places.semanticHistory.removeOnStartup", removal],
      ["places.semanticHistory.initialized", true],
    ]);
    assert.equal(h.preferences.get("browser.ml.enable"), false);
    assert.equal(h.preferences.get("places.semanticHistory.featureGate"), false);
    assert.equal(h.preferences.get("places.semanticHistory.removeOnStartup"), removal);
    assert.equal(h.preferences.has("fluxion.memory.nativePendingRemoval"), false);
    assert.equal(h.preferences.has("places.semanticHistory.initialized"), false);
    h.profileReady();
    assert.equal(h.profilePending, false);
    assert.equal(h.managerCalls, 0);
  });
}

test("policy becoming invalid before profile readiness blocks native construction without scheduling deletion", () => {
  const h = startupFixture("about:blank", [["fluxion.memory.enabled", true]]);
  assert.equal(h.profilePending, true);
  h.preferences.set("fluxion.memory.exclusionPolicy", "{");
  h.preferences.set("places.semanticHistory.initialized", true);
  h.profileReady();
  assert.equal(h.managerCalls, 0);
  assert.equal(h.profilePending, false);
  assert.equal(h.preferences.get("browser.ml.enable"), false);
  assert.equal(h.preferences.get("places.semanticHistory.featureGate"), false);
  assert.equal(h.preferences.get("places.semanticHistory.removeOnStartup"), false);
  assert.equal(h.preferences.has("fluxion.memory.nativePendingRemoval"), false);
  assert.equal(h.preferences.has("places.semanticHistory.initialized"), false);
});

test("valid startup initializes the write guard and genuine native failure remains quarantined", () => {
  for (const managerError of [false, true]) {
    const h = startupFixture("about:blank", [["fluxion.memory.enabled", true]], { managerError });
    h.profileReady();
    assert.deepEqual(h.boundaryEvents, ["urlbar", "native"]);
    assert.equal(h.managerCalls, 1);
    assert.equal(h.preferences.get("browser.ml.enable"), !managerError);
    assert.equal(h.preferences.get("places.semanticHistory.removeOnStartup"), managerError);
    assert.equal(h.preferences.get("fluxion.memory.nativePendingRemoval") ?? false, managerError);
    assert.equal(h.errors.length, Number(managerError));
  }
});

test("unavailable URL-bar policy boundary disables models without scheduling data deletion", () => {
  const h = startupFixture("about:blank", [["fluxion.memory.enabled", true]], { boundaryError: true });
  h.profileReady();
  assert.deepEqual(h.boundaryEvents, ["urlbar"]);
  assert.equal(h.managerCalls, 0);
  assert.equal(h.preferences.get("browser.ml.enable"), false);
  assert.equal(h.preferences.get("places.semanticHistory.featureGate"), false);
  assert.equal(h.preferences.get("places.semanticHistory.removeOnStartup"), false);
  assert.equal(h.preferences.has("fluxion.memory.nativePendingRemoval"), false);
  assert.match(h.preferences.get("fluxion.memory.urlbarBoundary.error"), /unavailable/);
});

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
    assert.ok(h.loadedScripts.includes("resource://fluxion/chrome/fluxion-window-tabs.js"));
    assert.deepEqual(h.navigations, [], "startup must leave SessionStore's selected browser untouched");
    assert.equal(h.selectedBrowser.currentURI.spec, selectedURL);
    assert.equal(h.AboutNewTab.newTabURL, "file:///app/fluxion/newtab/index.html");
    assert.equal(h.preferences.get("fluxion.newtab.url"), h.AboutNewTab.newTabURL);
  });
}
