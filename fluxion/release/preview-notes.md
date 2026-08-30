This is a downloadable Fluxion Gecko Foundation Preview for macOS.

It includes real Gecko webpage rendering, the Fluxion **Flow** vertical tab
sidebar, workspaces, navigation, Firefox's mature browser services, a separate
Fluxion profile, and a native universal launcher with Apple Silicon support.

This is an early development preview, not a stable release. Fluxion retains
Gecko's browser services and security boundaries while its independent product
interface is built out incrementally.

Version 0.38 makes multiple Fluxion windows restore as independent working
contexts instead of sharing one profile-wide active workspace:

- persist the active workspace in Gecko SessionStore's native per-window
  `extData`, beside the window's actual tabs and selected page;
- retain the previous profile preference only as a migration/default for new
  normal windows, while a restored window always prefers its own valid value;
- prevent private-window workspace switching from rewriting that normal-window
  fallback;
- repair stale values safely through the current workspace list without
  creating a Fluxion window/session database;
- seed a primary window in Build and a companion window in Life, with a
  separate remembered Build page inside the companion;
- cleanly quit and restore both windows, switch the primary through Focus and
  Build, and fail unless the companion remains on its selected Life page;
- repeat the two-window assertion after a real private-window launch, while
  continuing to reject the private URL from SessionStore, Places, and Browser
  Memory;
- extend the packaged gate to reject a missing window, merged window state,
  profile-fallback collapse, or incorrect per-window active-page ownership.

No URL or navigation state is copied into Fluxion preferences. Gecko remains
the single owner of window restoration and crash recovery.

Version 0.37 makes embeddings independently optional instead of forcing users
to choose between semantic models and Browser Memory itself:

- add a live **Embedding mode** control to Search & Memory with **Gecko
  on-device semantic** and **Keywords only** choices;
- keep titles, URLs, headings, bounded page evidence, recency, frequency, and
  workspace relevance searchable when embeddings are disabled;
- stop Gecko ML and semantic-history feature gates in Keywords only mode and
  bypass both native and enriched-page vector inference during indexing and
  recall;
- delete existing vectors from Gecko's semantic Places store and Fluxion's
  enriched-page SQLite store without deleting ordinary history or lexical page
  evidence;
- keep the generative AI provider completely separate from embedding choice;
  neither mode sends browsing data to Ollama, an OpenAI-compatible endpoint, or
  any other model provider;
- expose both mode transitions in the universal command palette with explicit
  confirmation before vector deletion or local-model activation;
- update Browser Memory status text so intentional Keywords only mode is not
  misreported as a model failure;
- synchronize embedding choice across open windows and apply the correct Gecko
  feature gates from the first startup frame;
- preserve Keywords only through normal restoration, a private-window launch,
  and the following normal restart without admitting private history or
  momentarily enabling ML;
- close the enriched Browser Memory SQLite connection through Gecko's profile
  shutdown barrier, including a quit that races initialization, rather than
  leaving profile writes to process teardown;
- drive the real Settings selector in the packaged macOS app, prove lexical
  recall still finds extracted page evidence with ML disabled, restore local
  semantic mode, and reject packaging unless every state is exact.

The release capture settles on Search & Memory with the embedding selector
visible after the 200-tab keyboard and workspace gates complete.

Version 0.36 completes workspace management as a first-class preferences
workflow:

- add a restrained **Workspaces** section to Fluxion Settings with inline
  creation, renaming, symbol and accent choices, one-step reordering, and
  confirmed deletion;
- keep management rows flat and information-dense instead of turning each
  workspace into a decorative card or colourful dashboard;
- route Flow context actions and Settings controls through the same privileged
  workspace controller, so the two surfaces cannot drift into separate state;
- publish workspace changes live to Settings and observe the persisted list in
  every open Fluxion window;
- count and migrate tabs across all open normal and private windows before a
  workspace is removed, preserving each native tab instead of closing it or
  leaving it assigned to a deleted identifier;
- expose **Workspace settings** in the universal command palette;
- drive the real Settings form and inline controls in the packaged macOS app,
  persist a renamed/reordered square-and-sage workspace, attach a native tab,
  delete the workspace, and refuse packaging unless that tab moves safely;
- extend the four-launch recovery test to require workspace names, order,
  symbols, and accents to survive a real Gecko quit and restart alongside tabs,
  groups, pins, split views, and per-workspace active pages;
