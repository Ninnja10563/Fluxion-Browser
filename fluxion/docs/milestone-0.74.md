# 0.74 — Address-bar drafts and cleaner chrome

Status: candidate under verification. Not yet published.

## Scope

- New Tab opens the native address bar without creating an empty tab first.
  Submitting a destination creates a tab; canceling leaves the current page.
- The expanded workspace heading sits beside the bookmarks row, directly
  below navigation, with caption controls and narrow-window fallback retained.
- The collapsed sidebar's invisible hover edge no longer paints a full-height
  focus outline. Keyboard users retain focus feedback on the revealed surface.
- Workspace accent colors reach checked controls in Fluxion Settings through
  Gecko's own accent-aware renderer. Forced colors, websites and macOS dialogs
  retain their own policy; the picker label now states its scope.
- A packaged chrome fingerprint asks Gecko to invalidate its startup caches
  once after a changed build. Warm launches keep caching; browsing data is not
  cleared. This addresses the same-Gecko-build upgrade path separately from
  fresh-install branding checks.

## Verification plan

Local regression tests and mandatory native macOS gates must pass before
publication. Dedicated gates exercise native address-bar input and a same-path
branding upgrade; the existing frame gate checks measured heading alignment
and outline-free collapsed geometry. Release provenance will record exact
source, artifacts and results, including limitations or unreproduced reports.

## Boundaries

This is an interaction and upgrade-correctness milestone, not a claim of improved
website benchmark scores. macOS builds remain ad-hoc signed, not Apple-notarized.
Physical M3 hardware and trackpad testing are not available in this environment.
