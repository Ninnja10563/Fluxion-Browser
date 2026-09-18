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

**[0.73.0-preview.1](https://github.com/Ninnja10563/Fluxion-Browser/releases/tag/v0.73.0-preview.1)**
adds **Close Duplicate Tabs…** to the native tab menu. Cleanup stays within the
current workspace and account container, keeps protected tabs, defaults to
Cancel, and retains native unsaved-page prompts and undo. Canceled Peek
closure now retains its source tab. All 1,222 tests and mandatory macOS gates
passed, including actual menu commands, nonzero-container undo and a real
unsaved-page cancellation. See the [milestone](fluxion/docs/milestone-0.73.md)
and [provenance](fluxion/release/provenance/v0.73.0-preview.1.md).

**[0.72.2-preview.1](https://github.com/Ninnja10563/Fluxion-Browser/releases/tag/v0.72.2-preview.1)**
replaces the Extensions fox illustration with the transparent Fluxion F and
verifies actual macOS application-menu branding. All 1,191 tests and mandatory
native macOS gates passed. It retains 0.72.1's directional Focus navigation,
edge-to-edge hidden-sidebar pages and final-workspace-tab focus fix. See the
[milestone](fluxion/docs/milestone-0.72.2.md) and
[provenance](fluxion/release/provenance/v0.72.2-preview.1.md).
No website benchmark or physical M3 performance improvement is claimed.

Since 0.70.1, optional automatic update checks offer an explicit Update and restart action
through Sparkle. Native verification covers signed replacement, canceled
quit/retry and same-profile restoration in an isolated fixture. Users of 0.70 and earlier
must install the first updater-enabled DMG manually. The initial integration
requires macOS 12 or later and Fluxion's default profile. See the
[0.70.1 milestone](fluxion/docs/milestone-0.70.1.md) and
[release provenance](fluxion/release/provenance/v0.70.1-preview.1.md) for scope
and limitations. Session restoration follows your startup choice; updating does
not override a fresh-start preference.

## Build from source

```sh
cd fluxion
./bin/fluxion
```

For local macOS development, this command finds `/Applications/Firefox.app`
and builds a separate `Fluxion.app`. The source-build route requires Firefox
and Apple Command Line Tools; the prebuilt DMG does not.

See the project README for prerequisites and development commands.
