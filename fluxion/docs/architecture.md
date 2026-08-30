# Architecture

## Decision

Fluxion uses a **Firefox/Gecko runtime overlay with privileged browser chrome**.
The launcher starts a dedicated Firefox profile and asks Firefox's supported
enterprise autoconfiguration hook to load Fluxion's chrome script into browser
windows. Web content remains in normal Gecko content processes. Fluxion never
embeds a webview and does not expose privileged APIs to page JavaScript.

Linux development targets Firefox ESR 140, while macOS preview packaging uses
Mozilla's current universal Gecko runtime so Apple Silicon and Intel slices can
be validated together. This was selected after inspecting the initial
repository (which contained no browser source) and the build host (ARM64 Debian
with Firefox ESR 140 available from its security repository). A full
mozilla-central checkout and build is a
valid long-term distribution path, but it is a poor first milestone: it adds a
very large source/build dependency before proving Fluxion's interaction model.
The overlay produces a real usable Gecko browser immediately and its chrome
code can later be applied as a small patch stack to an official Firefox source
build.

This is not an extension-only architecture. The browser-chrome layer has the
privilege needed to manage native Firefox tabs and windows, while ordinary web
pages retain Firefox's process, principal, and sandbox boundaries.

## Reused Firefox/Gecko components

- Gecko layout, JavaScript, CSS, WebAssembly, media, networking, cache, and
  cookie implementations;
- Firefox multi-process isolation, principals, permission prompts, certificate
  UI, authentication flows, and site security infrastructure;
- native address/search field, identity controls, and permission anchors;
- `gBrowser`, SessionStore, Places history/bookmarks, downloads, private
  browsing, crash recovery, PDF.js, picture-in-picture, DevTools, and
  WebExtensions;
- native dialogs, context menus, full-screen handling, accessibility, and
  platform appearance integration.

Retaining these systems is deliberate. Reimplementing them would reduce
security and compatibility while producing no product differentiation.

## Custom components

```text
bin/fluxion
  -> isolated Firefox profile
  -> Linux runtime symlink overlay OR macOS Fluxion.app copy
  -> runtime/fluxion.cfg (privileged startup boundary)
     -> chrome/core/*.js (typed-by-contract state, group projection, and URL helpers)
     -> chrome/fluxion-chrome.js
        -> Flow sidebar / workspaces / tab interactions / navigation skin
        -> native Flow application menu / versioned About route
        -> Firefox gBrowser + SessionStore
     -> chrome/fluxion-palette.js
        -> commands / tabs / workspaces / Places history and bookmarks
     -> newtab/ (unprivileged local document)
```

`fluxion.cfg` observes completed browser-window startup and loads code only
into windows whose chrome document is `browser.xhtml`. The Flow sidebar is
inserted beside Firefox's browser deck. It renders state from native tabs; it
does not create a parallel rendering or navigation stack.

Flow separates layout ownership from its visible surface. Expanded and Compact
give the outer rail a 232px or 44px layout width. Focus reduces that rail to 3px
and positions the same 232px Flow surface over Gecko's browser deck with a
transform. Revealing it therefore does not resize, reload, or replace the live
content panel. While translated offscreen the surface is `inert`; pointer and
keyboard reveal restore its existing native-tab controls, and Escape returns
focus to the rail. Reduced-motion settings remove both rail and surface
transitions.

Workspace membership is stored as a persisted SessionStore tab attribute.
The current workspace and sidebar state use Firefox preferences. This keeps
crash recovery atomic with the actual tab session and avoids a second database
whose state could drift from Firefox.

Packaged recovery validation uses Gecko's real shutdown and startup path rather
than serialising Fluxion state in a test fixture. One app launch creates tabs in
the Build workspace, a pinned tab, a native group, and a native split pair;
content state is flushed through each frame loader before Gecko performs an
attempted clean quit. A second app launch must recover all of those structures
from the same profile. The gate then opens a real private window, confirms that
Browser Memory returns its private state and cannot be enabled, quits, and
launches normal mode once more. That final launch must retain the normal session
while the private URL is absent from tabs, Places history, and Browser Memory.
This exercises the same SessionStore and private-origin boundaries users rely
on; Fluxion does not maintain a shadow session database.

Tab groups use Gecko's native `MozTabbrowserTabGroup` and `gBrowser` group
operations. Fluxion only projects those groups into Flow; labels, colours,
collapse state, tab membership, closed-group recovery, and crash restoration
remain owned by Firefox SessionStore.

