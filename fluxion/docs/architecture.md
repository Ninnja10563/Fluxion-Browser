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

### macOS process and external-open integration

The native launcher uses `execv` to preserve the application process that
LaunchServices started. Gecko's `MacApplicationDelegate` receives cold-start
and running-app URL/file AppleEvents; Fluxion does not add a parallel URL
handler or privileged content bridge. `MOZ_APP_REMOTINGNAME=fluxion` gives the
native remote service a product-specific namespace. The explicit Fluxion
profile path remains part of Gecko's command-line remote endpoint identity, so
another direct invocation can forward URLs to that profile's running process.
The obsolete `--no-remote` argument is removed: pinned Gecko 155 ignores it.
Replacing it with `--new-instance` would suppress useful native forwarding.

These integration points were audited in the pinned runtime's
`toolkit/xre/nsAppRunner.cpp`, `toolkit/components/remote/RemoteUtils.h`,
`nsMacRemoteClient.mm`, and `widget/cocoa/MacApplicationDelegate.mm`. Future
upstream upgrades must retain or re-audit them. The packaged native gate uses
real `/usr/bin/open` cold/warm events, a Unicode/spaced local HTML file whose
JavaScript changes its title, and a second direct invocation; it only observes
Gecko's selected page, without substituting programmatic tab creation.
The fixture uses a temporary profile and never changes default-app settings.
LaunchServices selects an application instance, not a deterministic profile
among multiple running instances; direct CLI profile routing remains the
explicit multi-profile path.

### Retained browser services

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

### Cross-window tab adoption

`fluxion-tab-transfer.js` is the privileged transfer adapter;
`fluxion-window-tabs.js` supplies native tab/group menu actions and Flow drag
interaction. Both use real Gecko tabs, not URL recreation. The locked Gecko
155 API accepts options objects for `adoptTab`, `adoptTabGroup`, and
`adoptSplitView`. These signatures and native old/new `TabOpen` mappings must
be re-audited when updating Gecko. Whole selected groups use native group
adoption; split selections expand to both panes and use native split adoption.
A split placed beside an existing group is ungrouped through Gecko's wrapper
API, never by pulling its panes out individually.

Eligibility revalidates live tab/window membership, matching private modes,
destination tabs, workspace IDs, and required native capabilities before
mutation. Temporary Peeks require explicit promotion first. Typed drag data
contains privileged native tab objects, not a URL, selector, or caller-supplied
tab identifier. The UI additionally validates system principals and window
membership; rejected drops inside browser windows cannot trigger detachment.
Escape and untrusted drag-end events cannot create windows.

Both windows pause workspace-selection reconciliation during synchronous
adoption. The returned native nodes receive explicit workspace state, pinned
state, and split orientation before final selection/reconciliation. A window
menu captures the destination workspace shown to the user; a new window keeps
source workspace membership by default. Moving all visible tabs leaves a real
visible new tab in the source window: Gecko's last-tab check ignores hidden
workspace pages, so merely counting total tabs would risk closing their window.
Detachment explicitly requests a native blank destination
instead of loading the user's homepage. It removes only that same untouched
initial blank document with a known, unchanged zero- or one-entry history,
never a navigated page, typed address draft, or replacement tab.
Partial native failures report surviving adopted nodes and leave remaining
source tabs alone; the adapter does not promise atomic rollback or close pages
to disguise a failed move.

The packaged macOS transfer gate checks live page state, unsaved text, native
history, container/pin/workspace identity, groups, stacked splits, private
boundaries, and the shipped menu command. Its programmatic `pushState` fixture
traverses unactivated entries explicitly; it does not change Gecko's normal
user-interaction filtering for Back/Forward. Menu-event integration and native
DataTransfer DOM tests are not claims of physical OS pointer-gesture
verification. The separate session gate adopts grouped/split/pinned-container
pages before checkpointing and requires unique ownership and their native
metadata after both clean relaunch and abrupt-process crash recovery.

## Custom components

Flow menu sessions are separated into `core/flow-menu-session.js`. Each native
popup captures immutable target membership, validates it again before command
execution, and cancels when its workspace or targets become stale. Native
command handling precedes `popuphidden` in the locked Gecko/Cocoa implementation;
claimed actions therefore retain their captured state until dismissal, while
Escape can restore the current DOM projection of its original anchor. Focus
restoration is gated by window and control ownership, not just tab identity.

Palette tab records use weak ownership and prepared search fields. Raw metadata
is checked on every search, including changes made while the palette is closed.
The query is normalized once; bounded top-K insertion retains the same score,
confidence cutoff, fallback ordering, and original-index tie rules as a full
sort. `scripts/benchmark-tab-search.cjs` compares the frozen 0.54 ranker and
current code in identical Node VM contexts; it does not measure native painting.

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

Bundled scripts load through the registered `resource://fluxion/` mapping after
their local files are checked. Current Gecko requires a trusted scheme for
privileged subscripts; Fluxion does not enable unsafe script loading or relax
the browser's content security preferences.

Flow separates layout ownership from its visible surface. Expanded and Compact
give the outer rail a 232px or 44px layout width. Focus reduces that rail to 3px
and positions the same 232px Flow surface over Gecko's browser deck with a
transform. Revealing it therefore does not resize, reload, or replace the live
content panel. While translated offscreen the surface is `inert`; pointer and
keyboard reveal restore its existing native-tab controls, and Escape returns
focus to the rail. Reduced-motion settings remove both rail and surface
transitions.

