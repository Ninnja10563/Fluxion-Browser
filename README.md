# Fluxion Browser

Fluxion is a desktop browser built on Mozilla Firefox/Gecko. The active
implementation lives in [`fluxion/`](fluxion/README.md).

It is a real browser runtime overlay—not Electron, Chromium, CEF, WebView2, or
a browser-themed web page. Gecko continues to render and isolate web content;
Fluxion supplies its own browser chrome, vertical Flow sidebar, workspace
model, new-tab surface, launcher, and product defaults.

```sh
cd fluxion
./bin/fluxion
```

On an Apple Silicon Mac, Fluxion automatically finds `/Applications/Firefox.app`
and builds a native local `Fluxion.app`. See the project README for the one-time
Apple Command Line Tools prerequisite.

Downloadable macOS previews are published under
[GitHub Releases](https://github.com/Ninnja10563/Fluxion-Browser/releases).

See the project README for prerequisites and development commands.
