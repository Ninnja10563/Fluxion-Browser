# Fluxion 0.67 — coherent browser chrome

Published as 0.67.0-preview.1. All 899 tests and every mandatory native macOS
gate passed; see [release provenance](../release/provenance/v0.67.0-preview.1.md)
for tested source, public assets and verification limitations.

The reference-led layout aligns navigation and bookmarks with the page column,
while reserving space for native window controls and toolbar overflow. A measured
controller follows sidebar width and fullscreen changes without replacing
Gecko's URL field, identity controls or autocomplete. The address field uses a
quiet fill, one focus outline and balanced vertical insets. Page corners are
clipped locally, not around privileged permission panels; fullscreen removes
the rounding.

The unslop-ui audit removed the selected-tab accent stripe, redundant tab count,
dock separator and oversized toolbar brand glyph. Rows share one title/icon
alignment, New tab follows the last row, and the current workspace has a quiet
heading. Bottom symbols remain actions, not decorative badges. User-customized
colors and reduced motion are retained.

Fresh profiles start with one Focus workspace. Existing workspace definitions,
names, order and tab/session ownership are preserved. Horizontal two-finger
input over the visible sidebar switches to the adjacent workspace; vertical
input continues to scroll tabs. Momentum cannot skip multiple workspaces, the
ends do not wrap, and hidden-edge or webpage input cannot invoke the workspace
route. Physical trackpad behavior still requires a hardware audit.

Firefox's built-in VPN enrollment is not a Fluxion service. Its native feature
gate is disabled before service initialization, including inherited enabled
profiles; the exact current widget and panel are excluded. Ordinary proxy
settings, extensions, site identity, permissions and engine attribution remain.
See [product service policy](product-service-policy.md).

Two new isolated macOS gates test real toolbar bounds/address suggestion
geometry and trusted Gecko-routed wheel events. Existing native keyboard close,
large-session, frame, color, privacy and recovery gates remain mandatory. See
[candidate validation](validation/0.67-candidate.md).

Known visual-verification limit: the CI capture of the first 1280px address
popup omits the main-window backdrop, despite passing native input and layout
checks. The 800px popup and normal-window captures are complete. A capture or
compositing anomaly has not been distinguished from a visible first-open
problem; the first Command-L interaction needs a physical-M3 check. See the
candidate audit rather than treating this as confirmed rendering success.
