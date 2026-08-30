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
        -> Firefox gBrowser + SessionStore
     -> chrome/fluxion-palette.js
        -> commands / tabs / workspaces / Places history and bookmarks
     -> newtab/ (unprivileged local document)
```

`fluxion.cfg` observes completed browser-window startup and loads code only
into windows whose chrome document is `browser.xhtml`. The Flow sidebar is
inserted beside Firefox's browser deck. It renders state from native tabs; it
does not create a parallel rendering or navigation stack.

Workspace membership is stored as a persisted SessionStore tab attribute.
The current workspace and sidebar state use Firefox preferences. This keeps
crash recovery atomic with the actual tab session and avoids a second database
whose state could drift from Firefox.

Tab groups use Gecko's native `MozTabbrowserTabGroup` and `gBrowser` group
operations. Fluxion only projects those groups into Flow; labels, colours,
collapse state, tab membership, closed-group recovery, and crash restoration
remain owned by Firefox SessionStore.

Split view uses Gecko's native `MozTabSplitViewWrapper` and browser-panel deck.
Fluxion supplies creation and management affordances and projects each pair as
one connected Flow item. Gecko owns both live content processes, the draggable
divider, active-panel focus, security state, dialog containment, teardown, and
SessionStore restoration. No iframe, webview, or second navigation model is
introduced. Current upstream Gecko exposes a two-column layout; a stacked
layout will not ship until it can preserve the same native lifecycle.

The visible navigation bar is styled by Fluxion but deliberately retains
Firefox's native URL bar internals. This preserves certificate identity,
permission anchors, autofill, search suggestions, extension page actions, and
keyboard behavior. The command palette is a separate browser-chrome surface;
it reads Places through privileged browser APIs, never through page JavaScript.

The new-tab page is a local, unprivileged file. It can submit navigation but
cannot call chrome methods.

## Security boundaries

- Page JavaScript executes only in Gecko content processes and cannot reach
  `window.gBrowser`, preferences, the filesystem, or Fluxion chrome.
- The autoconfig entry point validates that it is loading a known local file
  beneath `FLUXION_ROOT` and only targets browser chrome windows.
- Fluxion uses native Firefox navigation APIs, URL fix-up, permission panels,
  download handling, and certificate state rather than shadow implementations.
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
Gecko generates and queries embeddings on-device in deferred chunks, monitors
chunk latency, and disables the model path when hardware requirements are not
met. Fluxion commits bounded lexical evidence before starting best-effort
embedding work and applies a short timeout to semantic queries, so model startup
can never block navigation, indexing, or lexical recall. Fluxion merges semantic
results with exact/fuzzy Places evidence, recency,
visit frequency, and active-workspace relevance. Exact evidence has an explicit
ranking advantage over a weaker semantic neighbour.

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
