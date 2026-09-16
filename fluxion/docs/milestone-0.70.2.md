# Fluxion 0.70.2 — Focus navigation and sidebar placement

Candidate; native macOS verification and publication are pending.

The hidden sidebar must retract navigation over webpages **and** Fluxion's
Settings, Library and floating sidebar. Gecko's fullscreen mouse tracker uses
the page's tabpanels rectangle, so Fluxion also schedules native retraction on
actual toolbox pointer departure. Genuine navigation input and security-popup
ownership still retain the toolbar; expanded/compact sidebars stay visible.

A narrow hash-locked Gecko policy makes explicit per-window Focus mode work
even when an older profile has fullscreen autohide disabled. It does not rewrite
that preference. DOM/video fullscreen and kiosk handling remain native. Inputs
in Settings are not navigation inputs and must not keep the toolbar open.

The floating sidebar is inset six pixels from the **window viewport**, not the
page area below navigation. Its heading keeps its existing six-pixel internal
top spacing; revealing navigation no longer creates an empty shelf above it.
The unslop-ui review uses existing spacing, icons and short transitions without
adding decorative effects.

Verification must exercise real fullscreen hover/retraction over Settings and
the sidebar, both default and saved-disabled autohide preferences, keyboard and
popup retention, viewport anchoring, and persistent expanded/compact navigation.
Screenshots alone do not identify the installed version or preference state;
these are reproduced code paths, not proof of the exact user's profile cause.

This is not the 0.71 performance milestone. No browsing-speed claim is made.
