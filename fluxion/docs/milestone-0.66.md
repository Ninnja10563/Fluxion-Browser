# 0.66 — a predictable sidebar and personal colors

Candidate milestone; native macOS validation and publication are pending.

## Sidebar interaction

The sidebar button now toggles between Expanded and Collapsed. Collapsed
leaves an edge that reveals the sidebar on hover without moving the webpage;
Expand keeps it open. Compact is a separate explicit Settings choice. The old
three-state cycle made a second click hide the sidebar when the user expected
it to expand.

Pointer-selected rows no longer keep the hover surface open indefinitely.
Keyboard-owned focus and open native context menus keep their controls
available; collapse moves focus out before marking the surface inert. A stale
animation callback cannot focus a control after its surface has closed.

New tab follows the last tab inside the same scrolling region. An icon-only
workspace dock stays at the bottom, with accessible workspace names and
tooltips. Compact has a bounded, independently scrolling workspace list so
many workspaces cannot push its expand control out of view. Workspace symbols
now use five recognizable, consistently drawn [Lucide symbols](workspace-symbols.md)
without changing existing saved workspace IDs.

## Appearance

Settings → Appearance offers separate light and dark base/accent colors,
native color pickers, validated hexadecimal fields and Reset colors. Changes
are stored locally in one atomic preference and reflected in every window.
Derived text and surface colors are checked for readable contrast. The colors
apply to privileged browser chrome, not webpages or site-security states.

The requested unslop-ui skill informed the flat bottom dock, compact controls,
consistent inline symbols and restrained color hierarchy. No gradients,
decorative icon containers or new rendering-engine dependencies were added.

## Validation scope

New regression tests exercise the shipped hover/toggle handlers, focus and
menu ownership, invalid color drafts, cross-window color updates, reset,
symbol compatibility and 1,398 palette combinations. The macOS frame gate
uses Gecko-routed pointer events for repeated edge entry/leave and real
native-tab creation; native keyboard closure coverage remains mandatory.
These checks do not claim physical M3 pointer/trackpad or screen-reader audits.