Split view uses Gecko's native `MozTabSplitViewWrapper` and browser-panel deck.
Fluxion supplies creation and management affordances and projects each pair as
one connected Flow item. Gecko owns both live content processes, the draggable
divider, active-panel focus, security state, dialog containment, teardown, and
SessionStore restoration. No iframe, webview, or second navigation model is
introduced. Fluxion's orientation layer changes the native tab-panel flex axis
between a row and column, resets incompatible width/height residues, and keeps
the splitter's spatial ARIA values aligned with the selected direction. Fluxion
stores a bounded validated orientation map keyed by Gecko's own SessionStore-
restored `splitViewId`; live tab attributes provide immediate projection and a
compatibility fallback. The map contains no URLs or page state, and private
windows neither read nor write it. A stacked pair therefore restores without a
shadow tab/session database or page reload.

Flow's drag layer classifies pointer geometry without moving a tab itself. The
top and bottom 24% of a target row are stable before/after insertion zones; the
centre becomes a split target only when exactly one eligible native tab is
being dragged. Holding Shift selects stacked orientation, while ordinary
centre drops use side-by-side orientation and left/right pointer position sets
the native pair order. Visual RTL reverses that horizontal ordering.

Accepted reorder drops call Gecko's batch `moveTabsBefore` or `moveTabsAfter`
operations, with a compatibility fallback for older ESR chrome. Accepted split
drops delegate to the same `gBrowser.addTabSplitView` path as the context menu
and command palette. Multi-selections, pinned tabs, closing tabs, existing
split members, self-drops, and cross-workspace targets never advertise a split.
A polite live region describes the exact before/after/left/right/top/bottom
result while pointer feedback uses both an insertion line or literal label and
shape, not colour alone.

The visible navigation bar is styled by Fluxion but deliberately retains
Firefox's native URL bar internals. This preserves certificate identity,
permission anchors, autofill, search suggestions, extension page actions, and
keyboard behavior. The command palette is a separate browser-chrome surface;
it reads Places through privileged browser APIs, never through page JavaScript.

On macOS, Fluxion inserts a top-level native **Flow** menu into Gecko's XUL
menubar rather than replacing AppKit menu handling. Its items call the same
workspace, sidebar, palette, and Library controllers as the visible chrome, so
menu commands cannot drift into decorative duplicates. Standard File, Edit,
View, History, Bookmarks, Tools, Window, and Help commands remain Gecko-owned.
The trailing navigation-toolbar menu is another XUL entry point into those
controllers and `OpenBrowserWindow`; it replaces the visible Firefox PanelUI
button without replacing the native URL/security field or page-action widgets.
Its new-tab command delegates to Fluxion's workspace-aware `gBrowser` path, and
its window/private-window commands delegate to Gecko's own window constructor.
Page and Tools menuitems reference Gecko command nodes such as `cmd_find`,
`Browser:SavePage`, `cmd_print`, the `cmd_fullZoom*` family,
`View:FullScreen`, and `Tools:Addons`. XUL therefore propagates command state
and calls the same implementations as keyboard shortcuts and the platform menu.
The Developer Tools item lazily resolves Gecko's `gDevToolsBrowser` controller
and calls the same `toggleToolboxCommand` entry point as Firefox's dynamically
registered toolbox command; Fluxion neither embeds nor recreates DevTools.
That controller and a small checked native-command dispatcher are exported only
inside privileged browser chrome for the command palette. The palette omits
commands Gecko marks unavailable and never exposes this bridge to page content.
Recently Closed views similarly project a bounded display model from
`SessionStore.getClosedTabDataForWindow` and restore by the original index.
Fluxion stores no duplicate session record; Gecko continues to own navigation,
group, private-window, form, scroll, and crash-recovery state.
Palette web searches are resolved at execution time through Gecko
`SearchService`, including its private default, engine-provided URI, POST body,
and change notifications. Fluxion classifies input but stores no provider
template, so Settings, policy, locale, and WebExtension engine changes remain
authoritative.
Browsing-data controls similarly delegate to Gecko's `Sanitizer.showUI` entry
point. The native dialog owns time ranges, item selection, and coordinated
clearing of Places history, download records, form history, cookies, caches,
DOM storage, authentication state, content-blocking records, media-device
state, and site settings through `nsIClearDataService`. Fluxion contributes a
single-flight privileged controller and entry points in Settings and the
command palette; it does not issue partial direct deletes or expose the
sanitizer to page JavaScript.
The application menu's About command is captured at chrome scope and opens the
versioned `about:preferences#about` Fluxion surface; Settings continues through
the same stable Gecko preferences route into Fluxion's live overlay. No bundle
file path is exposed and no dynamically registered protocol is required.

