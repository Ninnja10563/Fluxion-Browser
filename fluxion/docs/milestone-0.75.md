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

Local regression checks and the native macOS release gates must pass before
publishing. Native coverage includes real keyboard input, URL and POST searches,
empty normal/private workspaces, session attributes, explicit blank tabs and
the existing session, privacy, update and browser-integration checks. Physical M3
Speedometer validation remains outstanding. Builds are ad-hoc signed, not Apple
notarized.
