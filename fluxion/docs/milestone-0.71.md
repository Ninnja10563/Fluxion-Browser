# Fluxion 0.71 — Less repeated work with many tabs

All 1,149 regression tests and every required packaged macOS gate passed in
[run 35084369845](https://github.com/Ninnja10563/Fluxion-Browser/actions/runs/35084369845)
at source `eb6e48c1580276f1522953bf6b97eb2e348f1eef`. The
[0.71.0-preview.1 release](https://github.com/Ninnja10563/Fluxion-Browser/releases/tag/v0.71.0-preview.1)
promotes that exact verified archive. See
[provenance](../release/provenance/v0.71.0-preview.1.md).

This performance slice removes three sources of repeated browser-chrome work:

- Sleeping scans use Gecko's direct browser-to-tab ownership lookup instead of
  copying the complete tab list for each candidate. Ownership and safety checks
  run again after asynchronous session flushing. Private windows do not schedule
  a sleeping timer, since their tabs are deliberately excluded from sleeping.
- Workspace selection uses a stable linear maximum for ordinary timestamps and
  remembered-state markers. No marker is cached across interactions. Malformed
  inputs retain the previous sorting behavior, covered by differential tests.
- The command palette reuses organisation analysis only while its exact input
  snapshot remains unchanged. Page, title, pin, group, split, membership and
  workspace changes invalidate it; confirming an action revalidates live state.

These changes preserve Gecko's protections and existing features. They do not
alter network limits, JavaScript JIT settings, sandboxing, caches, tracking
protection or process isolation. The unslop-ui review keeps existing visible
controls, spacing and motion intact: no decorative UI is added for optimization.

## Reproduce the scoped comparisons

Run from the repository root with Node.js and Git history available:

```sh
node fluxion/scripts/benchmark-tab-sleeping.cjs
node fluxion/scripts/benchmark-workspace-selection.cjs
node fluxion/scripts/benchmark-palette-organisation.cjs
```

Each compares the same corpus against frozen 0.70.2 source
`eca27212472017d3b174dc4d158a7709b0ed5e0a`, validates behavior and reports its
measurement scope. Corpus objects and measured code share a JavaScript realm;
cross-realm array-spread overhead must not be mistaken for application work.

For 1,000 recent, ineligible tabs, the sleeping sweep reads the complete tab list
once instead of 1,001 times and performs 1,000 direct ownership lookups. The
seeded 1,000-tab workspace corpus reduces remembered-state reads from 17,074 to
991 eligible candidates. For 30 unchanged grouping queries in the same palette
opening, the 1,000-tab corpus performs no additional grouping analyses or URL
parses, instead of 30 analyses and 30,000 parses. Changed input still triggers
fresh analysis. These are deterministic work counts, not website benchmark
scores, memory savings or battery-life claims.

## Packaged native evidence

The expanded mandatory Flow gate used 1,000 genuine HTTPS lazy tabs created by
Gecko, without loading their documents. All remained pending and the selected
page did not change. It verified bounded results, input focus, and live grouping,
title, workspace, close and new-tab invalidation through the shipped palette.

On the hosted macOS runner, the nine unchanged all-mode queries took
8.73–22.41 ms synchronous dispatch and 12.25–36.86 ms to the next frame.
Cold opening took 33.34 ms dispatch and 55.09 ms to the next frame. The complete
16-sample sequence, including structural invalidation, had a 33.10 ms median and
213.36 ms maximum input-to-frame time. The 997-tab grouping change was the
slowest sample; a subsequent title change took 125.80 ms to the next frame.
These are current-build observations, not a matched native before/after result
or a high-refresh-rate guarantee. Structural updates need further profiling.

The original tab-search gate passed 20 samples with a 21.44 ms median and
124.76 ms p95 input-to-frame time. The 200-tab background-event gate retained
every row/control with zero structural removals through 24 batches. Real native
sleep/discard and pin-during-flush protection passed. Workspace, crash/session,
seven-stage last-window and signed updater/relaunch gates also remained required
and passed; none were bypassed for performance.

The user's reported score of 32.6 has no identified benchmark/version or matched
hardware baseline. Neither this milestone nor Linux CPU-only fixtures establish
an M3 website-speed improvement or a "fastest browser" claim. Physical M3 and
larger real-world profile measurements remain necessary.
