# 0.74 — Address-bar drafts and cleaner chrome

Status: published as `v0.74.0-preview.1`; see release provenance for public asset checks.

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

## Verification

All 1,256 tests and mandatory native macOS gates passed in run `35327731964`,
source `c2e67888a57d68f65d25faeb5b0c55e3eaab7d30`. Dedicated gates exercise
actual address-bar input, URL/POST loading, source restoration, container and
private boundaries, and a same-path branding upgrade followed by a warm launch.
Measured frame checks and native screenshots confirm heading alignment and
outline-free collapsed geometry. Actual Settings captures show gold-to-pink
checkbox changes, with cancellation restoring gold and webpages unchanged.
The [provenance](../release/provenance/v0.74.0-preview.1.md) records exact
artifacts, rejected candidates, publication checks and limitations.

## Boundaries

This is an interaction and upgrade-correctness milestone, not a claim of improved
website benchmark scores. macOS builds remain ad-hoc signed, not Apple-notarized.
Physical M3 hardware and trackpad testing are not available in this environment.
