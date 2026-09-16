# Fluxion 0.72.1 — Focus direction, flush pages and final-tab focus

Candidate; native packaged validation is required before release.

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