Workspace membership is stored as a per-tab custom SessionStore value. Each
workspace's last active page is another bounded custom value; selecting a page
atomically clears any duplicate marker in that workspace. Matching tab
attributes are only the immediate browser-chrome projection and migration path;
the custom values are restored by Gecko before Fluxion's delayed UI starts.
Switching back prefers that native tab and falls back to Gecko's `lastAccessed`
recency when a workspace has not yet been visited. Moving tabs or deleting a
workspace clears stale markers rather than overwriting the destination's resume
point. Each window's current workspace is a bounded custom SessionStore window
value, so two restored windows can remain in different workspaces. The former
profile preference is retained only as a migration/default for a genuinely new
normal window; private windows never rewrite it. Sidebar state remains a
profile preference. This keeps crash recovery atomic with the actual tab and
window session and avoids a second database whose state could drift from
Firefox.

Gecko may finish exposing restored window `extData` or applying its native
selected-tab state after Fluxion chrome is already interactive. Fluxion uses
the selected tab's already restored workspace as a provisional non-destructive
choice and does not write a window value during initial projection. After
SessionStore's `promiseAllWindowsRestored` resolves, it re-reads the native
window value and reconciles it. An actual workspace choice made by the user
during that interval is recorded separately and wins. This keeps Flow immediate
without replacing Gecko's restore lifecycle; the multi-launch verifier awaits
the same authoritative boundary before exercising workspace switches.

Workspace definitions are a small bounded Firefox preference containing only
stable IDs, names, geometric symbols, restrained accent names, and order.
Flow's context menu and Fluxion Settings call one window controller for every
mutation. The controller emits a chrome-only change event for live surfaces and
observes the preference in every open browser window. Deletion enumerates
Fluxion windows and rewrites each affected native tab's SessionStore workspace
value to the adjacent surviving destination before removing the definition;
it never closes a page as a side effect. The packaged gate drives the visible
Settings controls, while the multi-launch gate independently proves the
metadata returns after Gecko restores the profile.

After initial restoration, both native tab selection and `SSTabRestored` queue
one reconciliation against the final selected tab's saved workspace. Intentional
workspace switches are guarded so their intermediate Gecko selection events
cannot reverse the user's action. Native undo-close and Flow's Recently Closed
therefore converge on the same visible selection.

