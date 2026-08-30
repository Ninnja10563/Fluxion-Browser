# Fluxion

Fluxion is a calm, vertical-first desktop browser powered by Gecko. It keeps
Firefox's mature web platform, security model, downloads, permissions, PDF
viewer, developer tools, private browsing, session recovery, and WebExtension
support, then replaces the primary tab interaction with Fluxion's compact
**Flow** sidebar.

## Current milestone

The current preview is runnable and includes:

- arbitrary website rendering through Firefox ESR/Gecko;
- URL/search navigation, back, forward, reload, stop, and security identity;
- compact vertical tabs with favicons, titles, geometric loading, attention,
  picture-in-picture, camera/microphone/screen-sharing, crash, sleep, and audio
  indicators, working media controls, reordering, pinning, duplication, and
  native tab session restoration;
- roving keyboard focus for tabs and workspaces, arrow/Home/End navigation,
  stable focus after selection or close, pointer-close rows that hold their
  position against accidental repeat clicks and then compress on movement,
  and a packaged 200-tab render gate;
- per-workspace active-page memory: returning to a workspace resumes the exact
  native tab last used there, with Gecko recency as a safe first-visit fallback;
- packaged multi-launch recovery for workspace membership, active pages,
  per-window active workspaces, pinned tabs, native groups, and split views,
  including two normal windows restored to different workspaces while private
  tabs remain excluded from the session;
- Gecko-native named tab groups with collapse, reorder, colour, group-to-
  workspace movement, and crash/session restoration; a collapsed group keeps
  its active page visible, reports the remaining hidden pages as `+N`, and
  stays continuous with Flow's roving keyboard order;
- local, evidence-backed tab-group suggestions across related ungrouped pages,
  with a concise preview and explicit confirmation before native grouping;
- Gecko-native two-page split view with side-by-side and stacked layouts, a
  live draggable divider, Flow pairing, spatial accessibility labels,
  command-palette, context-menu, and direct center-drop creation, Shift-drag
  stacking, precise edge-drop reordering, order swapping, separation, and
  orientation-aware native session restoration;
- three-state sidebar with expanded and compact layouts plus a 3px Focus rail
  that reveals the full Flow as a non-reflowing pointer or keyboard overlay;
- persistent workspace creation, renaming, reordering, symbols, restrained
  accents, deletion with safe cross-window tab migration, and drag-to-workspace
  movement, available from both Flow and a dedicated live Settings section;
- a restrained Fluxion navigation skin over Gecko's native security-aware URL
  field and a universal `Cmd/Ctrl+K` command palette;
- fuzzy keyboard search across commands, open tabs, workspaces, history, and
  bookmarks, with dedicated `Cmd/Ctrl+Shift+A` tab search;
- live command-palette access to Gecko find, bookmarking, save, print, zoom,
  fullscreen, WebExtensions, and Developer Tools actions, with unavailable
  commands omitted instead of rendered as dead controls;
- command-palette web search through Gecko's live normal/private default
  engine, including native GET or POST submissions and workspace placement;
- per-window Recently Closed menus and searchable closed-tab palette results
  backed directly by Gecko SessionStore, including workspace-aware restoration;
- optional Browser Memory search over non-private history, combining exact
  Places matches with Gecko's on-device embeddings, recency, frequency, and
  workspace relevance;
- independent Browser Memory embedding control: **Keywords only** keeps local
  titles and page evidence searchable with ML and vectors disabled, while
  **Gecko on-device semantic** restores private local meaning search;
- a bounded, deduplicating Browser Memory queue that runs one page at a time
  and yields during user activity, low battery, active media/sharing, or memory
  pressure;
- optional Ollama and OpenAI-compatible providers for grounded current-page
  questions and explicit selected-tab comparison, with AI disabled by default
  and ordinary browsing independent;
- a Fluxion-owned settings surface with live controls for startup, search,
  Flow density, motion, tab behaviour, Browser Memory, browsing data, and site
  permissions, including searchable per-site camera, microphone, location,
  notification, expiry, and reset controls backed by Gecko's permission manager;
- live System, Light, and Dark appearance choices backed by Gecko's installed
  theme lifecycle, with third-party Firefox-compatible themes preserved and
  every major Settings destination searchable from the command palette;
- browsing-data and site-data clearing through Gecko's coordinated native
  Sanitizer dialog, available from both Settings and the command palette, so
  history, downloads, forms, cookies, cache, storage, logins, and site settings
  are not split across incomplete custom deletion paths;
- Fluxion Library for fast searchable history, bookmarks, and live downloads,
  backed by Gecko Places and Downloads with open, reveal, retry, cancel, and
  removal actions;
- automatic native tab sleeping with configurable idle intervals, safe
  before-unload handling, and exclusions for pinned, audio, shared, split, and
  private tabs;