Appearance selection uses Gecko's built-in theme packages rather than a second
Fluxion theme renderer. The privileged controller asks `BuiltInThemes` to make
the supported System, Light, and Dark packages available, resolves the chosen
theme through `AddonManager`, and enables it through the same lifecycle used by
Firefox onboarding. A preference observer projects changes into every open
Fluxion window, including changes made by Firefox-compatible theme extensions.
Fluxion sets its restrained product variables to the selected color scheme but
does not rewrite webpage colors or duplicate WebExtension theme storage.

The new-tab page is a local, unprivileged file. It can submit navigation but
cannot call chrome methods.

Fluxion Settings reads site decisions from Gecko's `nsIPermissionManager`
rather than maintaining a second permission store. The Permissions section
projects only safe HTTP(S) origins—never page paths, queries, or credentials—and
retains Gecko's allow, block, ask, permanent, session, timed, policy, private-
context, and tab-scoped distinctions. Individual and per-site resets remove the
exact native `nsIPermission` objects; the global reset delegates to Gecko's
bulk removal API. A `perm-changed` observer keeps every open Settings surface
in sync with permission prompts and other browser windows.

## Security boundaries

- Page JavaScript executes only in Gecko content processes and cannot reach
  `window.gBrowser`, preferences, the filesystem, or Fluxion chrome.
- The autoconfig entry point validates that it is loading a known local file
  beneath `FLUXION_ROOT` and only targets browser chrome windows.
- Fluxion uses native Firefox navigation APIs, URL fix-up, permission panels,
  download handling, and certificate state rather than shadow implementations.
- Site permission management enumerates and mutates Gecko principals only from
  privileged chrome; no permission object or reset capability crosses into a
  webpage content process.
- Private windows retain Firefox's private-browsing origin attributes. Fluxion
  also refuses Browser Memory and AI page tools in private windows.
- No credentials, telemetry keys, remote AI endpoints, or remote scripts are
  bundled. Local-provider defaults point only at loopback addresses.
- Mozilla telemetry upload, studies, Firefox onboarding, and pre-onboarding
  experiments are disabled before the first browser window is restored.
  Fluxion does not write Firefox Terms-of-Use acceptance preferences on a
  user's behalf.

The autoconfig hook is powerful by design. Installation artifacts must be
owned and writable only by the installing user or administrator. Release
packages will place chrome under a signed/read-only application bundle.

## Upstream update strategy

Fluxion targets Firefox ESR first. Each supported ESR is represented by a
small compatibility adapter around unstable browser-chrome APIs; web-platform
APIs are not forked. For an ESR update:

1. run unit checks and the headless Gecko startup smoke test;
2. run browser-chrome integration tests against the new ESR;
3. inspect changes to `browser.xhtml`, `gBrowser`, and SessionStore;
4. update only the compatibility adapter and selectors when necessary;
5. perform manual navigation, permission, download, private-window, session,
   and accessibility passes on macOS, Linux, and Windows.

The intended release build is an automated Firefox source build that applies
the same `chrome/` code as a shallow patch stack and supplies Fluxion branding.
Keeping product code outside Gecko makes rebasing much smaller than a deep
Firefox fork. Security updates can therefore follow the ESR cadence quickly.

## Platform plan

Development validation currently runs on Linux ARM64 because that is the
available host. The chrome layer uses platform-neutral Firefox UI APIs and
system fonts. The macOS development builder now produces a native
`Fluxion.app`: it copies (and never edits) the installed Firefox application,
bundles Fluxion's product layer under `Contents/Resources`, compiles a small
Finder-safe launcher for the current architecture, and ad-hoc signs the local
bundle. On Apple Silicon it rejects a Firefox build without an `arm64` slice,
so M-series Macs do not silently fall back to Rosetta.

