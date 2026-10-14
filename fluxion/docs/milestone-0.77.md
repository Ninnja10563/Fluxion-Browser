# 0.77 — Workspace folders, imports and installer presentation

## Delivered scope

- Workspace heading menus can create genuinely empty folders above the divider.
  Names, native-group links and collapsed state are stored with the window's
  SessionStore data. Moving a tab retains its live browser and account container;
  closing its last tab leaves the empty folder. Folders and ordinary tabs share
  one accessible tree, with native group order retained within the folder area.
- Settings → Import data supports bookmark HTML and password CSV/TSV exports
  from Zen/Firefox, Chrome's native migration dialog, and up to 100 pasted web-tab
  links loaded lazily. This is not complete profile, extension, workspace-layout
  or signed-in-session cloning. Password exports are readable sensitive files.
- Fullscreen Focus navigation overlays the page without resizing it as the bar
  reveals/retracts. Its native hit band follows actual toolbar height; hidden
  macOS caption buttons do not reserve a blank navigation gutter.
- About Fluxion can copy local module-initialization timings. No browsing history
  or profile paths are copied, and nothing is transmitted automatically. These
  timings do not measure total startup or website loading.
- The universal DMG has a neutral, Retina-ready install window, system typography,
  the actual Fluxion and Applications icons, and a single drag-direction arrow.
  The unslop-ui review favored clear instructions and spacing over decoration.
  Installation remains ordinary drag-to-Applications; the layout adds no app
  runtime dependency and does not modify the signed application.

## Verification

The final source passed all 1,367 regression tests and the complete mandatory
macOS release workflow. Native folder verification creates the folder through
the shipped naming prompt, navigates the actual Cocoa submenu using System
Events keys, checks trusted command receipts, and verifies unchanged tab,
browser, browsing context and container identity. It checks actual SessionStore
serialization and last-tab closure. Captures cover empty/populated folders;
review caught and corrected the SVG default-black-fill defect before release.

Native frame checks cover page geometry during fullscreen toolbar transitions,
expanded/compact visibility, hidden-sidebar edges, sidebar insets, stationary
tab closure and New Tab sizing. Separate native gates cover imports, shortcuts,
session recovery, private isolation, last-window relaunch and signed replacement.

Packaging verifies the real app signature, Finder icon positions and window
geometry, then compresses and reopens the DMG read-only. The reopened install
window matched all 2,651 sampled artwork foreground pixels exactly. Finder's
macOS 14 background-picture AppleScript getter errors despite displaying the
picture, so rendered-pixel comparison verifies persistence instead. It does not
replace signature verification. The actual install-window capture was reviewed.

See [release provenance](../release/provenance/v0.77.0-preview.1.md) for exact
source, run, archive digests, publication and update-channel verification.

## Limits

The reported long loading delay remains unisolated. No Speedometer, whole-app
startup, memory, battery or browsing-speed improvement is claimed for 0.77.
The 72-case local sidebar fixture is CSS-only, not native Gecko verification.
Physical M3/trackpad testing and broader assistive-technology coverage remain
outstanding. This is an ad-hoc-signed development preview, not Apple-notarized;
the full original roadmap and a separately reviewed Gecko upgrade remain open.
