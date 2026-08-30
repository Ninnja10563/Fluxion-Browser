"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const chrome = fs.readFileSync(path.join(root, "chrome/fluxion-chrome.js"), "utf8");
const palette = fs.readFileSync(path.join(root, "chrome/fluxion-palette.js"), "utf8");
const memory = fs.readFileSync(path.join(root, "chrome/fluxion-memory.js"), "utf8");
const settings = fs.readFileSync(path.join(root, "chrome/fluxion-settings.js"), "utf8");
const sleeping = fs.readFileSync(path.join(root, "chrome/fluxion-tab-sleeping.js"), "utf8");
const peek = fs.readFileSync(path.join(root, "chrome/fluxion-peek.js"), "utf8");
const shortcuts = fs.readFileSync(path.join(root, "chrome/fluxion-shortcuts.js"), "utf8");
const newTab = fs.readFileSync(path.join(root, "newtab/index.html"), "utf8");
const runtimeConfig = fs.readFileSync(
  path.join(root, "runtime/fluxion.cfg"),
  "utf8",
);
const macBuilder = fs.readFileSync(
  path.join(root, "scripts/prepare-macos-runtime.sh"),
  "utf8",
);
const macVerifier = fs.readFileSync(
  path.join(root, "scripts/verify-macos-app.sh"),
  "utf8",
);

test("browser chrome avoids prohibited decorative effects", () => {
  const productCss = `${chrome}\n${palette}\n${settings}`;
  assert.doesNotMatch(productCss, /(?:linear|radial)-gradient|backdrop-filter|filter:\s*blur/i);
});

test("Fluxion settings replace the visible Firefox preferences surface with live controls", () => {
  assert.match(settings, /about:preferences/);
  assert.match(settings, /data-fluxion-settings-visible/);
  assert.match(settings, /#identity-icon-box \{ display: none/);
  assert.match(settings, /browser\.startup\.page/);
  assert.match(settings, /SearchService\.sys\.mjs/);
  assert.match(settings, /CHANGE_REASON\.USER/);
  assert.match(settings, /FluxionMemory\?\.setExcludedDomains/);
  assert.match(settings, /PlacesUtils\.history\.clear/);
  assert.match(settings, /Services\.cookies\.removeAll/);
  assert.match(settings, /Services\.perms\.removeAll/);
  assert.doesNotMatch(settings, /(?:linear|radial)-gradient|backdrop-filter/);
});

test("new tab stays blank instead of duplicating the address field", () => {
  assert.doesNotMatch(newTab, /<form|<input|welcome|motivat/i);
  assert.match(newTab, /Blank new tab/);
});

test("compact Flow uses the researched 44px rail", () => {
  assert.match(chrome, /data-state="compact"[^}]*width:\s*44px/);
});

