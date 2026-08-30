# Product interface principles

Fluxion's interface is content-first and structurally quiet. Its identity comes
from how tabs, workspaces, and navigation behave—not from decorative effects.

## Reference points

Fluxion studies established browser and platform patterns without reproducing
another product's layout:

- [Zen Compact Mode](https://docs.zen-browser.app/user-manual/compact-mode):
  chrome can leave the user's way and remain quickly recoverable.
- [Mozilla's vertical-tab design notes](https://blog.mozilla.org/en/firefox/vertical-tabs-and-the-firefox-community/):
  long tab titles must stay scannable, while close and audio actions remain
  dependable in compact modes.
- [Apple search-field guidance](https://developer.apple.com/design/human-interface-guidelines/search-fields):
  macOS apps benefit from one clearly scoped, consistently placed search entry.
- [Safari pinned sites and Tab Groups](https://support.apple.com/guide/safari/pin-frequently-visited-websites-ibrw0495694f/mac):
  persistent sites should remain compact and survive relaunches.

SigmaOS is deliberately excluded as a reference.

## Fluxion rules

- The webpage is the visual centre. It is not placed inside a decorative card.
- Browser controls use native Gecko behavior and a restrained macOS-oriented
  skin. Security state, permission anchors, autofill, and URL completion stay
  on Firefox's audited implementations.
- The navigation toolbar prioritises Back, Forward, Reload, and the native
  address/security field. Secondary product routes live under one trailing
  geometric Fluxion menu and remain duplicated in the macOS menu bar; the
  inherited Firefox application hamburger is not part of the visible product.
- The trailing menu uses shallow native Library, Page, and Tools groups. Page
  commands inherit Gecko's own enabled state and shortcuts; lower-frequency
  actions do not become permanent toolbar icons merely because PanelUI is gone.
- Flow is 232px expanded, a 44px icon rail when compact, and a 3px reveal edge
  in Focus mode. Focus reveals the complete 232px surface over the live page;
  it never changes the content rectangle merely to inspect or select a tab.
- The Focus rail is itself keyboard reachable. Hidden Flow controls are inert,
  Enter/Space/Right Arrow reveal them, Escape returns focus to the rail, and
  leaving the surface dismisses it only after a short crossing tolerance.
- Ordinary tabs are flat 32px rows. A selected tab uses one quiet surface and a
  2px workspace-coloured rule; it does not become a floating card.
- Pinned tabs are icon-only and spatially stable. Their titles remain available
  through native tooltips.
- Page activity is expressed with small geometric marks beside the title or on
  the favicon corner in compact Flow. Loading may move; capture, picture-in-
  picture, attention, sleep, crash, and audio state remain still and legible in
  grayscale. Camera, microphone, screen sharing, and crash are the only states
  permitted to use warning colour.
- A dragged tab treats the narrow top and bottom edges of a row as insertion
  lines and the broad centre as a split target. Split feedback temporarily
  replaces the row content with a literal spatial action such as “Split left”
  or “Stack below”; it does not rely on colour alone.
- Workspace colour appears only in a one-pixel selection indicator.
- The new-tab page is blank by default. The address field is the primary entry
  point, not a duplicated hero search box.
- The command palette is a compact transient list. It uses no dimmed backdrop,
  blur, gradient, oversized radius, or decorative animation.
- Native page actions in the palette appear only when Gecko can execute them;
  a quiet interface must not trade visual simplicity for dead controls.
- A generated web or address destination is always the last matching result;
  exact browser actions must remain the fastest keyboard path.
- When a strong result exists, weak subsequence matches are omitted instead of
  filling the palette merely because their letters happen to align.
- Recently Closed rows are plain native menu or palette entries, not a card
  carousel. They disappear when Gecko has no recoverable state.
- Motion stays between 100ms and 160ms and disappears under reduced motion.
- Gradients, glass effects, neon, ornamental borders, and marketing-style empty
  space are prohibited in browser chrome.

Any future visual addition should identify the state or action it communicates.
If it cannot, it should not be added.
