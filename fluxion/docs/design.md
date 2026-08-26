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
- Flow is 232px expanded, a 44px icon rail when compact, and a 3px reveal edge
  in focus mode.
- Ordinary tabs are flat 32px rows. A selected tab uses one quiet surface and a
  2px workspace-coloured rule; it does not become a floating card.
- Pinned tabs are icon-only and spatially stable. Their titles remain available
  through native tooltips.
- Workspace colour appears only in a one-pixel selection indicator.
- The new-tab page is blank by default. The address field is the primary entry
  point, not a duplicated hero search box.
- The command palette is a compact transient list. It uses no dimmed backdrop,
  blur, gradient, oversized radius, or decorative animation.
- Motion stays between 100ms and 160ms and disappears under reduced motion.
- Gradients, glass effects, neon, ornamental borders, and marketing-style empty
  space are prohibited in browser chrome.

Any future visual addition should identify the state or action it communicates.
If it cannot, it should not be added.
