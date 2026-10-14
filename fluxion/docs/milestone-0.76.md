# Fluxion 0.76 — Sidebar refinement and resource efficiency

## Scope

- Keep the workspace heading outside the tab scroller, with a native options
  menu accessible from the title or symbol.
- Align tab, folder and New Tab geometry, retain compact density, and show a
  non-shifting keyboard shortcut hint with reduced-motion support.
- Reduce asynchronous sleeping-tab scans and search ranking allocations; defer
  the Memory embedding import until needed.
- Losslessly compress branding artwork while preserving archive preload
  membership and untouched resource compression methods.
- Recreate missing profile directories without overwriting inaccessible paths,
  unrelated profiles or user data.

## Validation

Before release preparation, all 1,338 local regression tests and 72 rendered
sidebar CSS-fixture cases passed. The fixture is not native Gecko. Native
macOS build, browser, recovery, signing and updater gates must pass before
publication; final run and artifact details belong in release provenance.

Local Linux ARM64 / Node 24.19 component comparisons with 0.75 show lower
sleeping-scan and search-ranking CPU time. The stored-resource archive fixture
is 23.51% smaller, with identical decoded contents. These are not measurements
of DMG size, process RAM, battery consumption, native startup or Speedometer.
The README records exact component numbers and reproduction commands.

## Boundaries

No security or process-isolation settings are weakened. The existing pinned
Gecko engine and signing trust checks are unchanged. Physical M3/trackpad and
matched whole-browser performance measurements remain outstanding. The
original full roadmap is not complete. Builds remain ad-hoc signed rather
than Apple-notarized.
