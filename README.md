# Fluxion Browser

Fluxion is a desktop browser built on Mozilla Firefox/Gecko. The active
implementation lives in [`fluxion/`](fluxion/README.md).

It is a real browser runtime overlay—not Electron, Chromium, CEF, WebView2, or
a browser-themed web page. Gecko continues to render and isolate web content;
Fluxion supplies its own browser chrome, vertical Flow sidebar, workspace
model, new-tab surface, launcher, and product defaults.

## Install on macOS

Download the universal DMG from
[GitHub Releases](https://github.com/Ninnja10563/Fluxion-Browser/releases), open
it, and drag **Fluxion.app** into **Applications**. It supports Apple Silicon
(including M3) and Intel. The prebuilt app includes Gecko: you do **not** need
Firefox installed to use it.

These are development previews, ad-hoc signed rather than Apple-notarized.
See [macOS installation and troubleshooting](fluxion/docs/macos.md) for details.

## Build from source

```sh
cd fluxion
./bin/fluxion
```

For local macOS development, this command finds `/Applications/Firefox.app`
and builds a separate `Fluxion.app`. The source-build route requires Firefox
and Apple Command Line Tools; the prebuilt DMG does not.

See the project README for prerequisites and development commands.
