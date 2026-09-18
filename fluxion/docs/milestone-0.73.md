# 0.73 — Careful tab cleanup

Status: published as [0.73.0-preview.1](https://github.com/Ninnja10563/Fluxion-Browser/releases/tag/v0.73.0-preview.1).
All 1,222 tests and every mandatory native macOS gate passed at source
`50f93f9e1397df4d50b142f8f7b40d8537a33a8b`. See the
[release provenance](../release/provenance/v0.73.0-preview.1.md).

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

Pure and runtime tests exercise exact identity, all protected states (including
paused screen/camera capture), stale consent, nested events, cancellation,
private-window execution, cleanup and a 1,000-tab linear planner. The Peek
regression executes the shipped module and generic close dispatcher; it is not
represented as a native unsaved-Peek test.

The new native gate uses actual macOS keyboard menu input and a real Cancel-
default confirmation. It verifies selected/context/pinned tabs, URL query and
fragment differences, hidden workspaces and distinct account containers. Native
Cmd–Shift–T restores the closed tab's workspace and nonzero container. Navigation
during confirmation aborts the entire stale plan.

A real loopback page receives trusted input only after Gecko's visible layer
switch completes. A per-document nonce, native page title and server events
prove which duplicate armed beforeunload; cancellation of the actual leave-page
dialog retains it. Group/split/media protections are covered by runtime tests,
not claimed as native cleanup cases. Actual menu and confirmation captures were
reviewed with unslop-ui: native hierarchy, no decorative icons or new panels.

The full workflow also passed browsing, signed replacement/relaunch, session
recovery, last-window persistence, privacy, accessibility and large-session
gates. No physical M3 trackpad or website-speed benchmark result is claimed.

## Boundaries

Cleanup intentionally excludes groups and internal/local-file pages. Different
URLs that happen to display the same content are not duplicates. Account
containers remain Gecko containers, not automatic workspace-account mapping.
The separate asynchronous duplication of Peek markers needs its own restore
policy investigation; it is not claimed fixed here. Existing release limits
(ad-hoc signing, no Apple notarization) remain.