A stable public macOS release still requires an Apple Developer ID,
hardened-runtime signing, notarization, update metadata, and final
traffic-light/menu polish. Preview releases use a two-pass build and visual
inspection gate documented in `docs/releases.md`. Windows and Linux use the
same product layer with platform packaging and title-bar adapters.

## Local Browser Memory boundary

Browser Memory is opt-in and uses Gecko's packaged
`PlacesSemanticHistoryManager`, `EmbeddingsGenerator`, and SQLite `vec0`
extension. Gecko's title index remains in `places_semantic.sqlite`; Fluxion's
bounded page evidence lives separately in `fluxion_memory.sqlite`. A narrow
`JSWindowActor` extracts the title, description, headings, and useful
article/main text in the content process. It never reads form values and only
returns a bounded plain-data record to privileged browser code. No history or
page evidence is sent to a network AI provider.
Gecko generates and queries embeddings on-device and disables the model path
when hardware requirements are not met. Fluxion commits bounded lexical
evidence before starting embedding work and applies a short timeout to semantic
queries, so model startup can never block navigation or lexical recall. Fluxion
merges semantic
results with exact/fuzzy Places evidence, recency,
visit frequency, and active-workspace relevance. Exact evidence has an explicit
ranking advantage over a weaker semantic neighbour.

Page indexing crosses a separate scheduling boundary before extraction or
embedding begins. A deduplicating queue holds at most 64 page browsers and runs
one job at a time after four seconds without user input. It consults Gecko's
system idle service and pauses for low unplugged battery, active audio,
picture-in-picture or capture, and `memory-pressure` notifications. Idle work is
dispatched through the browser window's idle callback when available. Policy
pauses preserve queued work and wake on renewed power or feature enablement;
disabling or clearing Browser Memory drops the pending queue. This keeps local
model work subordinate to the foreground browsing experience rather than
creating detached concurrent embeddings.

Recall answers are deterministic projections of the ranked records, not model
output. The answer names only the top record and retains its source URL. Every
visible result includes a bounded excerpt from its stored description, headings,
or page text plus explicit match reasons and visit context. An empty result set
has no source and produces only the insufficient-evidence message. This keeps
Browser Memory useful with generative AI disabled and makes every claim
inspectable against local browser data.

Firefox excludes private-window visits before they enter Places, and Fluxion
also refuses Browser Memory operations from private windows. Pages containing
password fields are rejected before storage. Auth, mail, payment, billing, and
other obviously sensitive URLs are filtered. User domain
exclusions are stored as a local preference; excluded vector rows are replaced
with a content-free sentinel and filtered at query time, preventing the native
indexer from immediately recreating page-derived vectors while retaining the
ordinary history record. Clearing Browser Memory disables its feature gates,
deletes vector rows and mappings, and schedules the semantic database files for
removal at the next startup. The same actions delete matching records and
vectors from Fluxion's enriched store. They do not silently delete ordinary
history. Content normalization, private/password policy, domain exclusions,
size limits, and deletion paths are independently tested. Generative
`AIProvider` and `EmbeddingProvider` interfaces remain separate; ordinary
Browser Memory recall never calls the generative provider.

## Optional AI provider boundary

Generative AI is disabled by default. `DisabledProvider`, `OllamaProvider`, and
`OpenAICompatibleProvider` implement a small privileged interface, while the
embedding interface remains independently selectable. The provider service is
loaded only into browser chrome and receives `window.fetch` from that privileged
scope. It is never attached to a content window, and page JavaScript cannot
reach the provider, its endpoint, or its credentials.

Provider endpoints reject embedded credentials, query strings, and fragments.
Plain HTTP is accepted only for `localhost`, IPv4 loopback, or IPv6 loopback;
all remote endpoints require HTTPS. Requests explicitly omit browser cookies
and HTTP authentication state, bypass the browser cache, have bounded payloads,
refuse redirects, and use cancellable timeouts. OpenAI-compatible keys are stored under a
synthetic origin in Firefox's Login Manager—not in preferences, source, or page
storage—and enter only the outbound authorization header.

Ask Current Page reuses the narrow `FluxionMemoryPage` actor. Before extraction,
and again after receiving its plain-data result, the chrome service applies the
private-window, sensitive-route, password-form, scheme, and excluded-domain
policy. A remote provider receives no page text until the user confirms sharing
with that endpoint. The provider prompt labels extracted page content as
untrusted quoted data and requires answers to remain within it. The palette
renders provider output only with `textContent` and always exposes the local
source title, URL, and excerpt so an answer is inspectable. This reduces prompt
injection risk but does not make model output authoritative.

