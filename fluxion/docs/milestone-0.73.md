# 0.73 — Careful tab cleanup

Status: candidate; not yet published or native-verified.

## Behavior

The native tab context menu offers counted duplicate cleanup for the current
workspace and window. A linear planner groups exact HTTP(S) URI strings by
workspace and numeric Gecko container identity. It does not normalize query
parameters, fragments, credentials or escapes, and never examines page text.

Selected, context-selected, multiselected, pinned, grouped, split, Peek,
loading and active-media/capture tabs are retained. A protected tab can serve
as a keeper; otherwise the first tab in native order is retained. Different
documents at the same URL can contain different unsaved state, so cleanup is
always explicit, with Cancel as the default review action.

The adapter checks tab/browser ownership and snapshots before consent and
again after the native modal loop. It rejects changed scope, ordering, URL,
container, ownership or protection state. Each target and keeper are checked
again before native removal. Gecko owns beforeunload and SessionStore; a
canceled page closure stops the remaining batch. No automatic cleanup,
telemetry, history storage or AI is involved.

Peek closure now preserves its source and active state when native closure is
canceled. Committed TabClose clears that state, while an in-flight guard
prevents nested selection events from prompting twice. Its handled-attempt
return contract is retained so ordinary close handling cannot retry it.

## Verification

Pure and runtime tests exercise exact identity, protected keepers, stale
consent, nested events, cancellation, cleanup and a 1,000-tab linear planner.
The full macOS gate remains required before a release is published, including
the new actual native-menu, confirmation, beforeunload and recovery fixture.
No physical M3 trackpad or website-speed benchmark result is claimed.

## Boundaries

Cleanup intentionally excludes groups and internal/local-file pages. Different
URLs that happen to display the same content are not duplicates. Account
containers remain Gecko containers, not automatic workspace-account mapping.
The separate asynchronous duplication of Peek markers needs its own restore
policy investigation; it is not claimed fixed here. Existing release limits
(ad-hoc signing, no Apple notarization) remain.