- reconcile the latest workspace chosen during startup after Gecko reports all
  SessionStore windows restored, so a delayed native tab selection cannot undo
  an early user action.

The release capture settles on the actual Workspaces preferences surface so
its density, alignment, and grayscale hierarchy can be inspected before
publication.

Version 0.35 makes workspace switching resume where the user actually left off:

- remember one active native tab per workspace instead of selecting the first
  tab whenever the user returns;
- persist that ownership as a bounded custom SessionStore tab value beside the
  existing workspace membership, keeping page history, scroll position, forms,
  groups, pins, and crash recovery under Gecko rather than a shadow database;
- repair duplicate or stale active markers on selection and clear ownership
  when tabs move between workspaces or a workspace is deleted;
- use Gecko's own `lastAccessed` recency as the deterministic fallback for a
  workspace that has no remembered page yet;
- verify two independent workspace resume points through the packaged browser's
  real switching path before creating a DMG;
- expand the four-launch recovery gate to seed active pages in Focus and Build,
  quit, restore, switch to each workspace, and require the correct live page to
  return before testing the private-window boundary;
- restore the sidebar state after Focus-mode verification so release captures
  represent settled everyday browsing rather than a deliberately revealed test
  overlay.

No URL, navigation entry, or page state is copied into Fluxion preferences.

Version 0.34 makes appearance a live browser capability rather than a static
skin:

- add working **Follow system**, **Light**, and **Dark** choices to Fluxion's
  compact Appearance settings;
- install and enable Gecko's own built-in themes through `BuiltInThemes` and
  `AddonManager`, so native menus, dialogs, toolbar controls, and Fluxion chrome
  update through one supported lifecycle;
- observe active-theme changes across open windows and preserve a distinct
  **Extension theme** state when a Firefox-compatible theme owns appearance;
- expose Appearance, Tabs, Search & Memory, AI, and Keyboard destinations as
  fuzzy-searchable Settings results in the universal command palette;
- add direct palette actions for switching to System, Light, or Dark appearance
  without turning theme state into permanent toolbar clutter;
- require the packaged macOS app to enable Dark, update the live Settings
  selection and computed chrome color scheme, then open Gecko's native privacy
  dialog in that appearance before a DMG can publish;
- inspect the dialog's real time-range selector, data categories, and native
  actions, then cancel it without deleting fixture data so the release
  screenshot can evaluate the settled Dark browser rather than a dimmed modal;
- anchor Fluxion Settings and Library after Flow's real Expanded, Compact, or
  Focus layout width, keeping their navigation rails and first text column from
  being hidden beneath the tab sidebar;
- reject the packaged app unless both custom surfaces have non-overlapping Flow,
  navigation, and content rectangles.

The visual system remains grayscale-first: no gradients, wallpaper, colourway,
or decorative theme layer was added.

Version 0.33 replaces partial browsing-data deletion with Gecko's coordinated
native privacy workflow:

- add **Clear browsing data…** directly to the universal command palette while
  retaining a separate route to Fluxion's full Privacy settings;
- replace hand-written Places, cookie, and cache deletion buttons with Gecko's
  native selectable clearing dialog and its supported site-data mode;
- let Gecko own time ranges and coordinated history, download, form, cookie,
  cache, DOM-storage, authentication, media-device, tracking-protection, and
  site-setting cleanup through its `Sanitizer` and `nsIClearDataService` path;
- keep the sanitizer entirely inside privileged browser chrome so webpage
  JavaScript receives no local-data capability;
- prevent repeated clicks or palette invocations from stacking destructive
  dialogs, while preserving explicit accept/cancel outcomes for Settings;
- require the packaged browser to load the real Gecko sanitizer service and
  open its in-window dialog before a universal macOS DMG can publish.

Fluxion no longer maintains a second, incomplete definition of browsing data.

Version 0.32 makes Gecko the single owner of web-search routing:

- remove the command palette's hard-coded DuckDuckGo destination and obtain
  every search submission from Gecko's current SearchService engine;
- respect the separate private-window default where the user has enabled one;
- support both GET and POST engines by forwarding Gecko's native submission
  URL and post data instead of guessing a query-string format;
- reject a configured engine submission unless its final URI uses HTTP or
  HTTPS, preserving the privileged-chrome navigation boundary;
