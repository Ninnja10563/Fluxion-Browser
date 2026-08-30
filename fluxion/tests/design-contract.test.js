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
const permissions = fs.readFileSync(path.join(root, "chrome/fluxion-permissions.js"), "utf8");
const sessionRecovery = fs.readFileSync(path.join(root, "chrome/fluxion-session-recovery.js"), "utf8");
const organisation = fs.readFileSync(path.join(root, "chrome/core/tab-organisation.js"), "utf8");
const flowNavigation = fs.readFileSync(path.join(root, "chrome/core/flow-navigation.js"), "utf8");
const tabStatus = fs.readFileSync(path.join(root, "chrome/core/tab-status.js"), "utf8");
const tabDrop = fs.readFileSync(path.join(root, "chrome/core/tab-drop.js"), "utf8");
const indexScheduler = fs.readFileSync(path.join(root, "chrome/core/index-scheduler.js"), "utf8");
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
const macSessionVerifier = fs.readFileSync(
  path.join(root, "scripts/verify-macos-session.sh"),
  "utf8",
);
const macPackager = fs.readFileSync(
  path.join(root, "scripts/package-macos-dmg.sh"),
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
  assert.match(settings, /FluxionPermissions\?\.clear/);
  assert.doesNotMatch(settings, /(?:linear|radial)-gradient|backdrop-filter/);
});

