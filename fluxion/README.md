# Fluxion

Fluxion is a calm, vertical-first desktop browser powered by Gecko. It keeps
Firefox's mature web platform, security model, downloads, permissions, PDF
viewer, developer tools, private browsing, session recovery, and WebExtension
support, then replaces the primary tab interaction with Fluxion's compact
**Flow** sidebar.

## Current milestone

Phase 1 is runnable and includes:

- arbitrary website rendering through Firefox ESR/Gecko;
- URL/search navigation, back, forward, reload, stop, and security identity;
- compact vertical tabs with favicons, titles, audio state, close controls,
  reordering, pinning, duplication, and native tab session restoration;
- three-state sidebar (expanded, compact, focus rail);
- workspace switching and moving tabs between workspaces;
- a restrained Fluxion navigation skin over Gecko's native security-aware URL
  field and a universal `Cmd/Ctrl+K` command palette;
- fuzzy keyboard search across commands, open tabs, workspaces, history, and
  bookmarks, with dedicated `Cmd/Ctrl+Shift+A` tab search;
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

## License

Fluxion-authored code is available under the repository's MIT license. Preview
DMGs bundle Mozilla Firefox/Gecko components under their respective licenses;
Mozilla trademarks and third-party components retain their own terms. Fluxion
is an independent project and is not affiliated with Mozilla.