- update the visible palette engine name immediately when Settings or an
  extension changes the default engine;
- distinguish explicit addresses and safe browser schemes from search text
  before asking the engine, while continuing to treat script-bearing schemes
  as inert search terms;
- open results as real Gecko tabs in the active Fluxion workspace and retain
  Gecko's triggering-engine history metadata;
- require the packaged browser to switch to another installed engine, show it
  as the selected palette destination, open a result by keyboard, verify its
  workspace, restore the original engine, and show that engine again before a
  DMG can publish.

Fluxion keeps no separate search-engine preference or template.

Version 0.31 makes closed-tab recovery a first-class Fluxion workflow:

- add a live **Recently Closed Tabs** submenu to both the native Flow menu and
  the cross-platform toolbar menu;
- search up to ten recent closed pages by title or address in the universal
  command palette, while keeping the full menu projection bounded at twelve;
- suppress weak subsequence noise when an exact or prefix match exists, while
  retaining fuzzy recovery for queries that contain only a typo;
- show **Reopen Last Closed Tab** only when Gecko has recoverable state, rather
  than leaving a visible command that throws or does nothing;
- restore by SessionStore index, preserving Gecko navigation history, form and
  scroll state, tab-group metadata, and Fluxion workspace identity;
- scope recovery to the current Gecko window, retaining private-window
  separation and never copying session state into a Fluxion database;
- redact embedded HTTP credentials from displayed addresses without altering
  the underlying SessionStore record;
- require the packaged browser to close a real tab, project it in the native
  menu, select it as the first palette result, restore it by keyboard, and
  prove its workspace identity before a DMG can publish.

This fills a practical recovery gap left by removing Firefox's visible
PanelUI, without recreating session storage.

Version 0.30 completes the command palette's native page-control layer:

- expose Find in Page, Bookmark This Page, Save Page As, Print, page zoom,
  Full Screen, Extensions & Themes, and Developer Tools beside Fluxion's tab,
  workspace, history, bookmark, settings, and privacy commands;
- resolve native command availability from the live Gecko window, so a command
  unavailable for the current page is omitted instead of becoming a dead row;
- keep generated web/address destinations below every matching real command,
  tab, workspace, history, or bookmark so Return performs the expected action;
- route every action through one privileged Fluxion-to-Gecko bridge while page
  JavaScript remains unable to call browser chrome;
- replace the palette's obsolete Developer Tools command ID with the same lazy
  `gDevToolsBrowser` controller used by Firefox and Fluxion's toolbar menu;
- keep native dialogs, enabled state, WebExtension compatibility, and page
  behavior owned by Gecko rather than recreating them in palette code;
- require the packaged browser to list the live commands and execute Zoom In
  then Actual Size through keyboard selection before a DMG can publish.

The palette remains a compact command surface, not a second toolbar or a
decorative dashboard.

Version 0.29 completes the Fluxion toolbar menu as a cross-platform command
surface:

- add a concise Page submenu for Find in Page, Save Page, Print, Zoom Out,
  Actual Size, Zoom In, and Full Screen;
- add a Tools submenu for Firefox-compatible extensions, the real page
  Developer Tools, and Fluxion's Privacy & Site Data controls;
- bind Page items directly to Gecko's existing XUL command nodes so disabled
  state, keyboard behavior, PDF handling, print dialogs, save dialogs, zoom,
  and fullscreen remain browser-native;
- delegate Developer Tools to Gecko's dynamically registered toolbox command
  instead of exposing a second debugging implementation;
- retain platform-correct shortcut labels and the restrained native menu
  hierarchy without turning the toolbar into a wall of icons;
- require the packaged browser to resolve every native command and execute a
  real Zoom In → Actual Size round trip before a DMG can publish.

This closes the page-command access gap created when Fluxion removed Firefox's
visible PanelUI, especially on Windows and Linux where a persistent macOS-style
application menu bar is not available.

Version 0.28 gives the visible toolbar a distinct Fluxion application menu:

- replace Firefox's inherited hamburger button with one quiet geometric
  Fluxion mark at the trailing edge of the real Gecko navigation toolbar;
- keep the native Back, Forward, Reload, URL/security field, downloads, and
  extension actions that directly support the page instead of rebuilding them;
- expose concise working commands for new tabs, windows, private windows,
  command palette, tab search, Fluxion Library, settings, and About;
