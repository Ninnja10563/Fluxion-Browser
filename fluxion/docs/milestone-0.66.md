# 0.66 — a predictable sidebar and personal colors

Published as [0.66.0-preview.1](https://github.com/Ninnja10563/Fluxion-Browser/releases/tag/v0.66.0-preview.1).
All 871 tests and every mandatory macOS gate passed. The exact staged DMG,
public download and update feed were verified; see
[release provenance](../release/provenance/v0.66.0-preview.1.md).

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

The native gate exposed an obsolete address-background selector: Gecko 155
uses a class instead of the older ID. Styling now reaches the real address
surface. Visual review also caught the Settings background shorthand erasing
native select arrows; explicit Gecko disclosure artwork restores their
affordance without replacing native popup behavior.

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
