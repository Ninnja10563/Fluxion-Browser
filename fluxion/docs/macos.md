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

The browser build requires Python 3 for policy merging, but does not need Node.js
when using an already installed Firefox. JavaScript tests and the locked-runtime
downloader require Node.js 20 or newer. The packaged app needs neither runtime.

```sh
./scripts/check.sh
./scripts/smoke-gecko.sh
file ../.runtime/Fluxion.app/Contents/MacOS/Fluxion
codesign --verify --deep --strict ../.runtime/Fluxion.app
```

The `file` result should identify an `arm64` Mach-O executable on an M3 Mac.

Additional packaged-app regression checks use isolated temporary profiles:

```sh
./scripts/verify-macos-shortcuts.sh ../.runtime/Fluxion.app
./scripts/verify-macos-file-picker.sh ../.runtime/Fluxion.app
```

The shortcut check exercises rendered Settings controls and cross-window
preferences using DOM keyboard events; it is not an OS keyboard-input test.
The file-picker check uses LaunchServices, System Events and the actual macOS
open panel, then verifies the selected file's bytes through a loopback upload.
UI automation requires a graphical login and the applicable macOS automation
and accessibility permissions. Missing permission or ambiguous dialog ownership
fails the check; no replacement picker or file-list injection is used.

macOS renders its open panel in an AppKit helper process. The test builds an
ownership resolver and fixed-fixture Unicode keyboard driver with Xcode's
`clang` into its temporary directory. Attribution and focus-inspection modes
are read-only; the input mode accepts only the existing same-user verification
file under the dedicated temporary fixture directory. It posts paired native
UTF-16 key events through the normal session input route after requiring the
exact browser to be foreground, avoiding keyboard-layout conversion of the
Unicode filename, clipboard changes, and file-list injection. Events posted
directly to Gecko's PID do not reach AppKit's remote picker on the CI host.
It dynamically resolves a private macOS responsibility-PID function and accepts
only the exact system helper attributed to this browser process, never a shared
Terminal/CI ancestor. An unavailable function fails closed. This test helper
is not bundled with Fluxion and is not needed for ordinary browsing or uploads.

## Troubleshooting

Fluxion accepts links and local files through macOS **Open With**. To target a
particular application bundle without changing your default browser:

```sh
open -a /Applications/Fluxion.app 'https://example.com'
open -a /Applications/Fluxion.app '/path/to/Local document.html'
```

When Fluxion is already running, macOS delivers these to the running application.
LaunchServices does not reliably select a profile if several Fluxion profiles
are open. For deterministic profile routing, use the native executable with
`FLUXION_PROFILE` set to the same absolute profile directory used at launch.
Keep profile directories separate from Firefox.

The release gate tests cold and warm external links, Unicode/spaced local file
names with actual JavaScript rendering, and same-profile CLI forwarding:

```sh
./scripts/verify-macos-external-open.sh ../.runtime/Fluxion.app
```

Local bundle versions follow `package.json` (the numeric base version required
by macOS). `FLUXION_APP_VERSION` remains available for explicit build overrides;
changes to the package version invalidate the cached application bundle.

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
profile. It seeds and restores normal tabs, each workspace's active page, a
pinned tab, a tab group, a split view, and workspace membership, then proves a
private tab is absent from the restored session, Places history, and Browser
Memory:

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