- use native XUL menu semantics, platform-correct shortcut labels, keyboard
  navigation, focus handling, and macOS appearance rather than a web-styled
  card or custom imitation;
- mirror these actions in the existing macOS menu bar, so the toolbar is not
  their only entry point;
- require the packaged application to hide the inherited control, execute a
  real new-tab command through the connected native menu, and preserve visible
  Back and URL controls before publication.

The change does not replace Gecko's security-aware address field or page-action
implementations.

Version 0.27 turns Focus into a complete distraction-free Flow mode:

- collapse browser chrome to a quiet 3px reveal rail while the live webpage
  uses the reclaimed width;
- reveal the full 232px Flow over the page on hover, rail click, keyboard focus,
  Enter, Space, or Right Arrow, without resizing or shifting page content;
- dismiss with Escape or when both pointer and focus leave the surface, using a
  short delay that prevents accidental closure while crossing the edge;
- remove hidden workspace, tab, and footer controls from keyboard and assistive
  interaction with the native `inert` boundary, then restore them on reveal;
- expose literal collapsed/expanded state and a focusable reveal rail to
  assistive technology;
- use only a short transform and restrained edge shadow, with immediate motion
  removal when the system or Fluxion reduced-motion preference requests it;
- require the packaged macOS app to prove hidden and revealed geometry,
  accessibility state, and an unchanged live Gecko content rectangle before a
  DMG can publish.

The overlay is browser chrome, not webpage content, and it does not introduce a
second tab or rendering surface.

Version 0.26 makes Flow tab dragging spatial and split-aware:

- retain narrow top and bottom edge zones for precise before/after reordering;
- turn the broad centre of an eligible target into a native side-by-side split
  action, ordered by the pointer's left or right position;
- hold Shift during the same centre drop to stack the dragged page above or
  below the target;
- show a flat literal preview such as **Split left** or **Stack below**, plus a
  screen-reader announcement of the resulting geometry;
- use Gecko's batch tab-move and `addTabSplitView` operations, preserving native
  selected tabs, content processes, session state, security, and teardown;
- fall back to ordinary reorder feedback for multi-selections, pinned tabs,
  existing split members, cross-workspace targets, and other ineligible pairs;
- gate the packaged app through actual side-by-side and stacked native drops,
  separation, and an edge reorder before a DMG can publish.

No content view is recreated or reloaded during a successful split drop.

Version 0.25 completes Flow's live native tab-status language:

- project Gecko loading, attention, picture-in-picture, camera, microphone,
  screen-sharing, crash, sleep, blocked-media, playing, and muted states;
- replace temporary audio characters with one consistent geometric vector
  system that remains legible in grayscale and compact or pinned Flow;
- include every active state in the tab row's accessible name and native
  tooltip without adding hundreds of nested keyboard stops;
- keep loading as the only animated mark and make it static when reduced motion
  is requested;
- resume blocked audio and mute or unmute through Gecko's existing tab media
  methods, including a concise selection-aware context action;
- resolve stale state safely, so a crashed tab never presents obsolete capture
  or media controls;
- gate the packaged app with real Gecko tab elements, visible status marks, an
  audio-control click, and the resulting native muted-state rerender.

Fluxion does not persist or infer page activity. Gecko remains the single owner
of media, capture, loading, crash, and picture-in-picture state.

Version 0.24 completes two-orientation native split browsing:

- arrange any eligible pair side by side or in a stacked top/bottom layout;
- switch orientation without reloading either page or replacing Gecko's live
  content panels;
- create both layouts from concise tab-context actions and command-palette
  commands, including a new blank page in either direction;
- keep the native draggable XUL splitter, focus routing, page dialogs, security
  state, DevTools ownership, and split teardown;
- expose left/right and top/bottom pane positions to Flow and keep the divider's
  separator orientation and size values aligned for assistive technology;
- persist only the validated orientation against Gecko's SessionStore-restored
  native split ID, with no URL or page-state shadow record;
- require a real stacked split to survive Fluxion's clean quit and multi-launch
  macOS recovery gate;
- drive the packaged app through both geometries before a DMG can publish.

No iframe, webview, second navigation model, or custom content container is
introduced.

Version 0.23 makes local Browser Memory indexing subordinate to browsing:

