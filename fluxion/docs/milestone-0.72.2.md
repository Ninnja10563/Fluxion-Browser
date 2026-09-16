# Fluxion 0.72.2 — Extensions branding and native menu evidence

Candidate; packaged native verification is required before publication.

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
