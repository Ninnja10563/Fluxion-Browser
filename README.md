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

To open links from other apps in Fluxion, choose **Settings → General →
Make Fluxion Default** and confirm with macOS. The status updates when the
system confirms the change; Fluxion does not repeatedly prompt at startup.

These are development previews, ad-hoc signed rather than Apple-notarized.
See [macOS installation and troubleshooting](fluxion/docs/macos.md) for details.

The forthcoming **0.70.1** adds optional automatic update checks and an explicit
Update and restart action through Sparkle. Native installation verification is
still pending; this is not a published-release claim. Users of 0.70 and earlier
must install the first updater-enabled DMG manually. The initial integration
requires macOS 12 or later and Fluxion's default profile. See the
[0.70.1 milestone](fluxion/docs/milestone-0.70.1.md) for scope and limitations.

## Build from source

```sh
cd fluxion
./bin/fluxion
```

For local macOS development, this command finds `/Applications/Firefox.app`
and builds a separate `Fluxion.app`. The source-build route requires Firefox
and Apple Command Line Tools; the prebuilt DMG does not.

See the project README for prerequisites and development commands.