- temporary Peek Pages opened from the native link menu, with explicit keep,
  close, and side-by-side promotion actions and no closed-tab/session clutter;
- native Command-click and Shift-click multi-selection in Flow, with batch
  reload, duplicate, pin, sleep, group, workspace, drag, and close actions;
- editable, profile-persisted shortcuts for the command palette, tab search,
  Flow sidebar, and workspace navigation, with conflict and reserved-key checks;
- a native **Flow** application menu on macOS for the palette, tab search,
  sidebar modes, workspaces, Library routes, and a versioned About Fluxion page;
- a restrained trailing Fluxion toolbar menu for new/private windows, palette,
  tab search, Library, settings, and About, replacing Firefox's inherited
  hamburger while keeping the same commands available from the macOS menu bar;
- native Page and Tools submenus for find, save, print, zoom, fullscreen,
  extensions, developer tools, and privacy controls, retaining complete command
  access on platforms without macOS's persistent application menu bar;
- private windows and all mature Firefox browser services;
- a deliberately blank new-tab page and Fluxion product identity.

This is intentionally an incremental browser fork. Later phases are tracked in
[`docs/roadmap.md`](docs/roadmap.md); controls for unfinished features are not
shown in the UI.

An ad-hoc-signed Apple Silicon-compatible DMG is available from
[GitHub Releases](https://github.com/Ninnja10563/Fluxion-Browser/releases).
It is an early preview and is not Apple-notarized; see
[`docs/macos.md`](docs/macos.md) for installation details.

## Run

Fluxion requires Firefox ESR 140 or compatible Firefox on the host.

### macOS on Apple Silicon (M1, M2, M3, and M4)

Prerequisites:

1. Install the current native Firefox from
   [mozilla.org/firefox](https://www.mozilla.org/firefox/). The normal universal
   Firefox download contains native Apple Silicon code.
2. Install Apple's Command Line Tools once:

   ```sh
   xcode-select --install
   ```

Then, from Terminal:

```sh
git clone https://github.com/Ninnja10563/Fluxion-Browser.git
cd Fluxion-Browser/fluxion
./scripts/build-macos.sh
open ../.runtime/Fluxion.app
```

You can also build and run directly with:

```sh
./bin/fluxion
```

The builder verifies the Firefox executable has an `arm64` slice, compiles the
small native launcher for the requested architecture, copies Firefox into
an ignored local `.runtime/Fluxion.app`, installs the Fluxion chrome, and
ad-hoc signs the development bundle. It does not need Homebrew, Rosetta, or
administrator access and does not modify `/Applications/Firefox.app`.
Detailed build and troubleshooting notes are in
[`docs/macos.md`](docs/macos.md).
The build, visual-inspection, and publishing gate is described in
[`docs/releases.md`](docs/releases.md).

Fluxion's profile is stored separately at:

```text
~/Library/Application Support/Fluxion/Profiles/default
```

If Firefox is installed outside `/Applications`, specify it explicitly:

```sh
FLUXION_FIREFOX_BIN="/path/to/Firefox.app/Contents/MacOS/firefox" ./bin/fluxion
```

### Linux

On Debian:

```sh
sudo apt install firefox-esr
./bin/fluxion
```

Alternatively point the launcher at a Firefox binary:

```sh
FLUXION_FIREFOX_BIN=/path/to/firefox ./bin/fluxion
```

On Linux, Fluxion creates a dedicated profile under `.profiles/default`. On
macOS it uses the Application Support path shown above. It never mutates the
user's normal Firefox profile. Override it with
`FLUXION_PROFILE=/absolute/path`.

Useful launcher options:

```sh
./bin/fluxion --private-window
./bin/fluxion https://example.com
./bin/fluxion --safe-mode       # Gecko troubleshooting mode
./bin/fluxion --version
```

## Develop and test

No JavaScript package installation is required.

Building and running Fluxion on macOS does not require Node.js. The JavaScript
unit-test commands below require Node.js 20 or newer.

```sh
./scripts/check.sh
node --test tests/*.test.js
```

To validate Gecko and the privileged chrome together in a desktop session (or
under Xvfb):

```sh
./scripts/smoke-gecko.sh
```

The smoke test needs a locally installed Firefox or `FLUXION_FIREFOX_BIN`.
Architecture and upstream strategy are described in
[`docs/architecture.md`](docs/architecture.md).
The product's visual rules and researched reference points are documented in
[`docs/design.md`](docs/design.md).

## Keyboard model

Firefox shortcuts remain available. Fluxion adds:

| Action | macOS | Windows/Linux |
| --- | --- | --- |
| Cycle Flow sidebar | `Cmd+Shift+\\` | `Ctrl+Shift+\\` |
| Next workspace | `Cmd+Option+]` | `Ctrl+Alt+]` |
| Previous workspace | `Cmd+Option+[` | `Ctrl+Alt+[` |
| New tab | `Cmd+T` | `Ctrl+T` |
| Reopen closed tab | `Cmd+Shift+T` | `Ctrl+Shift+T` |
| Tab search | `Cmd+Shift+A` | `Ctrl+Shift+A` |
| Command palette | `Cmd+K` | `Ctrl+K` |

Use the `+` beside the workspace strip to create a workspace. Right-click a
workspace name or symbol to rename, reorder, recolour, change its symbol, or
delete it. Deleting a workspace never closes its tabs; Fluxion moves them to an
adjacent workspace after confirmation.

Collapsing a native tab group keeps its currently selected page visible as one
compact row and labels the remaining hidden members as `+N`. Arrow navigation
continues through that row into neighbouring pages. Gecko remains authoritative
if another action changes selection or expands the group.

To browse two pages together, right-click a tab and choose **Open in Split View
With**, or use **Open split side by side** / **Open stacked split** in the
command palette. You can also drag one ordinary tab over the centre of another:
the left or right half sets its side, and holding Shift changes the preview to
**Stack above** or **Stack below**. Use the narrow top or bottom edge when you
only want to reorder. An existing pair can switch between columns and rows
without reloading either page. It stays together in Flow and can be reordered,
separated, moved to another workspace, and restored after a restart as one
unit.

Browser Memory is off by default. Run **Enable Browser Memory** from the
command palette to opt in, then use **Search Browser Memory** to describe a
page you remember. The embedding model and vector database stay on the Mac;
private-window history is never eligible. The palette also provides controls
to exclude the current domain or delete the semantic database and turn the
feature off. Machines that do not meet Gecko's local-model requirements retain
exact and fuzzy local-history search without downloading or running a model.
Search & Memory settings can also switch an enabled index to **Keywords only**;
Fluxion deletes semantic vectors and disables Gecko's model gates while keeping
local titles and bounded page evidence searchable. Switching back to **Gecko
on-device semantic** never involves the configured generative AI provider.
When enabled, Fluxion also indexes a bounded extract of ordinary article/main
content locally, making remembered ideas discoverable even when their words do
not appear in the page title. Private pages, password forms, sensitive routes,
and excluded domains never enter this enriched store. Page extraction and
embedding run serially through a capped local queue after a quiet period. The
queue pauses while the user is active, the Mac is low on battery, the current
page is playing or sharing media, or Gecko reports memory pressure; pending
pages remain queued and resume when conditions recover.

Each recall now begins with a concise best match grounded in the returned
history record. Source rows show the matching local excerpt, why it matched,
when it was visited, and its workspace. Fluxion says that nothing relevant was
found when no stored record supports the query; it does not invent a browsing
memory or require a generative model.

AI is also disabled by default. Open **Fluxion Settings → AI** to choose a
local Ollama endpoint or an OpenAI-compatible endpoint and model. Loopback HTTP
is allowed for local tools; non-local endpoints must use HTTPS. Compatible API
keys are stored in Firefox's encrypted login manager rather than preferences.
After saving and testing the connection, run **Ask Current Page** from the
command palette. Fluxion extracts a bounded, form-free page record through a
Gecko content-process actor and shows the exact source beside the answer.
Private windows, password-bearing pages, sensitive routes, and Browser Memory
domain exclusions are refused. Sending page text to a non-local provider
requires explicit consent for that endpoint. The page is treated as untrusted
quoted data, and Escape cancels an in-flight request.

To compare pages, Command-click two to four tabs in Flow, open the command
palette, and run **Compare Selected Pages**. Fluxion sends only those explicitly
selected, policy-approved extracts and shows a separate source record for each
page. It never chooses tabs or reorganises them automatically.

Run **Open history**, **Open bookmarks**, or **Open downloads** from the command
palette to enter Fluxion Library. History and bookmarks are read from the real
Places database; downloads update from Gecko's live download list and remain
separate in private windows. Finished files can be opened or revealed, active
downloads canceled, interrupted downloads retried, and list entries removed.
The Bookmarks section can save the last ordinary webpage, filter by a nested
folder, rename bookmarks, and move them between folders. The Folders section
creates root folders or subfolders, renames user folders, and safely refuses to
delete non-empty folders. Gecko's advanced organizer remains available for
bulk operations and import/export.

## License

Fluxion-authored code is available under the repository's MIT license. Preview
DMGs bundle Mozilla Firefox/Gecko components under their respective licenses;
Mozilla trademarks and third-party components retain their own terms. Fluxion
is an independent project and is not affiliated with Mozilla.
