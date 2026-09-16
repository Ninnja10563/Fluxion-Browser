# Fluxion 0.72.1 — Focus direction, flush pages and final-tab focus

Published as [0.72.1-preview.1](https://github.com/Ninnja10563/Fluxion-Browser/releases/tag/v0.72.1-preview.1).
All 1,186 tests and mandatory native macOS gates passed on source
`6ab2f0ca2e7358fd24568cc7ea96409a6e7cb87d`, run
[35155069119](https://github.com/Ninnja10563/Fluxion-Browser/actions/runs/35155069119).
See [release provenance](../release/provenance/v0.72.1-preview.1.md).

## Directional navigation

A trusted pointer exit above the toolbar (or sideways within its vertical
band) retains the reveal. Returning below the entire toolbar, including the
bookmarks row, schedules the existing 60 ms departure grace. The boundary
accounts for an in-progress reveal transform and macOS toolbar translation.
Ordinary page pointer motion performs no additional layout reads. Native
fullscreen's reveal edge participates in the same rule. Mode changes and
window deactivation clear stale pointer ownership; address focus, popup
ownership, customization and DOM fullscreen keep their existing protections.

## Edge-to-edge hidden-sidebar content

Only Focus removes the four-pixel content margin and eight-pixel page radius.
The three-pixel sidebar activation strip remains as a transparent overlay,
not a reserved page column. Settings and Library share the zero-inset layout.
Revealing the floating sidebar does not resize the page; expanded and compact
states restore their prior geometry. The unslop-ui pass removes unnecessary
framing rather than adding visual effects.

## Final tab in a workspace

When no live rows remain in the workspace outside the closing set, pointer
closure schedules native removal without the 120 ms compression wait. Native
beforeunload can still cancel the close and restore the row. Other workspaces
are not closed or moved. Gecko still owns replacement-tab creation and session
restoration; a narrowly pinned integration avoids its implicit address-field
selection after final-tab replacement in Focus, without blanket asynchronous
blur or overriding deliberate keyboard focus.

This does not claim a website-speed gain or completion of the original roadmap.

## Verification

The local suite includes behavioral coverage for trusted upward and
downward exits, the in-progress reveal transform, mode changes, native reveal
edges, explicit address focus, cancellation of final-tab closure, and zero
layout reservation for the hidden sidebar in both text directions.

The first full native candidate passed the new OS-pointer, edge-to-edge and
final-workspace-tab checks, but failed the existing animation fixture. Making
the page flush also moved its old pointer target into Gecko's immediate
content-collapse region. The fixture now uses Gecko's actual near-toolbar
buffer to exercise the separate animated path, without setting animation
attributes or weakening duration assertions. The deeper-page immediate-collapse
checks remain. That candidate was not released; a complete rerun is required.

An unchanged-source candidate subsequently timed out loading the fullscreen
HTTPS fixture before entering fullscreen. Its failed tab state was not captured,
so a network cause is plausible but not established. The following run passed
the complete frame gate, including the genuine animated path (point y=80,
native immediate-collapse boundary y=122), but caught a separate branding
fixture Escape/readiness failure. A trusted Escape arrived; the unresolved
condition was native suggestions remaining or reopening. The fixture had
awaited keyboard focus but not the asynchronous native query/view readiness.
Neither failed candidate was published. HTTPS load-state diagnostics now retain
URI, document URI, title, loading, selection and workspace on success or timeout.
The branding fixture now passively waits for the current native query to settle
and the view to open, following query replacement and legitimate already-open
view reuse. Tests reject stale/rejected queries and a view that never opens.
It records bounded lifecycle evidence without forcing a query, proxy, URI or
popup state; the single dismissal Escape and final security checks remain.

The accepted run passed native macOS CGEvent movement up to the menu bar and
back below the toolbar, native Cmd-W with four other workspace tabs preserved,
and native fullscreen widget-routed directional checks. Actual screenshots
confirm the flush content frame. The real animated cycle retained its native
animation attribute and computed 120 ms transition; both reduced-motion
controls produced zero duration. Its 222.29 ms measured fixture cycle includes
dispatch and polling, not a claimed 120 ms end-to-end response time.

The branding fixture recorded a completed new query, open view before the
first trusted Escape, and a valid native HTTPS proxy afterward. All broader
session restoration, updater, privacy, browsing and accessibility gates passed.
Physical M3/trackpad assessment and broader hardware profiling remain outside
this fix. The preview is ad-hoc signed, not Apple-notarized.
