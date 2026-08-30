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
- compact vertical tabs with favicons, titles, audio state, close controls,
  reordering, pinning, duplication, and native tab session restoration;
- packaged multi-launch recovery for workspace membership, pinned tabs, native
  groups, and split views, with private tabs excluded from the restored session;
- Gecko-native named tab groups with collapse, reorder, colour, group-to-
  workspace movement, and crash/session restoration;
- local, evidence-backed tab-group suggestions across related ungrouped pages,
  with a concise preview and explicit confirmation before native grouping;
- Gecko-native two-page split view with a live draggable divider, Flow pairing,
  command-palette and context-menu creation, side swapping, separation, and
  native session restoration;
- three-state sidebar (expanded, compact, focus rail);
- persistent workspace creation, renaming, reordering, symbols, restrained
  accents, deletion with safe tab migration, and drag-to-workspace movement;
- a restrained Fluxion navigation skin over Gecko's native security-aware URL
  field and a universal `Cmd/Ctrl+K` command palette;
- fuzzy keyboard search across commands, open tabs, workspaces, history, and
  bookmarks, with dedicated `Cmd/Ctrl+Shift+A` tab search;
- optional Browser Memory search over non-private history, combining exact
  Places matches with Gecko's on-device embeddings, recency, frequency, and
  workspace relevance;
- optional Ollama and OpenAI-compatible providers for grounded current-page
  questions and explicit selected-tab comparison, with AI disabled by default
  and ordinary browsing independent;
- a Fluxion-owned settings surface with live controls for startup, search,
  Flow density, motion, tab behaviour, Browser Memory, browsing data, and site
  permissions, including searchable per-site camera, microphone, location,
  notification, expiry, and reset controls backed by Gecko's permission manager;
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

To browse two pages side by side, right-click a tab and choose **Open Side by
Side With**, or open the command palette and run **Open split view**. The pair
stays together in Flow and can be swapped, separated, or moved to another
workspace as one unit.

Browser Memory is off by default. Run **Enable Browser Memory** from the
command palette to opt in, then use **Search Browser Memory** to describe a
page you remember. The embedding model and vector database stay on the Mac;
private-window history is never eligible. The palette also provides controls
to exclude the current domain or delete the semantic database and turn the
feature off. Machines that do not meet Gecko's local-model requirements retain
exact and fuzzy local-history search without downloading or running a model.
When enabled, Fluxion also indexes a bounded extract of ordinary article/main
content locally, making remembered ideas discoverable even when their words do
not appear in the page title. Private pages, password forms, sensitive routes,
and excluded domains never enter this enriched store.

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