- replace detached concurrent embedding timers with one bounded serial queue;
- deduplicate repeat page loads and cap pending work at 64 pages;
- wait for a four-second quiet period and Gecko's system-idle signal before
  extracting content or starting a local embedding;
- pause indexing on low unplugged battery, active audio, picture-in-picture,
  camera/screen sharing, and Gecko memory-pressure notifications;
- preserve queued pages across policy pauses, wake when conditions recover, and
  clear pending work when Browser Memory is disabled or deleted;
- dispatch the queue through low-priority window idle callbacks where Gecko
  exposes them, while retaining a safe timer fallback;
- gate the packaged app by pausing a real page, proving no early database write,
  then requiring that exact evidence after the scheduler resumes.

Ordinary navigation never waits for Browser Memory, and the feature remains
local, optional, and unavailable in private windows.

Version 0.22 hardens keyboard navigation and many-tab responsiveness:

- replace hundreds of tab-row stops with one roving focus target per tablist;
- navigate visible tabs with Up/Down, Home, and End while keeping Gecko's native
  selected tab and Flow's focused row aligned across rerenders;
- navigate the workspace strip with Left/Right, Home, and End using correct
  horizontal tablist semantics;
- retain focus on the nearest surviving visible tab after keyboard close,
  skipping every member of a closing multi-selection;
- expose sleeping, playing, and muted state through accessible tab names while
  keeping pointer-only nested controls out of the browser-wide Tab sequence;
- keep command-palette focus in its search field and announce live status while
  Arrow keys update the active descendant;
- replace a repeated linear membership check in split-row rendering with a set;
- gate the packaged application with 200 temporary Gecko tabs, a bounded Flow
  render, exactly one tab stop, and a real ArrowDown focus/selection round trip.

The scale fixture is removed before release capture and ordinary profiles never
run it.

Version 0.21 adds deliberate, local tab-organisation suggestions:

- inspect only titles and hostnames from eligible unpinned, ungrouped tabs in
  the active workspace;
- require at least three supporting pages before offering a proposal;
- recognise a shared site or a cross-site topic such as React research while
  filtering generic words and privileged locations;
- show the exact tab count and proposed native group name in the command
  palette;
- list every proposed page in a native confirmation and make cancellation a
  complete no-op;
- apply an accepted proposal through Gecko's real `gBrowser.addTabGroup`, so
  drag, collapse, ordering, and SessionStore restoration remain native;
- keep the feature independent of AI providers and never reorganise tabs in
  the background.

The packaged macOS gate now creates a cross-site React fixture and refuses the
DMG unless **Suggest tab group** is visible with the local proposal and its
confirmation-only execution path.

Version 0.20 hardens real session restoration and private-window isolation:

- seed a normal packaged-app session containing five real Gecko tabs in the
  Build workspace, including a pinned tab, a named native group, and a native
  split pair;
- flush content state through Gecko's frame loaders and use a clean application
  quit instead of fabricating a session-state file;
- restart the same `Fluxion.app` and require every URL, workspace attribute,
  pin, group label, and split identity to be restored by SessionStore;
- open a real private window against the same profile and require Browser
  Memory to return no results and refuse enablement;
- restart normal mode once more and prove that the private URL entered neither
  restored tabs, Gecko Places history, nor Browser Memory;
- derive the command-line `--version` response from the package version so the
  launcher cannot retain stale preview identity.

The macOS release workflow now runs this four-launch recovery sequence in a
fresh isolated profile after the ordinary packaged-app interaction gate. A DMG
cannot publish when normal browsing state is lost or private state leaks.

Version 0.19 gives Fluxion ownership of its native macOS application model:

- add a top-level **Flow** menu beside the familiar native browser menus;
- open the command palette and fast tab search with the user's current editable
  shortcut labels shown in the menu;
- select Expanded, Compact, or Focus sidebar modes and switch among the live,
  profile-persisted workspace list from native menu items;
- route History, Bookmarks, and Downloads into Fluxion Library and create a new
  workspace without reaching a Firefox-branded management surface;
- keep Gecko's standard File, Edit, View, History, Bookmarks, Tools, Window, and
  Help command implementations intact for platform behaviour and accessibility;
- replace the stale About route with the restrained
  `about:preferences?fluxion=about` Fluxion surface, hide bundle file paths, and enforce
  that its displayed version matches the shipped application.

