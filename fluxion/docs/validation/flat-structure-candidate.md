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