test("hidden horizontal tabs preserve Gecko's native titlebar controls", () => {
  assert.match(
    chrome,
    /#nav-bar > \.titlebar-buttonbox-container \{ display: flex !important; \}/,
  );
  assert.doesNotMatch(chrome, /setAttribute\("tabs-hidden"/);
  assert.doesNotMatch(chrome, /titlebar-(?:close|min|max)[^\n]*addEventListener/);
});

test("macOS package cannot inherit Firefox's asset-catalogue icon", () => {
  assert.match(macBuilder, /rm -f -- "\$resources\/Assets\.car"/);
  assert.match(macBuilder, /plutil -remove CFBundleIconName/);
  assert.match(macBuilder, /CFBundleIconFile -string fluxion\.icns/);
});

test("macOS visual gate waits for settled chrome", () => {
  assert.match(macVerifier, /fluxion\.palette\.health/);
  assert.match(macVerifier, /fluxion\.groups\.health/);
  assert.match(macVerifier, /fluxion\.splitview\.health/);
  assert.match(macVerifier, /fluxion\.memory\.health/);
  assert.match(macVerifier, /fluxion\.memory\.engine\.health/);
  assert.match(macVerifier, /fluxion\.settings\.visual\.health/);
  assert.match(macVerifier, /FLUXION_VISUAL_MEMORY_TEST=1/);
  assert.match(macVerifier, /FLUXION_VISUAL_SPLIT_TEST=1/);
  assert.match(macVerifier, /FLUXION_VISUAL_SETTINGS_TEST=1/);
  assert.match(macVerifier, /FLUXION_VISUAL_SLEEP_TEST=1/);
  assert.match(macVerifier, /native-tab-discarded/);
  assert.match(macVerifier, /FLUXION_VISUAL_PEEK_TEST=1/);
  assert.match(macVerifier, /temporary-gecko-tab-opened/);
  assert.match(macVerifier, /FLUXION_VISUAL_MULTISELECT_TEST=1/);
  assert.match(macVerifier, /native-multiselect-visible/);
  assert.match(macVerifier, /FLUXION_VISUAL_SHORTCUT_TEST=1/);
  assert.match(macVerifier, /custom-shortcut-persisted/);
  assert.match(macVerifier, /sleep 4/);
  assert.match(macVerifier, /screencapture -x/);
  assert.match(macVerifier, /https:\/\/example\.com\//);
});

test("custom shortcuts are persisted centrally and consumed by live commands", () => {
  assert.match(shortcuts, /fluxion\.shortcuts/);
  assert.match(shortcuts, /FluxionShortcutsChanged/);
  assert.match(chrome, /FluxionShortcuts\?\.matches\(event, "sidebar"\)/);
  assert.match(palette, /FluxionShortcuts\?\.matches\(event, "palette"\)/);
  assert.match(settings, /Press shortcut…/);
});

test("Flow delegates multi-selection to Gecko and exposes batch actions", () => {
  assert.match(chrome, /addRangeToMultiSelectedTabs/);
  assert.match(chrome, /addToMultiSelectedTabs/);
  assert.match(chrome, /removeFromMultiSelectedTabs/);
  assert.match(chrome, /gBrowser\.selectedTabs/);
  assert.match(chrome, /moveTabsToWorkspace/);
  assert.match(chrome, /gBrowser\.removeTabs/);
});

test("Peek Pages preserve Gecko link security and remain temporary native tabs", () => {
  assert.match(peek, /_openLinkInParameters/);
  assert.match(peek, /window\.openLinkIn/);
  assert.match(peek, /skipSessionStore: true/);
  assert.match(peek, /persistTabAttribute/);
  assert.match(peek, /createSplitView/);
  assert.doesNotMatch(peek, /createElement(?:NS)?\([^\n]*(?:iframe|browser)/);
});

test("tab sleeping uses Gecko discard and protects live browsing state", () => {
  assert.match(sleeping, /prepareDiscardBrowser/);
  assert.match(sleeping, /discardBrowser\(tab, false\)/);
  assert.match(sleeping, /PrivateBrowsingUtils\.isWindowPrivate/);
  assert.doesNotMatch(sleeping, /discardBrowser\(tab, true\)/);
  assert.match(settings, /Sleep inactive tabs/);
});

test("Browser Memory is optional, local, and unavailable in private windows", () => {
  assert.match(memory, /PlacesSemanticHistoryManager\.sys\.mjs/);
  assert.match(memory, /PrivateBrowsingUtils\.isWindowPrivate/);
  assert.match(memory, /fluxion\.memory\.enabled/);
  assert.match(memory, /places\.semanticHistory\.removeOnStartup/);
  assert.match(palette, /Private windows are never indexed/);
  assert.match(palette, /Page addresses and history are not sent to an AI provider/);
});

test("Browser Memory exposes functional privacy controls", () => {
  assert.match(palette, /Exclude this site from Browser Memory/);
  assert.match(palette, /Clear Browser Memory/);
  assert.match(memory, /DELETE FROM vec_history/);
  assert.match(memory, /excludedDomains/);
});

test("enriched Browser Memory crosses the content boundary through a narrow Gecko actor", () => {
  const config = runtimeConfig;
  const child = fs.readFileSync(path.join(root, "actors/FluxionMemoryPageChild.sys.mjs"), "utf8");
  assert.match(config, /registerWindowActor\("FluxionMemoryPage"/);
  assert.match(config, /safeForUntrustedWebProcess: true/);
  assert.match(child, /input\[type="password"\]/);
  assert.match(child, /script, style, noscript, nav, footer, form/);
  assert.match(memory, /PrivateBrowsingUtils\.isWindowPrivate/);
  assert.match(memory, /FluxionMemoryPolicy\.canIndexPage/);
  assert.doesNotMatch(child, /Services\.|Sqlite|fetch\(/);
});

test("split view delegates content panes to Gecko and remains controllable from Flow", () => {
  assert.match(chrome, /gBrowser\.addTabSplitView/);
  assert.match(chrome, /splitView\.unsplitTabs/);
  assert.match(chrome, /splitView\.reverseTabs/);
  assert.match(chrome, /fluxion-split-mark/);
  assert.doesNotMatch(chrome, /createElement\(["'](?:iframe|browser)["']/);
});

test("new profiles never show Firefox onboarding or upload Mozilla telemetry", () => {
  assert.match(
    runtimeConfig,
    /setBoolPref\("browser\.preonboarding\.enabled", false\)/,
  );
  assert.match(
    runtimeConfig,
    /setBoolPref\("browser\.aboutwelcome\.enabled", false\)/,
  );
  assert.match(
    runtimeConfig,
    /setBoolPref\("datareporting\.policy\.dataSubmissionEnabled", false\)/,
  );
  assert.doesNotMatch(runtimeConfig, /termsofuse\.accepted(?:Date|Version)/);
});
