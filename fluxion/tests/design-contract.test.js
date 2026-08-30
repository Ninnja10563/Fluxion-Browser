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
const library = fs.readFileSync(path.join(root, "chrome/fluxion-library.js"), "utf8");
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
  const productCss = `${chrome}\n${palette}\n${settings}\n${library}`;
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
  assert.match(macVerifier, /FLUXION_VISUAL_AI_TEST=1/);
  assert.match(macVerifier, /FLUXION_VISUAL_AI_COMPARE_TEST=1/);
  assert.match(macVerifier, /FLUXION_VISUAL_LIBRARY_TEST=1/);
  assert.match(macVerifier, /FLUXION_VISUAL_BOOKMARK_FOLDER_TEST=1/);
  assert.match(macVerifier, /ollama-stub\.py/);
  assert.match(macVerifier, /current-page-answer-visible/);
  assert.match(macVerifier, /\[\[ -s "\$ai_request" \]\]/);
  assert.match(macVerifier, /"page_count": 2/);
  assert.match(palette, /fluxion-memory-test=1/);
  assert.match(macVerifier, /sleep 4/);
  assert.match(macVerifier, /screencapture -x/);
  assert.match(macVerifier, /https:\/\/example\.com\//);
});

test("Fluxion Library owns visible history, bookmark, and download workflows", () => {
  assert.match(library, /PlacesUtils\.promiseDBConnection/);
  assert.match(library, /moz_historyvisits/);
  assert.match(library, /moz_bookmarks/);
  assert.match(library, /Downloads\.getList/);
  assert.match(library, /Downloads\.PRIVATE/);
  assert.match(library, /download\.launch\(\)/);
  assert.match(library, /download\.showContainingDirectory\(\)/);
  assert.match(library, /downloadList\.remove\(download\)/);
  assert.match(library, /PlacesUtils\.history\.remove/);
  assert.match(library, /PlacesUtils\.bookmarks\.remove/);
  assert.match(library, /PlacesUtils\.bookmarks\.insert/);
  assert.match(library, /PlacesUtils\.bookmarks\.update/);
  assert.match(library, /PlacesUtils\.bookmarks\.DEFAULT_INDEX/);
  assert.match(library, /preventRemovalOfNonEmptyFolders: true/);
  assert.match(library, /PROTECTED_FOLDER_GUIDS/);
  assert.match(library, /Save current page/);
  assert.match(library, /Move Bookmark/);
  assert.match(chrome, /Library · \$\{labels\[librarySection\]/);
  assert.match(library, /data-fluxion-library-visible\] #identity-icon-box/);
  assert.match(library, /FluxionPalette\?\.close\(\)/);
  assert.match(palette, /FluxionLibrary\?\.open\("history"\)/);
  assert.match(palette, /FluxionLibrary\?\.open\("bookmarks"\)/);
  assert.match(palette, /FluxionLibrary\?\.open\("downloads"\)/);
  assert.doesNotMatch(library, /(?:linear|radial)-gradient|backdrop-filter/);
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
  const store = fs.readFileSync(path.join(root, "modules/FluxionMemoryStore.sys.mjs"), "utf8");
  assert.match(config, /registerWindowActor\("FluxionMemoryPage"/);
  assert.match(config, /rootFileURI\.replace\(\/\\\/\$\/, ""\)/);
  assert.match(macBuilder, /ditto "\$fluxion_root\/actors" "\$bundled_root\/actors"/);
  assert.match(macBuilder, /ditto "\$fluxion_root\/modules" "\$bundled_root\/modules"/);
  assert.match(config, /safeForUntrustedWebProcess: true/);
  assert.match(child, /input\[type="password"\]/);
  assert.match(child, /script, style, noscript, nav, footer, form/);
  assert.match(child, /node\.append\(document\.createTextNode\(" "\)\)/);
  assert.match(memory, /PrivateBrowsingUtils\.isWindowPrivate/);
  assert.match(memory, /FluxionMemoryPolicy\.canIndexPage/);
  assert.doesNotMatch(child, /Services\.|Sqlite|fetch\(/);
  assert.match(store, /setTimeout\(\(\) => \{[\s\S]*embedAndStore\(page\.url, page\.embeddingText\)\.catch/);
  assert.match(store, /withTimeout\(engine\.embed\(query\), 1500\)/);
  assert.match(store, /SELECT count\(\*\) AS count FROM page_vectors/);
});

test("Browser Memory answers expose source evidence and never invent empty results", () => {
  const grounding = fs.readFileSync(path.join(root, "chrome/core/memory-grounding.js"), "utf8");
  assert.match(memory, /answer: FluxionMemoryGrounding\.ground/);
  assert.match(palette, /Generated only from the local source records below/);
  assert.match(grounding, /Nothing relevant was found in Browser Memory/);
  assert.match(grounding, /sourceURL: best\.url/);
  assert.doesNotMatch(grounding, /fetch\(|AIProvider|OpenAI|Ollama/);
});

test("optional AI stays privileged, cancellable, and separate from ordinary browsing", () => {
  const ai = fs.readFileSync(path.join(root, "chrome/fluxion-ai.js"), "utf8");
  const providers = fs.readFileSync(path.join(root, "chrome/core/ai-providers.js"), "utf8");
  assert.match(ai, /Services\.logins\.searchLoginsAsync/);
  assert.match(ai, /FluxionMemoryPolicy\.canIndexPage/);
  assert.match(ai, /current\.remote/);
  assert.match(ai, /AbortController/);
  assert.match(ai, /comparePages/);
  assert.match(ai, /\.slice\(0, 4\)/);
  assert.match(ai, /extractPage\(browser, 5500\)/);
  assert.match(providers, /credentials: "omit"/);
  assert.doesNotMatch(ai, /setStringPref\([^\n]*secret|apiKey/i);
  assert.match(providers, /class DisabledProvider extends AIProvider/);
  assert.match(providers, /class OllamaProvider extends AIProvider/);
  assert.match(providers, /class OpenAICompatibleProvider extends AIProvider/);
  assert.match(providers, /class EmbeddingProvider/);
  assert.match(settings, /Firefox’s encrypted login store/);
  assert.match(palette, /Compare Selected Pages/);
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
