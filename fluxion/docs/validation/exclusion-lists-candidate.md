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

All 726 local regression tests and syntax checks pass. Native results and
source commits will be added after the feature branch is built and tested.
No DMG or release claim is made.