Compare Selected Pages uses Gecko's native `selectedTabs` as its explicit user
selection. It accepts two to four live content browsers, applies the same page
policy independently to every source, and refuses the entire request if any
page fails. Each extract is capped at 5.5 KB before a single provider call;
provider output is returned beside a separate bounded title, URL, and excerpt
for every selected page. Fluxion never selects or reorganises tabs on a model's
behalf.

## Privileged settings surface

Fluxion Settings is browser chrome, not webpage content. When a selected tab
navigates to `about:preferences`, the window projects a Fluxion-owned settings
surface beside Flow and temporarily hides Gecko's preferences document. The
tab, URL, session state, and navigation remain Gecko-owned. Controls call
`Services.prefs`, Gecko's `SearchService`, Places history, cookie/cache services, and
the permission manager directly from the privileged product layer; none of
those capabilities are exposed to ordinary sites.

The original preferences document remains packaged as part of Gecko so mature
internal implementation and migration code are not removed. Fluxion owns the
normal user-facing route, while new settings are added only when they have a
working service behind them.

## Fluxion Library boundary

Fluxion Library is a privileged product surface projected when a real
`about:downloads` tab is selected. The underlying internal tab remains
Gecko-owned and session-restorable, while the visible interface is independent
of Firefox's organizer styling. History and bookmarks are bounded read queries
against the existing Places connection; mutations use `PlacesUtils.history`
and `PlacesUtils.bookmarks` after explicit confirmation. Bookmark URLs pass
through Fluxion's safe navigation policy so a stored script-bearing scheme is
never executed from privileged chrome.

Folder hierarchy is projected from Places parent GUIDs; Fluxion does not keep a
parallel folder tree. The toolbar, menu, unfiled, mobile, root, and tag folders
are protected from rename or deletion. Moving a bookmark supplies Gecko's
required `DEFAULT_INDEX` so it appends atomically in the destination. Folder
deletion uses `preventRemovalOfNonEmptyFolders`, ensuring a stale UI count can
never cause recursive data loss. Tag pseudo-folders are excluded from move
destinations because they have different Places semantics.

Downloads come from `Downloads.PUBLIC` in ordinary windows and
`Downloads.PRIVATE` in private windows. A live `DownloadList` view refreshes
progress without polling or duplicating download state. Open, containing-folder,
cancel, retry, and remove commands delegate to the native `Download` object;
removing a list entry never deletes its completed file. Fluxion does not
implement networking, file writing, quarantine metadata, reputation checks, or
content analysis. Those remain in Gecko's download stack.

## Tab sleeping boundary

Fluxion schedules eligibility, but Gecko owns suspension. The scheduler uses a
tab's native `lastAccessed` timestamp and excludes active or sensitive runtime
states before calling `gBrowser.prepareDiscardBrowser`. It then calls
`gBrowser.discardBrowser(tab, false)`: the non-forced path invokes Gecko's
`permitUnload` protection, refuses active dialogs, records a lazy SessionStore
state, tears down the content browser, and restores it through the ordinary tab
selection path. Fluxion does not serialize page state itself.

Private windows never run the scheduler. Selected, pinned, split, audio/PiP,
screen/camera/microphone-sharing, busy, closing, and already discarded tabs are
also excluded. These checks intentionally trade a small amount of potential
memory recovery for predictable browsing behaviour.

## Peek Page boundary

Peek Pages reuse `nsContextMenu`'s `_openLinkInParameters` and the browser
window's native `openLinkIn` path. This preserves the source page's triggering
principal, content-security policy, referrer, origin attributes, and container
identity; Fluxion never loads an untrusted URL into browser chrome or an
injected iframe. The resulting content remains an ordinary isolated Gecko tab.

The `fluxion-peek` marker is persisted only so restored temporary tabs can be
identified and removed. Closing uses Gecko's `skipSessionStore` option, so a
Peek does not appear under Reopen Closed Tab. Promotion removes the marker and
returns the tab to ordinary session ownership. Side-by-side promotion delegates
to the same native split-view wrapper as other Fluxion splits.

## Multi-selected tab ownership