test("site permissions use Gecko records and expose exact reset scopes", () => {
  assert.match(permissions, /Services\.perms\.all/);
  assert.match(permissions, /Services\.perms\.removePermission/);
  assert.match(permissions, /Services\.perms\.removeAll/);
  assert.match(permissions, /perm-changed/);
  assert.match(settings, /FluxionPermissionPolicy\.group/);
  assert.match(settings, /removeSite\(group\.siteKey\)/);
  assert.match(settings, /remove\(permission\.id\)/);
  assert.match(palette, /about:preferences#permissions/);
});

test("packaged recovery gate crosses real normal and private app launches", () => {
  assert.match(sessionRecovery, /requestTabStateFlush/);
  assert.match(sessionRecovery, /Promise\.race/);
  assert.match(sessionRecovery, /SessionStore\.getWindowState/);
  assert.match(sessionRecovery, /new Set\(\[\.\.\.groupTabs, \.\.\.splitTabs, pinned\]\)/);
  assert.match(sessionRecovery, /PlacesUtils\.history\.fetch/);
  assert.match(sessionRecovery, /validatePrivateAbsence\(snapshot\(\)\)/);
  assert.match(sessionRecovery, /FluxionMemory\.search/);
  assert.match(sessionRecovery, /PrivateBrowsingUtils\.isWindowPrivate/);
  assert.match(macSessionVerifier, /FLUXION_SESSION_SEED_TEST/);
  assert.match(macSessionVerifier, /FLUXION_SESSION_RESTORE_TEST/);
  assert.match(macSessionVerifier, /FLUXION_PRIVATE_ISOLATION_TEST/);
  assert.match(macSessionVerifier, /FLUXION_PRIVATE_ABSENCE_TEST/);
  assert.match(macSessionVerifier, /workspace-tabs-groups-stacked-split-restored/);
  assert.match(macSessionVerifier, /private-tabs-history-memory-excluded/);
});

test("tab organisation stays local, evidence-backed, and confirmation-only", () => {
  assert.match(organisation, /minimum = 3/);
  assert.match(organisation, /!record\.pinned && !record\.grouped && !record\.split/);
  assert.doesNotMatch(organisation, /fetch\(|AIProvider|OpenAI|Ollama/);
  assert.match(palette, /Suggest tab group/);
  assert.match(palette, /Services\.prompt\.confirm/);
  assert.match(palette, /ui\.createSuggestedGroup/);
  assert.match(chrome, /gBrowser\.addTabGroup/);
  assert.match(macVerifier, /local-proposal-visible-and-confirmation-required/);
});

test("Flow uses roving focus and the packaged app proves 200-tab keyboard stability", () => {
  assert.match(flowNavigation, /ArrowUp/);
  assert.match(flowNavigation, /ArrowLeft/);
  assert.match(chrome, /item\.tabIndex = tab === gBrowser\.selectedTab \? 0 : -1/);
  assert.match(chrome, /aria-keyshortcuts/);
  assert.match(chrome, /focusTabAfterRender/);
  assert.match(chrome, /new Set\(visible\)/);
  assert.match(palette, /button\.tabIndex = -1/);
  assert.match(palette, /event\.key === "Tab"/);
  assert.match(macVerifier, /FLUXION_VISUAL_SCALE_TEST=1/);
  assert.match(macVerifier, /200-tabs-rendered-with-roving-keyboard-focus/);
});

test("Flow projects live Gecko tab status with accessible, working media controls", () => {
  assert.match(runtimeConfig, /chrome\/core\/tab-status\.js/);
  assert.match(tabStatus, /picture-in-picture/);
  assert.match(tabStatus, /sharing-camera-microphone/);
  assert.match(tabStatus, /Audio playback blocked/);
  assert.match(tabStatus, /Page crashed/);
  assert.doesNotMatch(tabStatus, /setAttribute|fetch\(|Services\./);
  assert.match(chrome, /tab\.pictureinpicture/);
  assert.match(chrome, /tab\.sharingState/);
  assert.match(chrome, /tab\.activeMediaBlocked/);
  assert.match(chrome, /tab\.resumeDelayedMedia\(\)/);
  assert.match(chrome, /tab\.toggleMuteAudio\(\)/);
  assert.match(chrome, /\[tabLabel\(tab\), \.\.\.status\.labels\]\.join/);
  assert.match(chrome, /prefers-reduced-motion/);
  assert.match(macVerifier, /FLUXION_VISUAL_STATUS_TEST=1/);
  assert.match(macVerifier, /native-gecko-tab-states-projected-and-controllable/);
});

test("Flow distinguishes reorder edges from native drag-to-split targets", () => {
  assert.match(runtimeConfig, /chrome\/core\/tab-drop\.js/);
  assert.match(tabDrop, /EDGE_FRACTION = 0\.24/);
  assert.match(tabDrop, /orientation = options\.stacked \? "stacked" : "side-by-side"/);
  assert.match(chrome, /data-drop-action="split"/);
  assert.match(chrome, /FluxionTabDrop\.announcement/);
  assert.match(chrome, /gBrowser\.moveTabsBefore/);
  assert.match(chrome, /gBrowser\.moveTabsAfter/);
  assert.match(chrome, /createSplitView\(primary, secondary/);
  assert.match(chrome, /stacked: event\.shiftKey/);
  assert.match(macVerifier, /FLUXION_VISUAL_DROP_TEST=1/);
  assert.match(macVerifier, /native-drag-reorder-and-two-orientation-split/);
  assert.doesNotMatch(tabDrop, /gBrowser|Services\.|setAttribute|fetch\(/);
});

test("new tab stays blank instead of duplicating the address field", () => {
  assert.doesNotMatch(newTab, /<form|<input|welcome|motivat/i);
  assert.match(newTab, /Blank new tab/);
});

test("compact Flow uses the researched 44px rail", () => {
  assert.match(chrome, /data-state="compact"[^}]*width:\s*44px/);
});

test("Focus Flow is an inert, keyboard-revealable overlay that preserves page geometry", () => {
  assert.match(chrome, /data-state="focus"[^}]*width:\s*3px/);
  assert.match(chrome, /\.fluxion-surface/);
  assert.match(chrome, /translateX\(calc\(-100% \+ 3px\)\)/);
  assert.match(chrome, /surface\.inert = !surfaceVisible/);
  assert.match(chrome, /\["Enter", " ", "ArrowRight"\]/);
  assert.match(chrome, /event\.key === "Escape"/);
  assert.match(chrome, /prefers-reduced-motion/);
  assert.match(chrome, /contentAfter\.left - contentBefore\.left/);
  assert.match(chrome, /contentAfter\.width - contentBefore\.width/);
  assert.match(macVerifier, /FLUXION_VISUAL_FOCUS_TEST=1/);
  assert.match(macVerifier, /focus-rail-overlay-revealed-without-content-reflow/);
});

test("the trailing toolbar uses a working Fluxion menu instead of Firefox PanelUI", () => {
  assert.match(chrome, /#PanelUI-button \{ display: none !important; \}/);
  assert.match(chrome, /id: "fluxion-toolbar-menu"/);
  assert.match(chrome, /fill='context-fill'/);
  assert.match(chrome, /image: toolbarMenuIcon/);
  for (const label of [
    "New Tab", "New Window", "New Private Window", "Command Palette…",
    "Search Tabs…", "Library", "Fluxion Settings…", "About Fluxion",
  ]) {
    assert.match(chrome, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(chrome, /toolbarNewTabItem\.dispatchEvent/);
  assert.match(chrome, /toolbarMenuPopup\.parentNode === toolbarMenuButton/);
  assert.match(macVerifier, /FLUXION_VISUAL_TOOLBAR_MENU_TEST=1/);
  assert.match(macVerifier, /product-menu-mounted-and-native-command-executed/);
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

test("macOS packaging retries transient hdiutil resource contention safely", () => {
  assert.match(macPackager, /while \(\( create_attempt <= 4 \)\)/);
  assert.match(macPackager, /\.attempt-\$\{create_attempt\}\.dmg/);
  assert.match(macPackager, /mv -f -- "\$attempt_dmg" "\$dmg"/);
  assert.match(macPackager, /Unable to create the Fluxion DMG after/);
  assert.doesNotMatch(macPackager, /hdiutil detach -force/);
});

test("macOS visual gate waits for settled chrome", () => {
  assert.match(macVerifier, /fluxion\.palette\.health/);
  assert.match(macVerifier, /fluxion\.groups\.health/);
  assert.match(macVerifier, /fluxion\.splitview\.health/);
  assert.match(macVerifier, /fluxion\.memory\.health/);
  assert.match(macVerifier, /fluxion\.memory\.engine\.health/);
  assert.match(macVerifier, /fluxion\.memory\.scheduler\.health/);
  assert.match(macVerifier, /fluxion\.settings\.visual\.health/);
  assert.match(macVerifier, /FLUXION_VISUAL_MEMORY_TEST=1/);
  assert.match(macVerifier, /FLUXION_VISUAL_SPLIT_TEST=1/);
  assert.match(macVerifier, /FLUXION_VISUAL_STATUS_TEST=1/);
  assert.match(macVerifier, /FLUXION_VISUAL_DROP_TEST=1/);
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
  assert.match(macVerifier, /FLUXION_VISUAL_PERMISSIONS_TEST=1/);
  assert.match(macVerifier, /real-permissions-enumerated-and-reset/);
  assert.match(macVerifier, /native-site-decisions-visible/);
  assert.match(macVerifier, /FLUXION_VISUAL_ABOUT_TEST=1/);
  assert.match(macVerifier, /flow-application-menu-loaded/);
  assert.match(macVerifier, /settings-about-route-ready/);
  assert.match(macVerifier, /versioned-about-fluxion-visible/);
  assert.match(macVerifier, /ollama-stub\.py/);
  assert.match(macVerifier, /current-page-answer-visible/);
  assert.match(palette, /FluxionAIVisualReady/);
  assert.match(palette, /on\(window, "FluxionAIVisualReady"/);
  assert.match(macVerifier, /\[\[ -s "\$ai_request" \]\]/);
  assert.match(macVerifier, /"page_count": 2/);
  assert.match(palette, /fluxion-memory-test=1/);
  assert.match(memory, /FluxionMemoryVisualReady/);
  assert.match(palette, /on\(window, "FluxionMemoryVisualReady"/);
  assert.match(palette, /FluxionGroundingVisualReady/);
  assert.match(palette, /runOrganisationVisualGate/);
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
  assert.match(library, /FluxionUI\.refresh\(\)/);
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
  assert.match(store, /async embed\(url, text\)/);
  assert.doesNotMatch(store, /setTimeout\(\(\) => \{[\s\S]*embedAndStore/);
  assert.match(store, /withTimeout\(engine\.embed\(query\), 1500\)/);
  assert.match(store, /SELECT count\(\*\) AS count FROM page_vectors/);
});

test("Browser Memory indexing yields to browsing and remains bounded", () => {
  assert.match(runtimeConfig, /chrome\/core\/index-scheduler\.js/);
  assert.match(memory, /new FluxionIndexScheduler\.IndexScheduler/);
  assert.match(memory, /quietMs: 4000/);
  assert.match(memory, /maxQueue: 64/);
  assert.match(memory, /nsIUserIdleService/);
  assert.match(memory, /navigator\.getBattery\(\)/);
  assert.match(memory, /memory-pressure/);
  assert.match(memory, /activePageIsDemanding/);
  assert.match(memory, /await FluxionMemoryStore\.embed/);
  assert.match(indexScheduler, /this\.queue = new Map\(\)/);
  assert.match(indexScheduler, /while \(this\.queue\.size > this\.maxQueue\)/);
  assert.match(indexScheduler, /resume\(reason = ""\)/);
  assert.match(indexScheduler, /await this\.run\(value, key\)/);
  assert.match(macVerifier, /bounded-serial-queue-paused-and-resumed/);
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
  assert.match(chrome, /\[TAB_WORKSPACE, TAB_SPLIT_ORIENTATION\]/);
  assert.match(chrome, /SessionStore\.persistTabAttribute\(attribute\)/);
  assert.match(chrome, /PREF_SPLIT_ORIENTATIONS/);
  assert.match(chrome, /splitView\.splitViewId/);
  assert.match(chrome, /privateWindow \|\| !splitView/);
  assert.match(chrome, /data-fluxion-split-orientation="stacked"/);
  assert.match(chrome, /tabpanels\.setAttribute\("orient", orientation === FluxionSplitViews\.STACKED/);
  assert.match(chrome, /aria-orientation/);
  assert.match(palette, /Open stacked split/);
  assert.match(palette, /Stack split vertically/);
  assert.match(macVerifier, /native-side-by-side-and-stacked-rendered/);
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
