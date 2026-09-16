# Fluxion 0.72 — A full-height sidebar and prompt Focus navigation

Release candidate: full packaged macOS validation and independent archive
verification are required before publication.

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
departure grace. Normal-window Focus uses the same 120 ms slide. These are
configured timing bounds, not precise measurements extracted from the video.

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