The macOS release gate now requires the native Flow menu health marker, checks
the packaged About version against `CFBundleShortVersionString`, opens the real
About Fluxion page, and captures that final independent product surface before
the DMG can be published.

Version 0.18 adds a dedicated site Permissions Center to Fluxion Settings:

- search every saved HTTP(S) site decision by origin, permission type, state,
  or browsing context without exposing page paths, queries, or credentials;
- inspect camera, microphone, location, notification, storage, autoplay, and
  future Gecko permission types with restrained allow/block/ask states;
- distinguish permanent, session, timed, policy-managed, and tab-specific
  expiry while identifying private and container-scoped records;
- reset one exact native permission, every decision for one site, or all saved
  decisions, with confirmation around broad destructive actions;
- observe Gecko's live `perm-changed` stream so decisions made by page prompts
  or other windows appear without restarting or maintaining shadow state.

The macOS release gate now creates native camera, microphone, and location
records in the packaged browser, removes only the location record through
Fluxion, and refuses publication unless the remaining live Gecko decisions are
visible in the custom Permissions surface.

Version 0.17 completes native bookmark-folder management in Fluxion Library:

- browse the actual Places folder hierarchy, including nested user folders and
  clearly named toolbar, menu, mobile, and other-bookmark roots;
- save the last ordinary webpage directly into the selected folder without
  bookmarking the internal Library page;
- filter bookmarks by folder, rename saved pages, and move them atomically with
  Gecko's required destination index;
- create top-level folders or subfolders and rename user-created folders;
- protect Places roots and tag pseudo-folders from invalid mutations;
- refuse non-empty folder deletion at the database API boundary, even if the
  visible child count became stale before confirmation;
- keep Gecko's advanced organizer available for bulk import/export workflows.

The macOS release gate now creates a real Places folder, moves and renames a
real bookmark into it, filters Fluxion Library to that folder, and requires the
resulting filed bookmark to be visible before the DMG can be published.

Version 0.16 introduces Fluxion Library as the primary history, bookmark, and
download surface:

- search recent history, saved bookmarks, folder context, download names, and
  source URLs in one restrained native-feeling interface;
- open or remove individual history and bookmark records from the real Gecko
  Places database with confirmation before destructive data changes;
- observe Gecko's live public download list—or only the private list in a
  private window—without polling or shadow download state;
- open completed files, reveal them in Finder, cancel active transfers, retry
  interrupted transfers, and remove list entries through native Download APIs;
- retain Gecko's full bookmark-folder organizer behind a concise management
  route while Fluxion's folder editor remains in development;
- route command-palette history, bookmark, and download actions directly into
  the independent Fluxion surface instead of Firefox-styled management pages.

The macOS release gate now writes a real visit and bookmark into the isolated
Places profile, adds a native Download object, and refuses the DMG unless all
three are visible in the packaged Fluxion Library after every earlier browser
gate passes.

Version 0.15 adds explicit, grounded comparison across selected tabs:

- Command-click or Shift-click two to four real Gecko tabs in Flow, then run
  **Compare Selected Pages** from the command palette;
- ask a focused comparison question and receive one answer with a separate
  visible title, URL, and bounded excerpt for every source page;
- cap every extracted page at 5.5 KB and refuse the whole request when any
  selected page is private, sensitive, password-bearing, or user-excluded;
- preserve cancellation, loopback/HTTPS restrictions, redirect refusal,
  credential isolation, and remote page-sharing consent from v0.14;
- never select, regroup, or move tabs on a model's behalf.

The macOS release gate now requires both a grounded current-page request and a
second two-page comparison request from the packaged universal app. The final
comparison and both cited source records must be visible before publishing.

Version 0.14 introduces the first optional generative-AI boundary:

- configure Disabled, local Ollama, or generic OpenAI-compatible providers in
  live Fluxion Settings without restarting;
- ask a question about the current page from the command palette and receive a
  concise answer beside the exact title, URL, and extracted source excerpt;
- keep AI disabled by default and keep ordinary browsing and deterministic
  Browser Memory fully functional without a model or provider;
- store compatible API keys in Firefox's encrypted Login Manager rather than
  preferences or source code;
- permit HTTP only on loopback, require HTTPS and explicit page-sharing consent
  remotely, omit browser credentials and cache, and cancel requests with Escape;
- reject private windows, password forms, sensitive routes, and user-excluded
  domains before any page text reaches a provider.