Workspace buttons and the modular Settings workspace editor retain DOM identity
by workspace ID. The editor owns uncommitted name drafts separately from saved
metadata, so remote renames, symbols, accents, and ordering cannot erase typing.
On supported Gecko, [state-preserving DOM moves](https://developer.mozilla.org/en-US/docs/Web/API/Element/moveBefore)
retain focus, selection, and composition; older engines use a guarded fallback
that cannot commit drafts as a side effect of moving a node. Deletion repairs
only focus owned by the removed editor, never focus in another control.

Packaged recovery validation uses Gecko's real shutdown and startup path rather
than serialising Fluxion state in a test fixture. One app launch creates two
normal windows. The primary window records distinct active pages in Focus and
Build and adds a pinned tab, a native group, and a native split pair. The
companion records its own Build page but remains visibly selected in Life.
Content state is flushed through each frame loader and both native window
records before Gecko performs an attempted clean quit. A second app launch must
recover both windows separately, including their Build and Life SessionStore
window values; switching the primary must not change the companion. The gate
then opens a real private window, confirms that Browser Memory returns its
private state and cannot be enabled, quits, and launches normal mode once more.
That final launch must retain both normal windows while the private URL is
absent from tabs, Places history, and Browser Memory. This exercises the same
SessionStore and private-origin boundaries users rely on; Fluxion does not
maintain a shadow session database.

`fluxion.cfg` supplies Fluxion's blank homepage on Gecko's default preference
branch, preserving explicit web, local-file, and blank user homepages. Earlier
previews' managed bundle-path homepages migrate to that default so moving the
app doesn't leave a stale path. The native bookmarks-toolbar choice is likewise
a default, not a forced setting, and its visibility remains owned by Gecko.
Startup deliberately does not write
`browser.startup.page`. The value selected in General settings therefore
survives the next privileged startup and Gecko, rather than Fluxion, decides
whether to reopen the previous windows and tabs. The recovery gate keeps that
preference at Gecko's restore value across every controlled relaunch, guarding
against startup configuration accidentally replacing a saved session with the
homepage. It overrides future new-tab destinations without navigating the
selected browser: a SessionStore tab can still report `about:blank` while its
saved page is being restored.

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

Crash verification uses a separate profile with blank startup and
`resume_session_once=false`. The fixture observes Gecko's periodic compressed
recovery file, then the harness sends SIGKILL to its owned browser process.
The next launch must report Gecko's crash-recovery startup type and restore
two windows' native layout and workspace state. A private window is open at
termination; its URL must be absent from the disk checkpoint, restored tabs,
Places, and Browser Memory. No clean shutdown or forced SessionStore write
can satisfy this gate.

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
versioned `about:preferences?fluxion=about` Fluxion surface; Settings continues
through the same stable Gecko preferences document into Fluxion's live overlay.
Fluxion-owned sections use a query route because Gecko is free to canonicalise
unknown preferences fragments to a built-in pane. No bundle file path is
exposed and no dynamically registered protocol is required.

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

The current macOS preview targets the stable Firefox release pinned in
`runtime/gecko-lock.json`; ESR is not assumed to support the native split and
embedding APIs used here. Product adapters surround unstable browser-chrome
APIs; web-platform APIs are not forked. For an upstream update:

1. run unit checks and the headless Gecko startup smoke test;
2. run browser-chrome integration tests against the new locked runtime;
3. inspect changes to `browser.xhtml`, `gBrowser`, and SessionStore;
4. update only the compatibility adapter and selectors when necessary;
5. perform manual navigation, permission, download, private-window, session,
   and accessibility passes on macOS, Linux, and Windows.

The intended release build is an automated Firefox source build that applies
the same `chrome/` code as a shallow patch stack and supplies Fluxion branding.
Keeping product code outside Gecko makes rebasing much smaller than a deep
Firefox fork. The daily upstream version check flags when the reviewed runtime
needs a security-update review. Preview users must install the new Fluxion DMG;
Mozilla's `DisableAppUpdate` policy prevents the inherited updater from
overwriting the product, without disabling extension or security-service updates.

About provides an explicit Fluxion release check. `FluxionUpdates` is a privileged,
process-shared module; importing it performs no network request. A user action
fetches only the fixed public GitHub releases endpoint, omitting credentials and
referrer, rejecting redirects, and bounding the streamed response to 4 MiB and
100 records. A 10-second deadline aborts the request, including response-body
reads. Concurrent checks share one request; failures are not retried
automatically. Rate-limit responses create a shared cooldown using GitHub's
retry/reset advice (one minute when no valid future advice is supplied); checks
during that interval return the retry time without another network request.
Other failures are not cached. Rate-limit, malformed-response, and network failures are not
reported as being up to date.

The pure `FluxionRelease` selector compares full `major.minor.patch-preview.N`
versions numerically, treats a stable version as newer than its own previews,
and excludes previews for stable installations. It validates non-draft release
flags, the exact repository/tag URL, and one uploaded positive-size universal
DMG plus matching checksum asset with exact official URLs. It chooses the highest
compatible version among the bounded recent records without relying on ordering;
no compatible candidate is an indeterminate result, and an older candidate never
produces a download action. Only macOS currently has packaged update support.
This is release discovery, not binary-integrity verification or a signed updater.
Downloading is a separate user action through Gecko, and installation remains
manual. Developer ID signing, notarization, and authenticated automatic updates
remain release-hardening work.

The macOS bundle includes `fluxion/runtime-provenance.json` with source version,
build IDs, original executable/signature-manifest hashes, and a source identity.
The development cache hashes small authoritative files and inspects full source
file metadata, so same-path upstream replacements invalidate it without reading
large Gecko libraries on every launch. This is cache identity, not a substitute
for release archive integrity or code-signature verification.

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

Asynchronous Memory work carries a shared revision from the profile's enriched
store. Privacy changes invalidate earlier extraction, embedding, and search
work across browser windows. Page extraction also rechecks the live browsing
context and exclusion policy before committing evidence, preventing a response
from a previous navigation from being attributed to the current page.
Gecko Places removal notifications delete the corresponding extracted evidence
and vectors. Removing only some visits also removes that URL's combined Memory
record, since an extract cannot safely be attributed to a surviving visit.
Clearing history clears the enriched store, including evidence for bookmarked
pages whose Places records remain. Reads await these deletion operations.
A persisted pending-removal marker covers interrupted or failed deletions.
On the next launch, that marker forces the enriched store to clear before
any records become readable. This recovery conservatively discards all enriched
Memory evidence; it does not delete additional Gecko history or bookmarks.
The observer contract follows Gecko's
[Places notifications](https://firefox-source-docs.mozilla.org/browser/places/notifyObservers.html).

The command palette invalidates pending requests whenever its query, mode, or
open state changes. Editing a query immediately removes the previous executable
results; delayed successes and failures cannot replace the current results.
Editing a page question also aborts the previous provider request.

Memory search publishes grounded Places text matches first and enriched text
matches as soon as their SQL query finishes, before waiting for embeddings.
The palette applies the same query/open-state guards to partial and final
results, rejects post-completion partials, and retains the selected result by
URL when semantic ranking changes. Partial results never claim semantic evidence.
Native semantic search has a shared 1.2-second response deadline covering
connection initialization, index readiness, and inference. Its pending slot
remains occupied until Gecko actually finishes, even after timeout; other
windows receive immediate lexical fallback instead of queuing more requests.
Native and enriched retrieval run concurrently. These are embedding deadlines,
not guarantees on disk latency or the total search duration.

Enriched keyword retrieval matches each query term across title, URL,
description, headings, and body before hybrid ranking. Exact title/URL matches
precede whole-phrase matches before bounding candidates, so recent partial
matches cannot exclude an older exact record. Schema v2 keeps five normalized
search-field copies alongside unchanged source evidence. Candidate queries and
the ranker share NFKD decomposition, combining-mark removal, locale-independent
lowercasing, and whitespace normalization; this is not transliteration or
language-aware stemming. Existing v1 records are backfilled in 50-row keyset
batches within one transaction, yielding between batches. The version advances
only after completion; interruption rolls back the migration. Pending privacy
recovery runs first, and page IDs and existing vectors are preserved.
The native upgrade gate creates a separate disposable v1 database with real
Gecko `vec0` storage, verifies interruption rollback and a bounded retry, and
compares stored vector bytes before migration and after reopening. Its synthetic
four-value vector proves storage preservation, not model inference; the separate
local-model retrieval gate must also pass.
Embedding calls are single-flight
with a 10-second indexing wait and a 1.5-second query wait. Gecko has no
per-request cancellation here: a timed-out model request may finish internally,
but cannot write a late vector or accumulate more model requests. Other pages
can still save lexical evidence while that request is pending.

Settings observes the persisted Memory enabled/provider/exclusion preferences
in each window and reconciles again when shown. Synchronization does not unlock
pending controls or overwrite an unsaved exclusion draft. Completion reconciles
the latest persisted values, and window unload removes all observers.

Browser Memory is opt-in and uses Gecko's packaged
`PlacesSemanticHistoryManager`, `EmbeddingsGenerator`, and SQLite `vec0`
extension. Gecko's title index remains in `places_semantic.sqlite`; Fluxion's
bounded page evidence lives separately in `fluxion_memory.sqlite`. A narrow
`JSWindowActor` extracts the title, description, headings, and useful
article/main text in the content process. It never reads form values and only
returns a bounded plain-data record to privileged browser code. No history or
page evidence is sent to a network AI provider.
The embedding adapter uses Gecko's current singleton factory and supports the
earlier class factory. When an upstream model changes vector dimensions, the
store rebuilds only its vector table; extracted page evidence remains available
for keyword recall, and subsequent visits can generate compatible vectors.

Gecko generates and queries embeddings on-device and disables the model path
when hardware requirements are not met. Fluxion commits bounded lexical
evidence before starting embedding work and applies a short timeout to semantic
queries, so model startup can never block navigation or lexical recall. Fluxion
merges semantic
results with exact/fuzzy Places evidence, recency,
visit frequency, and active-workspace relevance. Exact evidence has an explicit
ranking advantage over a weaker semantic neighbour. A URL receives lexical
strength once and only its strongest semantic similarity, independent of how
many sources return it. Lexical placeholder distances are not reported as
semantic evidence. The native gate first recalls an old exact record omitted
by Places' frecency candidate cap and recalls accented body-only evidence absent
from native title/URL matches. It then generates real local model vectors and
verifies nonliteral retrieval independently.

### Saved browsing context versus currently open tabs

Browser Memory keeps one enriched record per URL, not a workspace-tagged ledger
of every visit. Its saved context describes the **latest indexed extraction**:
the workspace ID, workspace-name snapshot, group-name snapshot, and extraction
timestamp. These values are captured before awaiting the content actor. A move,
rename, or deletion while extraction is pending cannot substitute the tab's
later context. A subsequent successful extraction of the same URL may replace
the saved snapshot; merely moving a tab or renaming its workspace does not.

Schema 3 adds `workspace_name` without altering existing page IDs, original
evidence, normalized search fields, or vectors. Upgrades run v1→v2→v3 or v2→v3.
Existing records retain their stored workspace IDs and group names, but their
historical workspace names remain unknown: looking up today's name cannot
recover yesterday's name. Such records say “Saved workspace name not recorded.”
New snapshots remain readable as “Saved in …” and “Saved group: …” even after
their original workspace/group is renamed or deleted.

`savedContext` is distinct from `openContexts`. The latter is recomputed from
non-closing tabs in the current non-private browser window for each partial and
final search response. Multiple tabs with the same URL yield deterministic,
deduplicated workspace/group combinations, labelled “Open here in …”; they do
not overwrite saved context. Other windows are not inferred, and this is a
search-response snapshot, not a continuously updating tab inventory. The UI
shows at most three current combinations plus an additional-count label.

A visit-date label concerns the returned history record and must not be read as
the time its workspace/group snapshot was captured. “Saved in …” describes the
stored extraction, not a claim that every visit occurred there. Ranking gives
saved-workspace agreement a 0.3 bonus or current-window open-workspace agreement
a 0.15 bonus, taking the stronger signal rather than adding both. Duplicate tabs
cannot multiply that relevance. Exact-match priority remains stronger than
either contextual signal.

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

Embedding execution is a separate persisted choice from Browser Memory
storage. `gecko-local` enables Gecko's on-device semantic-history and ML feature
gates; `disabled` keeps lexical Places and enriched-page recall active while
skipping every embedding call. Switching to Keywords only deletes native
`vec_history` vectors and their mappings, plus Fluxion's `page_vectors`, while
retaining ordinary history and bounded textual evidence. The shared
`FluxionNativeMemory` adapter accesses native storage independently of the
manager's feature-gated connection accessor: a disabled accessor returning null
does not prove the database is empty. Cleanup awaits Gecko's initialization
before opening its storage-only connection, without enabling the model.
One shared initialization promise covers that entire open/schema lifecycle:
the low-level Gecko database accessor alone can return a connection before
initialization finishes, or race another open into schema recovery. All
Fluxion storage-only readers and cleanup paths share the completed connection.

The adapter tracks native embedding/write operations across windows. Purging
first persists `fluxion.memory.nativePendingRemoval`, disables native feature
gates, waits for outstanding writes, and then deletes vectors and mappings in
one transaction. Failed or timed-out cleanup retains that quarantine; enabling
semantic search must finish recovery first. Autoconfig honors the durable
barrier and installs the write guard at `profile-after-change` for opted-in
profiles, before browser-window consumers can begin indexing. These are
explicit integration contracts with the pinned Gecko manager and must be
rechecked on upstream updates. Re-enabling semantic search uses only Gecko's
packaged local embedder; new indexing of retained ordinary history is allowed
after explicit re-enablement, and never uses a generative AI provider.

The enriched-page store owns its SQLite lifetime explicitly. Before its first
connection begins opening, the module registers a Gecko
`AsyncShutdown.profileBeforeChange` blocker. Clean profile shutdown waits for
that blocker to close the connection and any queued statements; initialization
failures close their partially opened connection as well. Once shutdown begins,
the module refuses new database work. This prevents late profile writes and
keeps session restoration from depending on an unclean process exit.

Firefox excludes private-window visits before they enter Places, and Fluxion
also refuses Browser Memory operations from private windows. Pages containing
password fields are rejected before storage. Auth, mail, payment, billing, and
other obviously sensitive URLs are filtered. User domain
exclusions are stored as a local preference. Exclusion checks and enriched-store
deletion normalize the optional DNS root dot, so `example.com.` and its
subdomains cannot bypass an `example.com` exclusion. Excluded vector rows are replaced
with a content-free sentinel and filtered at query time, preventing the native
indexer from immediately recreating page-derived vectors while retaining the
ordinary history record. Explicit exclusion cleanup uses shared storage-only
access even when the initiating window has not opened the native manager or
the machine does not qualify for native semantic search. Plain numeric arrays
cross the browser-chrome/module boundary for Gecko's tensor converter; a
window-owned typed array fails its realm-specific `instanceof` check. Cleanup
attempts both native scrubbing and enriched-evidence deletion, and reports
failures rather than silently claiming success.

Native additions now pass a pre-embedding candidate boundary in the shared
manager adapter. Each bounded batch resolves its hashes against actual Places
URLs; any excluded/sensitive URL sharing a hash blocks that hash, and unknown
or imprecise hashes cannot reach the model. Blocked known candidates receive
content-free sentinel mappings/vectors. Gecko's original batch counts and
remaining-work scheduling are retained, so excluded entries cannot keep
occupying the first batch indefinitely. Allowed candidates still use Gecko's
own embedding and vector-write implementation.

An exclusion save drains native writes that already started before performing
its final scrub. A previously permitted in-flight model result can briefly
finish during this asynchronous operation; success is not reported until those
writes and cleanup finish. A timeout/failure is reported, not represented as a
completed deletion. This is not atomic or forensic erasure across a crash.

`FluxionUrlbarMemory.sys.mjs` unregisters only Gecko's experimental
`UrlbarProviderSemanticHistorySearch` provider (and the older
`SemanticHistorySearch` alias) from native URL-bar/smart-bar registries at
profile readiness. Ordinary Places, autofill and search providers remain.
Semantic recall is exposed through Fluxion's policy-filtered Memory interface,
not a second native provider that bypasses its exclusions. Native indexing
also requires this boundary before accessing its manager; incompatibility
closes model gates without creating new deletion intent. This uses pinned
provider-object deregistration and supports the known ESR singleton export;
unknown registry APIs fail explicitly and require an upstream re-audit.

Sensitive-path classification decodes percent escapes locally, checking each
layer for sensitive segments and treating decoded slash/backslash characters
as separators. It never rewrites the stored or navigated URL. Four decoding
passes and an 8,192-code-unit path budget bound the work; malformed escapes,
invalid UTF-8, remaining escapes beyond the limit, and oversized paths are
ineligible for Memory. Ordinary encoded article names and Unicode remain
eligible. This is a conservative heuristic, not a comprehensive classifier
of financial, health, or other sensitive content. Named exclusion lists let
users organize their own domains into categories; there is no downloaded
taxonomy, automatic category classification, or external lookup.

The enriched store imports the same policy through a privileged module bridge.
Before exposing its first connection on each launch, it removes blocked page
text and vectors in transactional, 256-row keyset batches, yielding between
full batches. Each batch prepares an immutable normalized exclusion snapshot;
the next batch reads current policy again, without retaining a cross-event
preference cache. Initialization failure closes the connection and prevents reads;
the next launch retries the policy sweep. Non-private window startup also
prunes an existing evidence database when Memory is disabled, without creating
one in a never-enabled profile. Upserts recheck the current policy after their
asynchronous storage barrier. Existing deletion revision/quarantine guards
remain in force. These are logical SQLite deletions, not a promise of forensic
erasure from storage media or backups; ordinary Places history is retained.
Native exclusion sweeps likewise prepare one policy for their synchronous
classification pass. User edits validate the entire policy before saving:
at most 20 named lists and 200 domain memberships across direct exclusions
and all lists, including disabled lists. Duplicate normalized domains within
one list count once; the same domain in separate lists counts in each. Limits
report errors without silently dropping entries or changing the saved policy.

`FluxionExclusionPolicy.sys.mjs` owns a single versioned JSON preference,
`fluxion.memory.exclusionPolicy`. Existing flat exclusions remain a read-only
fallback only while that preference is absent; the first successful edit
migrates them atomically. An opaque process revision detects stale drafts and
cross-window edits, including changes away from and back to the same value.
Mutations and cleanup use the shared native control queue. Committing a policy
synchronously invalidates pending extraction/search and aborts page-AI work;
cleanup then attempts native sentinel replacement and enriched evidence
deletion. A cleanup error can follow a successful policy commit and is reported
as such. Ordinary Places history is not deleted. Removing an exclusion permits
future indexing; it never restores deleted extracted text or vectors.

Malformed or unsupported policy blocks Memory indexing, retrieval and page-AI
egress until explicitly repaired/reset. It is not itself permission to purge
existing databases. Startup preserves previously requested deletion flags and
does not construct Fluxion's native manager for an invalid policy. Fluxion
also clears Gecko 155's internal `places.semanticHistory.initialized` activation
marker on invalid policy, without changing `removeOnStartup` or pending purge
intent. This prevents a separate Gecko address-bar consumer from interpreting
temporarily unavailable models as permission to delete the native database.
The marker is set by Gecko's constructor when models are available; it is not an
embedding or a user enablement preference. This pinned constructor contract
must be re-audited on upstream upgrades (see the pinned
[manager constructor](https://github.com/mozilla-firefox/firefox/blob/FIREFOX_155_0_1_RELEASE/toolkit/components/places/PlacesSemanticHistoryManager.sys.mjs#L242)
and its availability check before opening storage). Settings
retains conflicting drafts for correction and offers explicit reset recovery;
reset warns that already-enabled features can resume with empty exclusions.
Private windows can inspect policy but cannot modify persistent exclusions.
These additions passed branch native diagnostics and are integrated into the
0.61 release candidate, pending its full release checks;
see [exclusion-list validation](validation/exclusion-lists-candidate.md).

Older previews do not understand named lists or the canonical preference.
Do not downgrade a migrated profile while relying on these exclusions: turn
off Memory and page AI first, and re-establish exclusions supported by the
older version before enabling them. The legacy preference retained during
migration is not a continuously synchronized compatibility copy.

Clearing Browser Memory disables its feature gates,
deletes vector rows and mappings, and schedules the semantic database files for
removal at the next startup. The same actions delete matching records and
vectors from Fluxion's enriched store. They do not silently delete ordinary
history. Content normalization, private/password policy, domain exclusions,
size limits, and deletion paths are independently tested. Generative
`AIProvider` and `EmbeddingProvider` interfaces remain separate; ordinary
Browser Memory recall never calls the generative provider, and disabling one
does not disable the other.

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
storage—and enter only the outbound authorization header. Each canonical
endpoint has its own login realm; changing endpoints never reuses another
endpoint's key. A process-shared control queue serializes key/configuration
writes across windows. Legacy unscoped keys are bound only to the endpoint
already saved before migration; if no endpoint is known, the unbound key is
removed and must be entered again rather than sent to a guessed destination.

Ask Current Page reuses the narrow `FluxionMemoryPage` actor. Before extraction,
and again after receiving its plain-data result, the chrome service applies the
private-window, sensitive-route, password-form, scheme, and excluded-domain
policy. The actor skips editable draft subtrees and derives headings from the
same bounded sanitized traversal, rather than reading an independent unsanitized heading
channel. Editable extraction roots and document-wide editing mode produce no
evidence. Existing indexed evidence is not retroactively classified for edited
page subtrees; users can erase it through Clear Browser Memory. URL policy is
reapplied to stored evidence as described above. The iterative walker stops after 4,096
visited nodes or 24,000 text characters, uses bounded `substringData` reads,
and never clones the DOM or reads a whole subtree's text. Heading evidence is
limited to 24 entries of 240 characters; title extraction has its own 64-node,
300-character budget. Native source and password selectors remain document-wide;
these limits describe evidence traversal, not all work done by the DOM engine.
Shared revision tracking and abort controllers invalidate pending AI
work on provider, endpoint, model, key, or domain-exclusion changes, including
changes in another window. Requests recheck eligibility after extraction,
after consent, after credential lookup, and before returning results; a disable
followed by re-enable cannot resurrect a previously queued request. Abort
cannot retract bytes already sent to a provider, but stops further work and
suppresses stale results.
A remote provider receives no page text until the user confirms sharing
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

The packager installs a narrowly scoped local chrome-manifest override for
`chrome://browser/content/default-bookmarks.html`, registered during autoconfig
before Places startup. The installer verifies the pinned archive resource but
never rewrites Gecko's archive. Firefox's own import policy still decides when
defaults are needed. Mozilla's [optimized JAR layout](https://raw.githubusercontent.com/mozilla-firefox/firefox/FIREFOX_155_0_1_RELEASE/python/mozbuild/mozpack/mozjar.py)
is validated through a temporary read-only view with original local-file offsets
and CRC checking; the packaged archive remains byte-for-byte unchanged. Native
import policy covers
fresh profiles, recovery without a usable backup, or an
explicit restore-defaults action. Fluxion does not force an import preference
or rename/delete existing bookmarks. A native two-launch test verifies fresh
Fluxion defaults and preservation of existing GUIDs, titles, URLs, hierarchy,
and order, including user-created bookmarks with Firefox-like names.

Fluxion Library is a privileged product surface projected when a real
`about:downloads` tab is selected. The underlying internal tab remains
Gecko-owned and session-restorable, while the visible interface is independent
of Firefox's organizer styling. History and bookmarks are bounded read queries
against the existing Places connection; mutations use `PlacesUtils.history`
and `PlacesUtils.bookmarks` after explicit confirmation. Bookmark URLs pass
through Fluxion's safe navigation policy so a stored script-bearing scheme is
never executed from privileged chrome.

Section controls navigate the real internal tab to a fixed
`about:downloads#history`, `#bookmarks`, `#folders`, or `#downloads` URL through
Gecko. These fragment navigations retain the underlying document and participate
in native Back/Forward history. Committed URLs are authoritative over restored
tab attributes; attributes only bridge an owned tab's initial `about:blank`
state. An explicit pending section bridges pre-commit selection notifications,
but real navigation notifications always reconcile to Gecko's current URI.
Same-section commits retain live search/focus state without re-querying. No
content script can invoke the privileged Library controller.

Library history and bookmark search is applied inside Places before the page
limit. Pages use a descending native microsecond timestamp and record-ID cursor,
with one lookahead record to determine whether Next is available; at most 100
result rows are displayed. This avoids skipping tied timestamps or loading an
entire profile into the UI. Bookmark folder restrictions also run before the
limit. Native `autocomplete_match` supplies literal, Unicode-aware matching
across title, URL, and bookmark folder labels; its upstream title/URL matching
bound remains 255 bytes, so this is not full-text page-content search. Browser
Memory remains the separate extracted-content retrieval system.

Every search, section, folder, and page change invalidates pending result
delivery. Only the current query may replace rows or their loading state.
Gecko [Places event notifications](https://raw.githubusercontent.com/mozilla-firefox/firefox/FIREFOX_155_0_1_RELEASE/dom/chrome-webidl/PlacesEvent.webidl)
refresh the visible affected section after native
or other-window edits; hidden views defer database work until shown. History
deletion and bookmark changes cannot repopulate a view from an old response.
Non-deletion background updates retain reading geometry while blocking actions
on stale rows, then restore the current item's focus and scroll position.
Explicit searches and deletion events clear old results immediately. A compact
sticky pager remains available deep in the list, and bookmark controls wrap
within narrow windows instead of being clipped.

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

Download progress has its own bounded refresh queue; it never reruns Places
history or bookmark queries. Download rows and their action buttons retain
native-object identity across progress, cancellation, retry and completion.
Controls read the live Download object, and a disappearing focused control
returns focus to its row. Removing a record delegates to Gecko's
[`Download.finalize(true)`](https://raw.githubusercontent.com/mozilla-firefox/firefox/FIREFOX_155_0_1_RELEASE/toolkit/components/downloads/DownloadCore.sys.mjs)
before list removal, preventing concurrent restart and clearing partial data
without deleting completed files. Retained reputation-blocked downloads use
Gecko's exact-item confirmation dialog, not an ordinary retry. The decision
is rechecked against current native state after the dialog returns. Parental
and content-analysis blocks receive no new override path.

## Tab sleeping boundary

Fluxion schedules eligibility, but Gecko owns suspension. The scheduler uses a
tab's native `lastAccessed` timestamp and excludes active or sensitive runtime
states before calling `gBrowser.prepareDiscardBrowser`. It then calls
`gBrowser.discardBrowser(tab, false)`: the non-forced path invokes Gecko's
`permitUnload` protection, refuses active dialogs, records a lazy SessionStore
state, tears down the content browser, and restores it through the ordinary tab
selection path. Fluxion does not serialize page state itself.

SessionStore preparation is asynchronous. After it resolves, Fluxion rechecks
eligibility, native browser identity, window ownership, and the sleeping
preference revision before discarding. A per-tab pending guard deduplicates
concurrent requests. Preference observers cancel pending work even when another
window changes the interval away and back; window teardown cancels it too.

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

### Collapsed native-group projection

`core/tab-groups.js` derives one immutable visible-row projection from the
current native members, native selected tab, and Gecko-owned `collapsed` flag.
Expanded groups expose every member. An inactive collapsed group exposes none;
a collapsed group containing the selected tab exposes only that tab and an
exact hidden-member count. The chrome rebuilds from this projection and does
not persist it.

That retained active row remains in Flow's ordinary roving focus collection.
When keyboard navigation selects an adjacent ungrouped page, the group becomes
heading-only on the following frame. If Gecko later selects another member,
the next projection follows Gecko's resulting selection and collapse state;
Fluxion does not force the group to remain collapsed. This preserves a visible
explanation of the rendered page without turning Fluxion into a competing owner
of groups or selection.

Before replacing Flow's row DOM, the renderer captures only a currently
focused native-tab or native-group identity. It restores that identity after
the rebuild unless an explicit workspace-focus request takes precedence.
Consecutive native group events therefore cannot detach keyboard focus, while
focus in the address bar, page, palette, or another surface is never pulled
into Flow.

The ordinary-page region is exposed as a vertical accessibility tree. Native
group headings are level-one expandable tree items; their projected pages are
level-two tree items owned through an explicit group relationship. Up/Down,
Home, and End traverse only visible headings and pages. Right opens a closed
heading or enters its first child, while Left closes an open heading or returns
from a child to its parent. Moving onto a heading changes DOM focus only;
moving onto a page also selects the exact Gecko tab. Enter and Space toggle the
focused heading without creating a Fluxion collapse preference.

## Flow focus and scale boundary

Flow uses one roving tab stop per composite instead of placing every open tab
or group heading in the browser-wide Tab sequence. Up/Down, Home, and End move
through the ordinary-page tree; Left/Right moves through the pinned-app row and
workspace strip. Selection remains native in `gBrowser`, while short-lived
native tab/group references restore DOM focus after Flow's coalesced
animation-frame render. Keyboard close chooses the next visible page outside
the complete closing selection, preventing both focus loss and repeated
accidental close targeting.

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

Content-only tab events now queue only affected visible tabs. The updater
preserves row, title, close-control, and audio-control identity, and touches
only changed state. Unrelated attributes and off-workspace content events do
not refresh visible rows. Workspace buttons retain identity while their model
is unchanged. Selection and flat structural events use the incremental paths
described below; complex topology still uses full projection. This is not a
virtualized tab list. Audio actions
read current native state rather than capturing the state at row creation.

A separate packaged-app gate drives 24 batches of 20 native title/audio events
with 200 visible tabs. It checks stable rows and close controls, focus, scroll,
selection, workspace buttons, and zero structural removals; it also drives real
mute/unmute. Event-to-frame p50/p95/max timings are recorded in CI logs. These
cheap-page measurements detect regressions, not a claim of sustained high
refresh rates on content-heavy browsing sessions.

## Pointer-close stability

Flow treats the close button's pointer coordinates as a short-lived layout
anchor. After a pointer click, the native Gecko tab closes immediately after
the 120ms fade, but its inert Flow row keeps occupying the same vertical slot.
An accidental repeat click at the unchanged coordinates therefore reaches no
other close control. The first pointer movement outside the original button's
4px guard releases the row; it compresses to zero height over 120ms and then a
single coalesced render projects the remaining native tabs. Scrolling, window
deactivation, keyboard input, disabled animation, and reduced motion release
the hold immediately.

The hold contains only native-tab and transient DOM references. It never owns
a URL, navigation entry, closed-tab record, or tab order. Gecko still performs
the close, before-unload handling, selected-tab change, and SessionStore write.
Flow updates selected-row accessibility state and the window title even while
layout is held. A native multi-selection or split pair fades and releases as
one operation, while keyboard Delete/Backspace and middle click keep their
direct workflows.

This adapts Firefox's horizontal close-target sizing principle to a vertical
list; current upstream `tabs.js` explicitly skips its horizontal sizing lock in
vertical mode. The packaged macOS gate closes the middle of three real Gecko
tabs, repeats a click at the exact coordinates, and blocks packaging unless
only the intended tab closes, the following row stays fixed until movement,
and the held row then compresses away.

## Sidebar sizing ownership

`core/sidebar-width.js` defines the preferred-width bounds and direction-aware
keyboard arithmetic. `fluxion-sidebar-width.js` owns the privileged separator,
pointer capture, shared preference observation and responsive geometry. The
saved preference is distinct from the effective width of each window: reducing
available page space never writes a narrower global preference.

Pointer previews update one CSS width variable at most once per animation
frame and do not save preferences. A matching trusted release commits once;
Escape, capture loss, deactivation, mode changes, external preference edits and
teardown discard the preview. Gesture identity invalidates queued frames.
The final pointer width is resolved before ordinary width transitions resume.
Only the system-principal handle can initiate a gesture; no webpage-facing
API or content actor is added.

Expanded Flow and its non-reflowing Focus overlay use the same width. Compact
and Focus rails retain their separate fixed geometry. Settings and Library
offsets follow the layout width, and named CSS container queries adapt their
controls to the space actually left beside Flow, rather than viewport width
alone. The dedicated packaged gate checks native keys, Gecko-routed pointer
capture, cross-window geometry, narrow content bounds and clean relaunch.

The Settings layout uses the surface's container width, not the outer window,
to adapt workspace identity/editing rows, permission decisions, shortcut
controls and paired actions. At narrow widths these controls wrap or stack;
permission expiry is retained beside its decision instead of being hidden by
a viewport rule. The native Settings gate traverses all ten sections at 320
and 600 pixel root widths, with real populated permission records and workspace
creation/renaming, in addition to its original accessible-name checks. Browser
services and event handlers remain the owners of the actions; CSS changes do
not introduce replacement state or an alternate settings backend.

## Selection-only Flow updates

Flow distinguishes selection dirtiness from content and structural dirtiness.
The rendered selection snapshot contains the selected native tab, the current
workspace and the multi-selected set. A selection frame refreshes the old/new
selected rows and the symmetric difference of multi-selection, plus affected
expanded-group and split active indicators. It retains the existing controls,
listeners and container nodes. Structural dirtiness always takes precedence;
a workspace mismatch, disconnected selected row or changed collapsed-group
active-page projection falls back to the full renderer.

`TabMultiSelect` is observed on `gBrowser`, its actual Gecko dispatch target,
not the descendant tab strip. Regression tests execute that subscription
wiring with child-to-parent event propagation, including native changes that
do not originate in a Fluxion row handler.

Pinned and ordinary tab trees retain independent roving focus entries. The
final requested or retained focus target is chosen before changing attributes,
so an unrelated focused row is not temporarily deselected and reselected.
Pointer-close holds retain their existing deferred structural behavior.

Workspace marker reconciliation still reads authoritative SessionStore values
across the workspace, including restoration repairs. Only values that actually
change are written; a failed read still attempts repair. This reduces writes,
not the O(N) marker-read cost, and does not add a shadow session cache.

Workspace ownership lookup reuses its successful SessionStore read only within
that synchronous call when deciding whether repair is necessary. Explicit
setters and failed first reads retain a fresh comparison. No ownership is
cached across calls, events or restoration passes. This removes duplicate
lookup/comparison reads without removing either authoritative reconciliation
pass; the read path remains O(N).

The separate selection verifier uses 1,000 real native tabs (40 eagerly created
browsers and the remainder lazy), repeated ordinary selection and multi-select
operations, and real Flow activation handlers. Identity, mutation and focus
assertions are distinct from hosted event-to-frame timings. Group, pin and
split transitions remain part of that gate rather than being inferred from
plain tabs alone.

## Hierarchical Flow structural updates

Opening, closing and moving native tabs reconcile rows keyed by the actual
Gecko tab objects, including grouped and split projections. Existing
rows refresh only changed content. Pinning or unpinning recreates the affected
row for its changed accessibility role, while retaining the other rows.
Group headings and their accessible child-container IDs are retained by native
group object identity, not labels or persisted IDs. Split wrappers are retained
within their projected parent; partial splits show an ordinary row, and collapsed
groups still show only their selected page. Moving between group levels updates
the existing row's hierarchy without replacing its controls.

`core/flow-tree.js` validates the complete unique-node plan before moving nodes,
connects new wrappers before moving existing controls into them, and prunes
obsolete wrappers only after all surviving children have reached their new
parents. This keeps regrouping or separating a split from disconnecting controls
that still belong in the visible sidebar. Removed projections are not retained
as a hidden cache. Pointer-close holding defers all these mutations.

A per-parent longest-increasing-subsequence plan keeps already ordered rows stationary
and relocates only the necessary DOM nodes. A single native reorder therefore
needs one DOM relocation, although adjacent-swap ties can relocate the neighbor
instead of the tab that emitted the native event. Both retain object identity.
State-preserving `moveBefore` is preferred when available; the fallback repairs
owned close/audio focus only if focus fell to the document, without stealing
focus from another control. Pointer-close holding remains authoritative.

Authoritative tab/workspace reads remain O(N), and the ordering plan is
O(N log N). This reduces DOM work; it does not establish constant-time tab
operations, sustained frame rates or content-heavy memory performance. The
native structure gate uses 1,000 tabs (40 eager, 960 lazy), actual Gecko tab
operations and chrome focus. Its expanded checks cover native group
creation, changes and collapse, split creation/orientation/reversal/separation,
and native split wrappers moved into groups. Local VM tests are separate evidence;
the published 0.62 build passed all 21 operations in the packaged native gate,
including global visible-order assertions, with zero unaffected row writes.

## Native group dragging

The 0.63 candidate keeps same-window group drag identity in privileged chrome,
never in a page-readable payload. `FluxionFlowDrag` validates current native
membership, workspace, pin/closing state and split backreferences both while
showing feedback and again at drop time. Either pane resolves to its complete
native split wrapper; duplicate selections cannot split or duplicate that unit.
The group drop calls Gecko's `group.addTabs` with those validated units. Pinned
tabs are rejected rather than allowing that API to unpin them implicitly.

Whole groups move before/after an outer native tab, split or group using
`gBrowser.moveTabBefore` / `moveTabAfter`; they never nest in another group.
The pointer's position within the hovered row or heading chooses before/after,
and the insertion line is drawn on the outer unit's actual boundary. Existing
Move Group Up/Down menus use the same validation and now traverse ordinary tabs
and splits as well as groups. Cross-window group dragging is not introduced;
the explicit native-adoption Move to Window menu remains available.

Gecko retains page/session state, group membership and collapse state. Flow's
keyed renderer retains surviving controls and heading relationships. The native
structure verifier exercises actual chrome handlers using DOM DragEvents and a
Gecko DataTransfer, not physical trackpad input. Candidate native validation is
required before release; pure and VM tests alone do not prove native behavior.

Manual DMG packaging derives its default release from the supplied app's
bundled Settings constants, parsed as data. It requires the complete release
and product/bundle versions to agree, and refuses an explicit mismatched label
before packaging tools or output mutations. It never labels an older app with
the current checkout's version. Native packaging/signature gates remain
mandatory in addition to shell control-flow tests with simulated macOS tools.

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
