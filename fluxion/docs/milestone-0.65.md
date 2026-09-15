# 0.65 — tab closure and a quieter browser frame

Published as [0.65.0-preview.1](https://github.com/Ninnja10563/Fluxion-Browser/releases/tag/v0.65.0-preview.1).
All 846 tests and every mandatory native macOS release gate passed. See
[release provenance](../release/provenance/v0.65.0-preview.1.md).

## Interaction corrections

Gecko 155.0.1 marks a tab closing and emits `TabClose` before detaching it.
Flow now excludes attached closing tabs from its workspace projection, rather
than drawing a stale row during native Command-W closure. A close outside the
stationary pointer guard ends that guard immediately. Closing the held row
still preserves the pointer safety space until the pointer leaves.

Keyboard activation of a close control never creates a pointer guard at
synthetic coordinates. A canceled `beforeunload` restores the surviving row's
visibility and interaction, including partial multi-tab cancellation, without
releasing a newer or unrelated pointer operation.

Native macOS testing also exposed chrome-to-content focus transfer emitting a
window blur while that same app window remains active. The pointer guard now
waits for native focus bookkeeping and releases only on actual deactivation;
an old blur callback cannot clear a newer operation's guard.

## Design direction

The user requested the [unslop-ui skill](https://github.com/yuwen-lu/unslop-ui).
Its restraint and hierarchy audit informed removal of repeated rail branding,
the redundant Flow caption and full-width standalone Settings action bars.
The user's mostly grayscale requirement takes precedence over the skill's
suggested color ratio. No runtime dependency on the skill was added.

The supplied reference was only 125 × 84 pixels. It supports a compact neutral
frame and a clear page/control distinction, not claims of exact typography or
pixel matching. A full-resolution reference was requested for further passes.

The workspace band now includes the sidebar mode control; it remains visible
in Compact, uses a sidebar glyph and names its next action. Compact workspace
navigation uses Up/Down, matching its vertical layout; expanded uses Left/Right.
Keyboard workspace selection scrolls only as far as needed to expose the item.
Missing favicons use a small page glyph rather than decorative outlined dots.
A four-pixel solid frame is shared by the native tabbox, Settings
and Library. No native browser container is clipped or transformed for this
effect. Native security, address completion, file dialogs and page rendering
remain Gecko-owned.

## Verification

The extracted production renderer/close tests cover attached closing tabs,
coalesced closures, stationary and releasing pointer holds, keyboard clicks,
canceled/partially canceled native closes and stale operation ownership.

A new isolated macOS gate sends real System Events Command-W and
Command-Shift-T, checks native tabs against Flow rows without pointer movement,
then repeats Command-W after a Gecko-routed pointer close. It checks expanded,
Compact and Focus frame geometry, non-reflowing Focus reveal and matching
Settings geometry, and captures a loaded HTTPS webpage in light/dark themes.
It does not claim physical mouse, fullscreen, or screen-reader verification.