The macOS release gate now runs a loopback Ollama-compatible fixture and refuses
the DMG unless the packaged app sends a correctly bounded page-context request,
receives the grounded response, and visibly renders its source evidence.

Version 0.13 makes Browser Memory recall inspectable and grounded:

- present a concise best match derived only from the top stored history record;
- show a bounded source excerpt, match reason, domain, visit timing, workspace,
  and tab-group context alongside each result;
- rank exact heading, description, and page-body evidence ahead of weaker
  semantic neighbors;
- return an explicit insufficient-evidence response instead of inventing a
  browsing memory;
- keep the entire answer path deterministic and functional without generative
  AI or a network provider.

The macOS release gate now extracts a real HTTPS page, reads its evidence back
from the packaged local database, renders the grounded recall surface, and
requires that evidence to be visible before the DMG is created.

Version 0.12 enriches local Browser Memory with page evidence:

- extract bounded titles, descriptions, headings, and useful article/main text
  through a process-isolated Gecko window actor;
- generate embeddings on-device with Gecko's packaged model and store them in
  Fluxion's own local SQLite `vec0` database;
- combine content keyword matches and semantic similarity with the existing
  exact Places, recency, frequency, and workspace ranking signals;
- reject private windows, password forms, sensitive routes, non-web pages, and
  user-excluded domains before content reaches storage;
- delete enriched records and vectors when Browser Memory is cleared or a
  domain is excluded, without deleting ordinary browsing history.

Ordinary browsing remains fully functional with Browser Memory disabled.

Version 0.11 makes Fluxion's keyboard model user-editable:

- change the command palette, tab search, Flow sidebar, next-workspace, and
  previous-workspace shortcuts directly in Fluxion Settings;
- capture physical key combinations with correct Command-key presentation on
  macOS and Ctrl-key presentation on other platforms;
- reject unmodified keys, protected browser/macOS combinations, and conflicts
  with another Fluxion command before saving;
- persist the normalized shortcut map in the browser profile and update live
  command handlers immediately without restarting;
- reset individual actions while keeping Gecko's standard browser shortcuts
  clearly listed and untouched.

The macOS release gate now changes a shortcut in the packaged app, reads the
persisted value back, and visually inspects the Keyboard settings section.

Version 0.10 adds native multi-select workflows to Flow:

- Command-click individual tabs and Shift-click a visible range using familiar
  macOS selection semantics;
- retain Gecko's native `selectedTabs`, `TabMultiSelect`, split-pair selection,
  and accessibility state instead of maintaining a second selection model;
- batch duplicate, reload, pin/unpin, sleep, group, move to workspace, drag,
  and close from the same concise tab menu;
- make split pairs move atomically and keep actions scoped to one tab when the
  context-clicked tab is outside the current selection;
- show multi-selected rows with a quiet one-pixel boundary rather than a loud
  block of accent colour.

The macOS release gate now creates a real native Gecko multi-selection and
requires both selected rows to remain projected in Flow.

Version 0.9 adds secure, temporary Peek Pages:

- choose **Peek Link** from Gecko's native webpage link menu;
- open the real page in a real Gecko tab using the source document's existing
  principal, CSP, referrer, container, and history parameters;
- label the temporary page quietly in Flow and close it automatically when the
  user switches away;
- keep it as an ordinary tab, promote it beside the source as a native split,
  or close it without polluting recently closed tabs;
- discard unpromoted Peeks during restart/crash restoration while ordinary
  promoted tabs continue through SessionStore.

The macOS release gate now opens and renders a real HTTPS Peek Page before the
DMG can be packaged.

Version 0.8 adds real Gecko-native tab sleeping for large sessions:

- choose 5, 15, 30, or 60 minutes—or never—from live Fluxion Settings;
- flush current SessionStore state, release the content process through
  Gecko's native discard path, and restore the page when selected;
- never force a discard, allowing Gecko to protect unsaved forms and active
  page dialogs through its `beforeunload` checks;
- exclude selected, pinned, audio/PiP, shared, split-view, busy, private, and
  already sleeping tabs;
- show a quiet crescent state in Flow and provide a concise manual sleep action
  for eligible background tabs.

The macOS release gate now proves that a real background Gecko browser was
discarded before packaging the app.

Version 0.7 replaces the visible Firefox preferences page with live Fluxion
Settings:

- a restrained, compact preferences layout that remains beside the Flow tab
  sidebar instead of presenting an admin dashboard;
- startup, session restoration, homepage, external-link, and default-search
  controls backed by Gecko preferences and search services;
- immediate Flow sidebar mode and tab-density controls plus an independent
  animation switch that still respects macOS Reduce Motion;
- real tab warning and foreground-selection controls;
- Browser Memory opt-in, domain exclusions, and semantic-data deletion;
- confirmed actions to clear Gecko history, cookies/cache, or saved site
  permissions;
- an accurate keyboard reference for Fluxion and retained browser shortcuts.

The macOS release gate now opens the packaged settings surface and refuses to
publish unless the privileged controls are visible and connected.

Version 0.6 introduces the first usable Browser Memory milestone:

- opt in from the command palette; ordinary browsing remains AI-independent;
- search history by exact text and, on supported Macs, local semantic meaning;
- combine keyword evidence, vector similarity, recency, visit frequency, and
  active-workspace relevance without letting weak semantics beat exact terms;
- keep history and embeddings on-device with Gecko's local embedding runtime;
- reject Browser Memory access from private windows;
- automatically filter obvious auth, mail, account, billing, and payment URLs;
- exclude the current domain and its subdomains without deleting normal history;
- clear all semantic vectors and disable the feature from a visible control;
- fall back to exact local history search when the model is unavailable.

The macOS gate opens the packaged Browser Memory service and visually inspects
its dedicated search mode before a DMG can be published.

Version 0.5 adds a real Gecko-native split view to the Flow interaction model:

- place any two ordinary tabs side by side from a concise tab menu;
- choose the second page with fuzzy tab search from the command palette;
- open a blank page directly beside the current page;
- resize the two live Gecko panels with a directly manipulated divider;
- swap sides or separate the pair without losing either tab;
- treat paired tabs as one connected item when moving between workspaces;
- restore the split through Gecko SessionStore after restart or recovery;
- keep security state, dialogs, page processes, and navigation owned by Gecko.

The panel focus, divider, and inactive-site footer are restyled into Fluxion's
restrained visual system. The macOS release gate now refuses a build unless a
native split is live alongside Flow and a native tab group.

Version 0.4 integrates Gecko-native tab groups directly into Flow:

- compact group headings with collapse and expand state;
- group names and restrained colour indicators;
- drag tabs into groups or use the concise native context menu;
- reorder groups and move a whole group between workspaces;
- remove individual tabs from a group or ungroup without closing anything;
- include group names in high-volume tab search;
- retain Gecko SessionStore ownership of group membership and crash recovery.

The macOS release gate now creates a real native group and refuses the build
unless Fluxion renders it successfully.

Version 0.3 made Fluxion workspaces fully persistent and user-manageable:

- create and name workspaces directly from the Flow strip;
- rename and reorder workspaces through concise native context menus;
- choose one of five geometric symbols and five restrained accents;
- drag tabs directly onto workspace destinations;
- delete workspaces without losing tabs—open pages move to an adjacent space;
- search for the `New workspace` action from the command palette.

It also includes the version 0.2 independent browser-chrome foundation:

- a restrained navigation skin that retains Gecko's security-aware URL field;
- a flatter, denser Flow sidebar with a 44px compact rail;
- icon-only persistent pinned tabs and quieter workspace indicators;
- `Cmd/Ctrl+K` search across commands, tabs, workspaces, history, and bookmarks;
- `Cmd/Ctrl+Shift+A` high-volume open-tab search;
- a blank new-tab surface with immediate address-field focus;
- native macOS traffic-light controls and a real HTTPS rendering release gate;
- removal of inherited Firefox startup icon, onboarding, and visible app
  branding.

## Install

1. Download the `.dmg` file and open it.
2. Drag `Fluxion.app` to the Applications link.
3. Open Fluxion from Applications.

The preview is ad-hoc signed but not Apple-notarized. If macOS blocks the first
launch, right-click Fluxion and choose **Open**, or approve it under **System
Settings → Privacy & Security**. The attached `.sha256` file can be used to
verify the download.

Private browsing, downloads, permissions, PDF viewing, developer tools, media,
and WebExtensions continue to use Firefox/Gecko's existing implementations.
Platform passkeys are unavailable in this ad-hoc-signed preview because that
macOS entitlement requires an Apple provisioning profile.
