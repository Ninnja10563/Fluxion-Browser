# Named exclusion lists — candidate

This separate feature branch is not part of the published 0.59 browser or the
0.60 sidebar release candidate. It groups user-entered domains in compact
Settings disclosures with independent enable/save/cancel/remove controls.
Lists are local preferences, not external website categorization.

The policy service validates a complete versioned value before one preference
write, migrates existing direct exclusions, rejects stale cross-window edits,
and prevents persistent changes from private windows. Enabled lists and direct
domains form the effective policy; disabled lists still count toward storage
limits. Matching includes subdomains and normalized DNS root dots.

Regression coverage exercises limits, migrations, malformed preferences,
cross-window revisions, draft retention, private controls, queued edits,
in-flight indexing/search changes, native and enriched cleanup, and explicit
recovery. Startup tests run the shipped autoconfiguration to verify invalid
policy cannot create a new native manager or schedule an unsolicited removal.
These VM checks alone do not establish native database retention on restart.

The packaged privacy gate additionally seeds actual native vectors and
enriched SQLite evidence for a listed host and subdomain, enables the list from
a second window, checks deletion/filtering and retention of unrelated evidence
and Places visits, rejects stale/private edits, and checks disabling/removing
the list does not resurrect deleted evidence. The two-launch disabled-Memory
gate independently reads persisted list policy and raw SQLite rows on restart.
Companion-window cleanup and persisted success markers are fail-closed.

The separate corruption gate seeds a previously initialized native database,
relaunches with malformed policy, deliberately calls Gecko's own manager
factory outside Fluxion's guard, and checks exact retained vector/mapping
bytes through read-only SQLite. It then requires an explicit purge to work.
This is a storage/lifecycle test with synthetic vectors, not model inference.
The Settings gate also exercises populated list editors, accessible names and
DOM focus at 320/600px; this is not a physical keyboard-input audit.

All 726 local regression tests and syntax checks pass.

[Diagnostic 34541667093](https://github.com/Ninnja10563/Fluxion-Browser/actions/runs/34541667093)
passed every native gate on `4343df7dec2458eb3f638809c1ebff105a3f1334`.
That includes list/private selective cleanup, disabled-startup list pruning,
real semantic retrieval, clean/crash recovery, and corrupted-policy restart
retention followed by explicit purge. Populated Settings editors exposed all
six accessible control names with retained DOM focus at both narrow sizes;
the 200-control corpus did not overflow horizontally. The screenshot covers
Workspaces, not the new list editor; list geometry is recorded in the report.

Post-diagnostic review tightened the list checkbox to a 15px start-aligned
control, with a native size assertion, and cast native mapping hashes to text
to avoid numeric precision loss in the retention check. Those later changes
need native verification in the final integrated release candidate.

Diagnostics do not check About discovery or produce a distributable DMG.
No release claim is made for this feature branch.
