# Running Fluxion on an Apple Silicon Mac

Fluxion supports M1, M2, M3, and M4 Macs through Mozilla's native ARM64 Gecko
runtime. It does not use Rosetta, Chromium, Electron, or a system web view.

## Install the preview DMG

Download the newest macOS asset from
[GitHub Releases](https://github.com/Ninnja10563/Fluxion-Browser/releases), open
the DMG, and drag `Fluxion.app` to Applications. The universal application
contains a native Apple Silicon launcher and runs natively on an M3 Mac.

The preview is ad-hoc signed but is not yet Apple-notarized. On first launch,
macOS may require you to right-click Fluxion and choose **Open**, or approve it
under **System Settings → Privacy & Security**.

## One-time setup

Install the current Firefox for macOS from Mozilla and move `Firefox.app` into
`/Applications`. Install Apple's Command Line Tools from Terminal:

```sh
xcode-select --install
```

The Command Line Tools provide the native C compiler and signing utilities used
to assemble a local development application. Homebrew and the full Xcode
application are not required.

## Build and open

```sh
git clone https://github.com/Ninnja10563/Fluxion-Browser.git
cd Fluxion-Browser/fluxion
./scripts/build-macos.sh
open ../.runtime/Fluxion.app
```

The builder briefly launches an isolated test window and refuses to report
success unless the **Flow** tab sidebar actually loads. The sidebar appears on
the left and contains the workspace buttons and vertical tabs.

The initial build copies Firefox and may take a little while. Later launches
reuse the local application until Firefox or Fluxion source files change.

For terminal-driven development, this shorter command builds when necessary
and immediately starts the browser:

```sh
./bin/fluxion
```

Pass normal Firefox command-line arguments after it:

```sh
./bin/fluxion https://example.com
./bin/fluxion --private-window
```

## What the builder changes

The builder never edits `/Applications/Firefox.app`. It creates the ignored
local application `.runtime/Fluxion.app`, adds Fluxion's chrome and new-tab
resources, compiles a native launcher, generates the Fluxion application icon,
and ad-hoc signs the result for local development.

The Finder launcher always uses this independent profile:

```text
~/Library/Application Support/Fluxion/Profiles/default
```

Normal Firefox profiles are not opened or modified.

## Verification

The browser build itself does not need Node.js. Running the JavaScript unit
tests through `check.sh` requires Node.js 20 or newer.

```sh
./scripts/check.sh
./scripts/smoke-gecko.sh
file ../.runtime/Fluxion.app/Contents/MacOS/Fluxion
codesign --verify --deep --strict ../.runtime/Fluxion.app
```

The `file` result should identify an `arm64` Mach-O executable on an M3 Mac.

## Troubleshooting

If Firefox is installed elsewhere:

```sh
FLUXION_FIREFOX_BIN="/path/to/Firefox.app/Contents/MacOS/firefox" ./bin/fluxion
```

If Fluxion opens with Firefox's horizontal tab strip and no left sidebar, pull
the newest source and force a clean application rebuild:

```sh
git pull origin main
cd fluxion
./scripts/build-macos.sh --clean
open ../.runtime/Fluxion.app
```

Do not open `/Applications/Firefox.app`; the generated application is
`Fluxion-Browser/.runtime/Fluxion.app`. You can rerun the sidebar health check
directly with:

```sh
./scripts/verify-macos-app.sh ../.runtime/Fluxion.app
```

Release builds also run a four-launch recovery check against one temporary
profile. It seeds and restores normal tabs, a pinned tab, a tab group, a split
view, and workspace membership, then proves a private tab is absent from the
restored session, Places history, and Browser Memory:

```sh
./scripts/verify-macos-session.sh ../.runtime/Fluxion.app
```

If the builder reports that Terminal is translated, quit Terminal, select it
in Finder, open **Get Info**, turn off **Open using Rosetta**, and try again.

If Apple blocks the locally signed development app, open **System Settings →
Privacy & Security** and approve Fluxion, then open it again. Stable public
releases will require Developer ID signing and notarization; the repository
build and current preview are ad-hoc-signed development applications.

To force a clean rebuild, remove only the generated application and run the
builder again:

```sh
rm -rf ../.runtime/Fluxion.app ../.runtime/.fluxion-macos-stamp
./scripts/build-macos.sh
```