Flow does not keep an independent selection array. Command-click, Shift-click,
and batch operations call Gecko's `addToMultiSelectedTabs`,
`addRangeToMultiSelectedTabs`, `removeFromMultiSelectedTabs`, and
`clearMultiSelectedTabs` APIs. Rendering listens for `TabMultiSelect` and reads
the native `multiselected` state, so extension commands, native menus, split
wrappers, and accessibility metadata continue to agree on which tabs are
selected.

Batch commands derive their target from `gBrowser.selectedTabs` only when the
context-clicked tab belongs to that selection. Otherwise the command remains
scoped to the clicked tab. Split children expand to their native pair for moves,
and Gecko retains ownership of before-unload prompts and multi-tab close
warnings.

## Keyboard command registry

Fluxion-owned commands resolve through one profile-backed shortcut registry.
Chords are stored as platform-neutral physical codes such as
`Accel+Shift+KeyA`; `Accel` maps to Command on macOS and Control elsewhere.
Flow, workspace navigation, tab search, the command palette, and Settings read
the same in-memory map and react to a `FluxionShortcutsChanged` window event.

The pure policy layer validates codes, repairs malformed persisted values,
prevents duplicate Fluxion bindings, and reserves operating-system or mature
Gecko combinations such as quit, close tab, new tab, location, reload, find,
and print. Standard browser shortcuts remain Gecko-owned and are displayed as
reference-only rows rather than being intercepted by Fluxion.

## Tab organisation boundary

Tab-group suggestions are produced locally from the titles and hostnames of
eligible unpinned, ungrouped tabs in the active workspace. The pure policy
module requires at least three supporting tabs, ignores privileged locations,
and caps proposals at eight pages so the confirmation remains inspectable. It
does not read page bodies, call an AI provider, or move anything on its own.

The command palette shows one strongest proposal with its evidence count and
suggested name. Accepting the native confirmation passes the exact still-open
tab objects to `gBrowser.addTabGroup`; cancellation is a no-op. Gecko therefore
continues to own group membership, ordering, collapse state, drag behaviour,
and SessionStore restoration.

## Flow focus and scale boundary

Flow uses one roving tab stop per tablist instead of placing every open tab in
the browser-wide Tab sequence. Up/Down, Home, and End move through visible tabs;
Left/Right, Home, and End move through workspaces. Selection remains native in
`gBrowser`, while a short-lived native-tab reference restores DOM focus after
Flow's coalesced animation-frame render. Keyboard close chooses the next visible
tab outside the complete closing selection, preventing both focus loss and
repeated accidental close targeting.

Nested mouse controls do not add hundreds of hidden Tab stops. The tab row
exposes sleeping and audio state through its accessible name, Delete/Backspace
closes, and `M` toggles an audible tab. The command palette similarly retains
focus in its combobox while `aria-activedescendant` identifies the active result.

The packaged macOS gate temporarily opens 200 cheap Gecko tabs in one workspace,
requires Flow to render all rows within a bounded animation frame with exactly
one tab stop, dispatches a real ArrowDown event, and verifies DOM focus follows
Gecko's changed selected tab after the rebuild. It removes the fixture before
visual capture. This is a regression gate, not a substitute for later CPU,
battery, and representative-content memory profiling.

## Native tab-status ownership

Flow derives page activity exclusively from Gecko's native tab state:
`busy`/`progress`, `attention`, `pictureinpicture`, `sharing`, `crashed`,
`soundplaying`, `muted`, `activemedia-blocked`, and SessionStore's pending or
discarded state. A pure projection module resolves stale-state precedence—for
example, a crash suppresses obsolete media controls—and produces the same
descriptions used by the visible marks and each tab row's accessible name.
Fluxion stores none of this state and reads no page content to infer it.

Audio actions call the native tab's `resumeDelayedMedia` and `toggleMuteAudio`
methods; the context menu applies the same operations to the exact Gecko-owned
multi-selection. Picture-in-picture and sharing marks are indicators rather
than privileged replicas of page controls. Compact and pinned Flow place one
status mark on the favicon corner so tab geometry stays stable. Loading is the
only animated mark, and it becomes static under reduced motion.

The packaged macOS gate sets the supported attributes on real Gecko tab
elements, requires Flow's marks and accessible descriptions, drives the visible
mute control, observes Gecko's resulting muted state, and then requires the
rerendered action to change to Unmute. This catches projection or interaction
breakage when upstream tab chrome changes without introducing a shadow media
state.
