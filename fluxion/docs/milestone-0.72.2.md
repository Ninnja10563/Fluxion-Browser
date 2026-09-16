# Fluxion 0.72.2 — Extensions branding and native menu evidence

Published as [0.72.2-preview.1](https://github.com/Ninnja10563/Fluxion-Browser/releases/tag/v0.72.2-preview.1).
All 1,191 tests and mandatory native macOS gates passed on source
`594b0c42a607091cb6c369ea35f81e85f828a080`, run
[35157356045](https://github.com/Ninnja10563/Fluxion-Browser/actions/runs/35157356045).
See [release provenance](../release/provenance/v0.72.2-preview.1.md).

The Extensions empty-state illustration was an independent native SVG missing
from the branding manifest. It now reuses the owner's existing transparent F,
with an exact pinned input hash and no change to extension commands, permission
handling, explanatory text or discovery behavior. The unslop-ui pass retains
the native layout and a restrained, background-free product mark.

The reported macOS menu wording requires checking the actual OS menu, not just
resolving Fluent strings. A new isolated native gate reads and screenshots the
application menu before the fixture performs localization work, without invoking
About, Default, Hide or Quit. It also records browser and hidden-window labels.
The Extensions popup is opened through the real widget and its packaged image,
visible native text and available discovery action are checked and captured.

The existing pinned menu localization already uses Fluxion. Stale installation
or upgrade caching is possible but not established; no speculative profile-cache
deletion or blanket Firefox-string replacement is performed. Mozilla legal
attribution, protocol identifiers and security wording remain intact.

All 0.72.1 Focus-direction, edge-to-edge and final-tab protections are retained.
This is not a website-speed or physical M3 performance claim.

The first candidate's actual OS capture already showed About/Hide/Quit Fluxion.
Its new test incorrectly required the default-browser action to be visible:
Gecko 155 ships `browser.macAppMenu.setAsDefaultShown=false`, and when enabled
also hides the action if it is already the default. The verifier now observes
that preference/native status, always checks the browser and hidden-window
default-action label, and requires its OS entry when native policy makes it
visible. Visible Firefox labels still fail. No OS default or product policy is
changed. The initial candidate was not released.

The accepted native run captured About Fluxion, Hide Fluxion and Quit Fluxion
in the actual OS menu. The default action was legitimately hidden by the stock
preference; its browser and hidden-window labels were both correct. Native
visible-default-action behavior is covered conditionally and by behavioral
tests, not claimed as an OS capture on this runner. No application-menu string
change was needed in current source. An older installed version or existing
profile discrepancy remains unconfirmed because the user's version is unknown.

The actual widget-routed Extensions popup painted the exact supplied mark at
100×100 intrinsic size, with native heading, explanation and enabled Discover
extensions action intact. Both captures were inspected. Broader security,
session restoration, privacy, accessibility and real updater gates passed.
This remains an ad-hoc-signed, non-notarized macOS 12+ preview.
