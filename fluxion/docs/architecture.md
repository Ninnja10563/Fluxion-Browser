# Architecture

## Decision

Fluxion uses a **Firefox ESR runtime overlay with privileged browser chrome**.
The launcher starts a dedicated Firefox profile and asks Firefox's supported
enterprise autoconfiguration hook to load Fluxion's chrome script into browser
windows. Web content remains in normal Gecko content processes. Fluxion never
embeds a webview and does not expose privileged APIs to page JavaScript.

This was selected after inspecting the initial repository (which contained no
browser source) and the build host (ARM64 Debian with Firefox ESR 140 available
from its security repository). A full mozilla-central checkout and build is a
valid long-term distribution path, but it is a poor first milestone: it adds a
very large source/build dependency before proving Fluxion's interaction model.
The overlay produces a real usable Gecko browser immediately and its chrome
code can later be applied as a small patch stack to an official Firefox source
build.

This is not an extension-only architecture. The browser-chrome layer has the
privilege needed to manage native Firefox tabs and windows, while ordinary web
pages retain Firefox's process, principal, and sandbox boundaries.

## Reused Firefox/Gecko components

- Gecko layout, JavaScript, CSS, WebAssembly, media, networking, cache, and
  cookie implementations;
- Firefox multi-process isolation, principals, permission prompts, certificate
  UI, authentication flows, and site security infrastructure;
- native navigation toolbar and address/search field;
- `gBrowser`, SessionStore, Places history/bookmarks, downloads, private
  browsing, crash recovery, PDF.js, picture-in-picture, DevTools, and
  WebExtensions;
- native dialogs, context menus, full-screen handling, accessibility, and
  platform appearance integration.

Retaining these systems is deliberate. Reimplementing them would reduce
security and compatibility while producing no product differentiation.

## Custom components

```text
bin/fluxion
  -> isolated Firefox profile
  -> runtime/fluxion.cfg (privileged startup boundary)
     -> chrome/core/*.js (typed-by-contract state and URL helpers)
     -> chrome/fluxion-chrome.js
        -> Flow sidebar / workspaces / tab interactions
        -> Firefox gBrowser + SessionStore
     -> newtab/ (unprivileged local document)
```

`fluxion.cfg` observes completed browser-window startup and loads code only
into windows whose chrome document is `browser.xhtml`. The Flow sidebar is
inserted beside Firefox's browser deck. It renders state from native tabs; it
does not create a parallel rendering or navigation stack.

Workspace membership is stored as a persisted SessionStore tab attribute.
The current workspace and sidebar state use Firefox preferences. This keeps
crash recovery atomic with the actual tab session and avoids a second database
whose state could drift from Firefox.

The new-tab page is a local, unprivileged file. It can submit navigation but
cannot call chrome methods.

## Security boundaries

- Page JavaScript executes only in Gecko content processes and cannot reach
  `window.gBrowser`, preferences, the filesystem, or Fluxion chrome.
- The autoconfig entry point validates that it is loading a known local file
  beneath `FLUXION_ROOT` and only targets browser chrome windows.
- Fluxion uses native Firefox navigation APIs, URL fix-up, permission panels,
  download handling, and certificate state rather than shadow implementations.
- Private windows retain Firefox's private-browsing origin attributes. No
  semantic index exists in this milestone, so no private content is captured.
- No credentials, telemetry keys, AI endpoints, or remote scripts are bundled.

The autoconfig hook is powerful by design. Installation artifacts must be
owned and writable only by the installing user or administrator. Release
packages will place chrome under a signed/read-only application bundle.

## Upstream update strategy

Fluxion targets Firefox ESR first. Each supported ESR is represented by a
small compatibility adapter around unstable browser-chrome APIs; web-platform
APIs are not forked. For an ESR update:

1. run unit checks and the headless Gecko startup smoke test;
2. run browser-chrome integration tests against the new ESR;
3. inspect changes to `browser.xhtml`, `gBrowser`, and SessionStore;
4. update only the compatibility adapter and selectors when necessary;
5. perform manual navigation, permission, download, private-window, session,
   and accessibility passes on macOS, Linux, and Windows.

The intended release build is an automated Firefox source build that applies
the same `chrome/` code as a shallow patch stack and supplies Fluxion branding.
Keeping product code outside Gecko makes rebasing much smaller than a deep
Firefox fork. Security updates can therefore follow the ESR cadence quickly.

## Platform plan

Development validation currently runs on Linux ARM64 because that is the
available host. The chrome layer uses platform-neutral Firefox UI APIs and
system fonts. macOS is the release priority: packaging will use an application
bundle, native menu registration, Command-key labels, correct traffic-light
spacing, and notarization. Windows and Linux use the same product layer with
platform packaging and title-bar adapters.

## Future local search boundary

Semantic history will be a separate low-priority service, not code executed in
page context. The planned pipeline is extraction through a narrow message
boundary, redaction/exclusion policy, SQLite metadata and full-text ranking,
and optional local embeddings. Private contexts are rejected before enqueue.
The AI provider and embedding provider will remain separate optional
interfaces. See the roadmap for acceptance criteria.
