# Fluxion 0.72 — A full-height sidebar and prompt Focus navigation

All 1,171 tests and every mandatory packaged macOS gate passed in
[run 35092798626](https://github.com/Ninnja10563/Fluxion-Browser/actions/runs/35092798626),
source `f34e3d89a83528df96ba989f93be449ac4691800`. Publication details and archive
verification are recorded in the [provenance](../release/provenance/v0.72.0-preview.1.md).

## Expanded sidebar

The expanded Flow surface uses the top of the window instead of reserving the
entire navigation and bookmarks band. Visible macOS window buttons keep their
own safe row. The heading retains the same small internal inset; the workspace
dock remains at the bottom. Narrow windows fall back below navigation when the
sidebar and native controls cannot safely fit alongside one another. Focus
keeps its separate six-pixel floating surface; compact mode is unchanged.

This retains native toolbar and window-button ownership rather than reparenting
privileged chrome. The unslop-ui pass changes alignment, not typography, icons,
colours or decoration. Native hit testing and screenshots are required alongside
geometry assertions, including fullscreen and narrow-window transitions.

## Shorter toolbar retraction

The supplied five-second recording shows repeated fullscreen navigation
reveal/retraction. Inspection of pinned Gecko source identified its 800 ms
`margin-top` transition, in addition to Fluxion's 180 ms departure grace.
Explicit Focus now scopes that native transition to 120 ms and uses 60 ms of
departure grace. Normal-window Focus uses the same 120 ms slide. Gecko retains
its immediate native collapse when the pointer enters webpage content; the
120 ms override applies when Gecko requests an animated collapse. These are
configured timings, not precise measurements extracted from the video.

Pointer reentry cancels retraction. Actual address-field focus, native popups,
customization, DOM/video fullscreen, policy locks and expanded/compact toolbar
persistence retain their protections. System reduced motion and Fluxion's
motion-off setting suppress both native and normal-window animation. No native
source patch or global fullscreen preference change is introduced by this slice.

## Copy tab links

The tab context menu gains one ordinary command for copying a web tab's link or
the links of several selected tabs without activating them. Copying is explicit,
HTTP(S)-only, and removes URL authority credentials. Query parameters and
fragments remain meaningful parts of the copied link. Stale, closing, moved or
changed targets cannot silently replace the selected links. Nothing is written
to browser history or a service; private-window copying is an explicit clipboard
action, not automatic persistence.

The 0.71 tab-management optimizations remain. No website-speed, battery-life or
physical M3 performance improvement is claimed; larger structural updates and
broader roadmap features still need work.

## Native verification and candidate corrections

Actual macOS geometry/hit tests passed for expanded, narrow, RTL and fullscreen
layouts. Visible caption controls reserved a 36 px surface top and a 42 px
heading top on the runner; the floating Focus surface remains inset six pixels.
Light/dark screenshots were reviewed after remote-page paint readiness checks.

The native animated top-edge-to-sidebar cycle settled in 241.74 ms on the
hosted runner, including event dispatch and polling. Its computed transition
was 120 ms; this is not a claim of a 120 ms total interaction. Both browser
motion-off and the system-media override computed zero-duration transitions.
Native Cmd-L, security-popup retention and expanded/compact persistence passed.

System Events opened the real context menu and invoked single/multiple link
copying. Native pasteboard bytes matched exactly; previous clipboard formats
were held only in memory and restored while fixture-owned. Stale-target
rejection is behavioral unit-tested, not claimed as a physical native test.

Two candidates were rejected before the successful build. The first exposed a
test attempting to inspect an animation after reduced-motion/immediate native
collapse; the corrected test performs a genuine animated cycle first. The
second exposed a likely launcher-ownership startup race and a fifth fixture
request from a different browsing context. The clipboard driver now waits for
exact profile-owned Gecko startup. Gecko thumbnail capture is isolated only
inside the structure test, with the exact prior preference restored. Background
thumbnail capture is an evidence-backed explanation of the extra request, not
a retrospectively proven context identity. Strict four-load/no-reload checks
remain and passed for all seven live-document structural operations.

This remains a universal macOS 12+ ad-hoc-signed preview, not Apple-notarized.
The unslop-ui pass focused on alignment and purposeful motion, without adding
decorative surfaces or replacing mature Gecko browser services.
