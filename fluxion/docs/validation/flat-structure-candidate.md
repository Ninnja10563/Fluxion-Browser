# Flat Flow structural reconciliation candidate

This work is isolated on `perf/flow-reconcile`; it is not part of the 0.59
Memory privacy release candidate and must not be merged without native checks.

## Scope

Ordinary same-workspace selection already retains Flow rows. This follow-up
extends retention to structural changes in flat workspaces: native tab opening,
closing and reordering. Rows are keyed by actual native tab objects. Pin-role
changes recreate only the affected row, while groups, splits and workspace
changes retain the existing complete-render fallback.

A bounded longest-increasing-subsequence plan retains already ordered DOM
nodes, avoiding moving every intervening sibling for a single native reorder.
The model still requires O(N) authoritative state/projection reads; ordering
planning is O(N log N). This is not a claim that every structural operation is
constant-time or that complex projections retain identity.

For an adjacent swap, either row can be the minimal DOM relocation. The
deterministic subsequence plan may keep the native moved tab stationary in
the DOM and relocate its equivalent neighbor. Both rows and their controls
retain identity and focus; a parent child-list observer can still see that
necessary relocation. The native gate separately verifies this case with
exactly one relocation and no row replacement or subtree rewriting.

Existing close-pointer holding and independent pinned/tree keyboard entries
remain in place. Connected focused close/audio controls are retained, with a
fallback focus repair for platforms without state-preserving DOM moves.

## Verification

The candidate includes shipped-runtime identity, order, role and focus tests,
plus a dedicated macOS gate with 1,000 native Gecko tabs. The native gate covers
background add/remove/reorder, pin/unpin, exact focused controls, unrelated
subtree writes, native order and group/split fallback behavior. Its operations
are native Gecko calls and chrome focus, not physical OS pointer input.

Native execution and review remain pending. Do not promote a diagnostic app
or infer release readiness from the Node boundary tests alone.

All 671 local regression tests pass, including the adjacent-swap tie case.
The native gate retains every row/control in that case, permits only either
equivalent adjacent row to relocate, and requires exactly one relocation with
the neighbor's exact close-button focus preserved.

## Passing native diagnostic

[34535943938](https://github.com/Ninnja10563/Fluxion-Browser/actions/runs/34535943938)
passed all 671 tests and every macOS diagnostic on
`46c4aec54eec9528bf83b63069573d8bf773c3c8`. The structure report passed all
seven operation/fallback checks, recorded zero unaffected-row subtree writes,
and measured exactly one adjacent-swap DOM relocation. Exact close/audio
focus, native ordering, pin roles, collapsed groups and stacked split state
were verified against actual Gecko tabs and privileged Flow DOM.

Native selection, Library, workspace editing, live cross-window tab transfer,
Memory privacy and clean/SIGKILL session recovery also passed. This is not
physical OS drag/high-refresh-rate hardware profiling. Artifact
`10175441307` (`Fluxion-structure-evidence`) holds the native report.

The initial pending-native status above describes the pre-diagnostic stage.
The branch is now natively checked, but remains outside 0.59: main-branch
integration, a new milestone version and full release staging are still
required before any public DMG can include this work.

## Subsequent packaging safety follow-up

Manual DMG packaging no longer defaults to the stale `0.6.0-preview.1` label.
It reads the supplied app's bundled product release as data, cross-checks both
bundle version fields and the Settings product version, and rejects any
explicit version mismatch before packaging tools or output changes. It does
not infer an older app's identity from the current source checkout.

All 677 local tests pass on this branch. Six full-shell packaging regressions
cover older-app defaults, explicit and stable releases, malformed or conflicting
metadata, missing arguments and preservation of existing output on rejection.
Their macOS packaging commands are explicitly simulated; this later change
has not yet passed an actual native DMG build. The diagnostic above tested the
earlier structural source, not this packaging follow-up. Neither change is in
the 0.59 release candidate.
