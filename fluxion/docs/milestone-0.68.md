# Fluxion 0.68 — workspace interaction details

Candidate: publication requires the full native macOS release workflow. All
949 local tests pass. The second candidate's native Settings persistence
assertion exposed a test race with asynchronous Gecko writes; the correction
is pushed, but GitHub HTTP 500 dispatch failures currently prevent its next
native staging run. Nothing from 0.68 has been published yet. See the
[candidate audit](validation/0.68-candidate.md).

The current workspace heading reveals an options button on hover or keyboard
focus. A quiet sage-neutral highlight connects the title and action; no badge,
extra border or decorative container is added. The button occupies its space
even while transparent, so the icon and text never jump on hover. Open-menu
state retains the highlight while the pointer travels into the native menu.

The menu operates on actual saved workspaces: rename, change icon/accent,
switch via checked workspace entries, move earlier/later, create and delete.
Deletion retains the existing confirmation and cross-window tab migration;
the last workspace cannot be deleted. Unsupported profile/sharing actions from
the reference are not presented. Escape restores the opener when it owned focus;
stale workspace state invalidates the menu before an action can execute.

Edit Workspace Theme opens a compact native panel with Light/Dark selection,
a native color picker and a validated hex field. Save commits one complete
palette; Cancel leaves it untouched, and Reset removes only that workspace's
override. Existing global appearance remains the fallback. Optional theme data
is validated on load and copied across persistence boundaries. The existing
readable-color derivation styles browser chrome, never webpages. Workspace
symbols are centered between equal-width controls in the bottom dock; overflow
remains scrollable and Compact retains a vertical dock.

Workspace swipe recognition now waits through small ambiguous diagonal starts
and recognizes deliberate threshold-crossing reversals without an idle delay.
The DOM wheel API exposes no macOS gesture phase: a bounded renewed-impulse
heuristic distinguishes input after a decayed tail from ordinary inertia.
Same-direction momentum remains suppressed. These are conservative heuristics,
not a claim of direct hardware gesture-phase detection.

Workspace changes receive a 150ms, 4px sidebar-only transition after the pending
render. Native page selection is immediate. A superseding switch cancels the
old animation; system reduced motion and the browser motion setting cancel and
suppress it. Neither screenshots nor routed Gecko wheel events establish
physical M3 trackpad reliability. Address-popup captures intermittently omit
the main-window backdrop at different widths; the 0.67 symptom remains under
a hardware audit rather than being claimed fixed.

Fluxion's own General and Privacy sections add six everyday browser controls:
smooth scrolling, hardware acceleration (restart required), download-location
prompting, password saving, popup blocking and HTTPS-only mode. Opening Settings
does not write defaults. These are explicit user choices, not unmeasured engine
"speed tweaks". Existing startup, search, tabs, workspaces, Memory, AI,
permissions, shortcuts and update controls remain in the custom screen.
