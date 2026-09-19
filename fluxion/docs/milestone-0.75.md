# Fluxion 0.75 — Empty workspaces and less background work

## Interaction

Closing the last tab leaves the window and its workspace available, without a
replacement tab row. New Tab / Command-T opens an address-bar draft. Typing does
not allocate a tab; submitting a URL or search does. Escape leaves the workspace
empty. Other workspaces and private-window isolation remain intact.

Gecko still requires a backing browser. Fluxion marks only its own automatic
replacement with a persisted tab attribute, excludes it from tab lists and
closed-tab history, and promotes it on navigation. Explicit user-created blank
tabs are ordinary tabs. Native beforeunload, tab cleanup, containers, search POST
data and SessionStore remain responsible for their existing behavior.
The marker is added to Gecko's hash-pinned native `TabAttributes` allowlist;
Gecko 155 no longer exposes the old runtime `persistTabAttribute` API.

## Performance work

- Normal startup no longer loads 32 native verification scripts. Those scripts
  still load for their exact opt-in test modes. Compared with 0.74, ordinary
  direct script loads decrease from 105 to 74, including the new empty-workspace
  controller. This is avoided startup work, not a measured launch-time gain.
- When Browser Memory is disabled (and in private windows), indexing activity,
  progress, memory-pressure and battery hooks remain detached. Policy, privacy
  deletion and cleanup observers remain active. Enabling Memory reattaches the
  hooks; disabling it cancels queued work and invalidates stale battery results.
- The Library ignores subframe navigation and does not repeatedly mutate an
  already-hidden interface during ordinary browsing. Visible Library navigation,
  cancellation of pending queries and bookmark destinations are preserved.

Regression tests execute the actual controllers. They cover 40,000 off-state
activity events, 1,000 subframe events, 1,000 hidden Library top-level events,
enable/disable races, exact test-loader modes and empty-workspace lifecycle.

## Benchmark boundary

The reported M3 Speedometer result is **34.4 ± 2.4**. Its Speedometer version and
power conditions have not yet been confirmed. No higher M3 score is claimed.
These changes remove browser-chrome work; they do not prove faster JavaScript
execution, a proportional Speedometer increase, or that Fluxion is the fastest
browser. Security, process isolation and upstream engine defaults are retained.

The pinned Mozilla macOS runtime already uses optimized PGO/LTO builds and native
Apple Silicon code. Moving to Gecko 156 requires a separate review of pinned
source patches, branding resources and native integration, not changing a version
string in this performance patch.

For a meaningful comparison, use the same Speedometer version on the same M3,
plugged in with Low Power Mode off; close unrelated applications/tabs, disable
extensions in matching test profiles, keep the benchmark focused, allow cooling
between runs, and alternate at least three runs of each Fluxion version. Record
each score, uncertainty, version, profile and power state. Also test the normal
profile separately, since extensions and browser settings can change the result.
See [Speedometer's official instructions](https://browserbench.org/Speedometer3.1/instructions.html).

## Verification status

All 1,325 regression tests and mandatory native macOS release gates passed in
run `35475460284`, source `5f7f3e52ab136991ccc2e8e0b5d04647fc868cc8`.
Native coverage includes real keyboard input, URL and POST searches,
empty normal/private workspaces, session attributes, explicit blank tabs and
the existing session, privacy, update and browser-integration checks. Physical M3
Speedometer validation remains outstanding. Builds are ad-hoc signed, not Apple
notarized. See [release provenance](../release/provenance/v0.75.0-preview.1.md)
for artifact and publication verification.

The first candidate, `cef2094`, was rejected by native run `35474375673`:
the empty surface worked, but the marker was absent from native session state.
The run was canceled and nothing published. This exposed the removed runtime
persistence API; the native allowlist fix keeps the original assertion intact.

Candidate `4e4f85f`, run `35474613462`, passed the native marker check but was
rejected at the repeated-Cmd-W assertion and canceled without publication.
Gecko completes closed-tab history asynchronously after detaching the tab. The
test now waits for the exact browser's native final-flush notification and real
closed-page record before comparing undo history. The product also guards the
native Close Tab command entry point, not just DOM keyboard events.

Candidate `0d679db`, run `35474872318`, passed the dedicated native empty-state
gate (including four reviewed screenshots) but exposed an obsolete last-window
fixture: it tried to close a newly created, intentionally empty workspace and
expected a replacement. That fixture now loads a real page before testing its
closure. Empty-workspace Close Tab remains a no-op; production behavior is not
changed to satisfy the old fixture.
