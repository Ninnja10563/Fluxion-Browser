# Fluxion 0.78 — Motion and interaction audit

## Changes

- Native macOS fullscreen menu-bar reveal owns the toolbar even when Cocoa
  does not deliver DOM pointer entry. Native hide callbacks respect the menu
  animation; shrinking animation frames do not re-arm upward pointer ownership.
- Sidebar mode changes settle the page column immediately instead of animating
  width/min-width/max-width and feeding page layout and toolbar alignment each
  frame. Floating-sidebar movement remains a 140ms transform/fade, with one
  easing curve and no animated box shadow. Settings and Library settle with
  their page column instead of trailing behind it.
- Sidebar departure uses the toolbar's 60ms grace period. Re-entry cancels it;
  persistent or already-hidden sidebars schedule no hide timer.
- Mode changes clear stale keyboard ownership. A superseded keyboard reveal
  cannot focus a row after a later pointer reveal; legitimate keyboard focus
  and open native menus continue to retain the sidebar.
- Interface motion off now suppresses the command-palette animation, and the
  OS reduced-motion preference suppresses folder disclosure transitions.
- Release identity checks now cover the updater's installed-version constant,
  as well as About and workflow defaults.

These changes follow the unslop-ui motion guidance: retain purposeful spatial
feedback, remove unnecessary paint/layout animation, and respect reduced motion.

## Audit and measurement scope

Reviewed sidebar visibility/focus ownership, toolbar/Cocoa ownership, sidebar
width/layout observers, workspace switching animation, palette motion, and
release identity. The full release suite additionally exercises session/crash
recovery and private isolation, deferred New Tab, folders, native menus,
containers, imports, bookmarks, shortcuts, split views, large tab sets,
downloads, updates, Memory and AI privacy, and packaged application identity.
This is not a claim of an exhaustive source audit or a bug-free browser.

All 72 CSS layout cases passed across LTR/RTL, light/dark, two sidebar modes,
three densities and three widths, including folder placement. In the 1100×760
CSS-only expanded-to-compact fixture, 0.77 produced 10 distinct page widths
across 16 sampled frames; 0.78 produced one across 15. This is a Chromium-based
CSS fixture, not a native Gecko or Speedometer benchmark.

The native frame gate now samples page geometry throughout repeated sidebar
hover/retraction and a mid-retraction reversal. It requires stable page bounds,
restored input ownership after reversal, and eventual hide without a stale
callback. Real macOS CGEvent menu-bar checks supplement Gecko widget-routed
sidebar checks; they are distinct input paths and are reported as such.

## Verification and release

All 1,376 regression tests and mandatory native gates passed in
[run 38541031873](https://github.com/Ninnja10563/Fluxion-Browser/actions/runs/38541031873)
on `083b3743902a8c244a9d3378c6c6c529bf7ec8fb`. The native frame report passed
26 checks and sampled 176 viewport-stable frames during sidebar hover/reversal.
The exact tested universal DMG is published as
[0.78.0-preview.1](https://github.com/Ninnja10563/Fluxion-Browser/releases/tag/v0.78.0-preview.1).
The [provenance record](../release/provenance/v0.78.0-preview.1.md) records
artifact authentication, publication and update-channel verification.

## Limits

No physical M3/trackpad, battery, whole-browser startup, memory-use or browsing
benchmark gain is claimed. Broader assistive-technology testing remains
outstanding. The universal preview is ad-hoc signed, not Apple-notarized.
