# Fluxion 0.69 — Focus mode and workspace appearance

Published as `v0.69.0-preview.1`. All 1,009 regression tests and every mandatory
native macOS gate passed. See the [candidate audit](validation/0.69-candidate.md)
and [release provenance](../release/provenance/v0.69.0-preview.1.md).

The expanded sidebar stays integrated with the frame. Focus mode now fully
hides the rounded surface instead of painting a three-pixel corner fragment.
Edge hover reveals a surface inset six pixels on the logical side, top and
bottom, with a pointer bridge across the inset. The native navigation toolbox
becomes a top-edge overlay without being reparented. Address focus, keyboard
commands and anchored native security panels keep it visible; ordinary pointer
exit hides it. Native fullscreen and customization retain Gecko ownership.
Reveal does not resize the webpage. Reduced motion remains respected.

New tab uses the ordinary row's width, height and corner radius at all three
densities. Closing a trailing row no longer retains an unnecessary stationary
gap: the short close compression moves New tab into place. A surviving row
below the closure still keeps the accidental-repeat-close safeguard. Native
beforeunload cancellation restores controls and layout.

Repeated gentle workspace swipes retain their rearmed state after momentum
decays. The activation threshold is unchanged, and continuing decay cannot
become a second switch. Native verification exercises four workspaces in both
directions, not only a reversible two-workspace pair. This does not establish
physical M3 gesture-phase detection; DOM wheel events do not expose that phase.

Workspace Appearance consolidates scheme, base and accent controls into one
panel with an Appearance overview and Colors page. The actual workspace scheme
is distinct from the palette being edited. Draft previews are local to the
owning window; Save commits, while Cancel/Escape/dismissal restore the saved
appearance. Native color pickers and validated hex fields share the
same controls. Plain opaque surfaces and meaningful hierarchy follow the
unslop-ui audit; no decorative gradients are introduced.

The background indexing scheduler no longer cancels and allocates a new timer
for every activity event. A regression exercises ten thousand events with one
pending timer while still enforcing the entire quiet period. This reduces
application overhead without speculative requests, network/security retuning,
or an unsupported claim that websites themselves now load faster.

Fresh profiles default to restoring the previous session and displaying the
bookmarks toolbar. Explicit existing choices remain authoritative. macOS
last-window closure/reopening follows that choice through a narrowly pinned
SessionStore/SessionSaver patch. Native tests cover repeated closure, actual
process relaunch, private-only activity, external requests and explicit startup
opt-outs. A redundant homepage load can no longer overwrite the selected
restored page. Lazy tabs remain lazy and native undo recovery is retained.

Shortcut recording explicitly focuses its clicked button on macOS. Previously,
the button could display Press shortcut while keys still reached a different
control. Recording now ends on section/tab dismissal as well as blur, and
tests exercise actual command dispatch, conflict rejection, persistence and
Reset. The native gate starts with an unfocused recording control and sends
real macOS keys after a widget-routed click; it does not pre-focus away the bug.
Native input also exposed Cocoa's dual Option/AltGraph flags, now accepted only
for legitimate macOS Command+Option chords. Protected and non-macOS combinations
retain their restrictions.

Application artwork is imported from the owner's supplied icon pack, with
byte-level provenance in `assets/app-icons/README.md`. Native packaging uses
the provided 1024px PNG; About and new-tab identity use matching supplied files.

Workspace account containers and one-click installation are separate pending
work, not features of this candidate. See [containers](workspace-containers.md)
and [update channel](update-channel.md) for the native isolation and signing
requirements. Manual update checking remains available.
