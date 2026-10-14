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

All 1,338 regression tests and mandatory native macOS build, browser, recovery,
signing and updater gates passed in run 38517152442. Native frame checks include
the stationary heading and equal tab/New Tab bounds in all three densities.
Actual Mac captures were reviewed. Separately, 72 rendered sidebar CSS-fixture
cases passed; that fixture is not native Gecko. Release provenance records the
tested source, artifact checks and an earlier unsuccessful run.

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
