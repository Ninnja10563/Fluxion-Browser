# Running Fluxion on an Apple Silicon Mac

Fluxion supports M1, M2, M3, and M4 Macs through Mozilla's native ARM64 Gecko
runtime. It does not use Rosetta, Chromium, Electron, or a system web view.

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
resources, compiles an ARM64 launcher, generates the Fluxion application icon,
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

If the builder reports that Terminal is translated, quit Terminal, select it
in Finder, open **Get Info**, turn off **Open using Rosetta**, and try again.

If Apple blocks the locally signed development app, open **System Settings →
Privacy & Security** and approve Fluxion, then open it again. Public releases
will require Developer ID signing and notarization; the repository build is an
ad-hoc-signed development application.

To force a clean rebuild, remove only the generated application and run the
builder again:

```sh
rm -rf ../.runtime/Fluxion.app ../.runtime/.fluxion-macos-stamp
./scripts/build-macos.sh
```
