This is a downloadable Fluxion Gecko Foundation Preview for macOS.

It includes real Gecko webpage rendering, the Fluxion **Flow** vertical tab
sidebar, workspaces, navigation, Firefox's mature browser services, a separate
Fluxion profile, and a native universal launcher with Apple Silicon support.

This is an early development preview, not a stable release. Fluxion retains
Gecko's browser services and security boundaries while its independent product
interface is built out incrementally.

Version 0.8 adds real Gecko-native tab sleeping for large sessions:

- choose 5, 15, 30, or 60 minutes—or never—from live Fluxion Settings;
- flush current SessionStore state, release the content process through
  Gecko's native discard path, and restore the page when selected;
- never force a discard, allowing Gecko to protect unsaved forms and active
  page dialogs through its `beforeunload` checks;
- exclude selected, pinned, audio/PiP, shared, split-view, busy, private, and
  already sleeping tabs;
- show a quiet crescent state in Flow and provide a concise manual sleep action
  for eligible background tabs.

The macOS release gate now proves that a real background Gecko browser was
discarded before packaging the app.

Version 0.7 replaces the visible Firefox preferences page with live Fluxion
Settings:

- a restrained, compact preferences layout that remains beside the Flow tab
  sidebar instead of presenting an admin dashboard;
- startup, session restoration, homepage, external-link, and default-search
  controls backed by Gecko preferences and search services;
- immediate Flow sidebar mode and tab-density controls plus an independent
  animation switch that still respects macOS Reduce Motion;
- real tab warning and foreground-selection controls;
- Browser Memory opt-in, domain exclusions, and semantic-data deletion;
- confirmed actions to clear Gecko history, cookies/cache, or saved site
  permissions;
- an accurate keyboard reference for Fluxion and retained browser shortcuts.

The macOS release gate now opens the packaged settings surface and refuses to
publish unless the privileged controls are visible and connected.

Version 0.6 introduces the first usable Browser Memory milestone:

- opt in from the command palette; ordinary browsing remains AI-independent;
- search history by exact text and, on supported Macs, local semantic meaning;
- combine keyword evidence, vector similarity, recency, visit frequency, and
  active-workspace relevance without letting weak semantics beat exact terms;
- keep history and embeddings on-device with Gecko's local embedding runtime;
- reject Browser Memory access from private windows;
- automatically filter obvious auth, mail, account, billing, and payment URLs;
- exclude the current domain and its subdomains without deleting normal history;
- clear all semantic vectors and disable the feature from a visible control;
- fall back to exact local history search when the model is unavailable.

The macOS gate opens the packaged Browser Memory service and visually inspects
its dedicated search mode before a DMG can be published.

Version 0.5 adds a real Gecko-native split view to the Flow interaction model:

- place any two ordinary tabs side by side from a concise tab menu;
- choose the second page with fuzzy tab search from the command palette;
- open a blank page directly beside the current page;
- resize the two live Gecko panels with a directly manipulated divider;
- swap sides or separate the pair without losing either tab;
- treat paired tabs as one connected item when moving between workspaces;
- restore the split through Gecko SessionStore after restart or recovery;
- keep security state, dialogs, page processes, and navigation owned by Gecko.

The panel focus, divider, and inactive-site footer are restyled into Fluxion's
restrained visual system. The macOS release gate now refuses a build unless a
native split is live alongside Flow and a native tab group.

Version 0.4 integrates Gecko-native tab groups directly into Flow:

- compact group headings with collapse and expand state;
- group names and restrained colour indicators;
- drag tabs into groups or use the concise native context menu;
- reorder groups and move a whole group between workspaces;
- remove individual tabs from a group or ungroup without closing anything;
- include group names in high-volume tab search;
- retain Gecko SessionStore ownership of group membership and crash recovery.

The macOS release gate now creates a real native group and refuses the build
unless Fluxion renders it successfully.

Version 0.3 made Fluxion workspaces fully persistent and user-manageable:

- create and name workspaces directly from the Flow strip;
- rename and reorder workspaces through concise native context menus;
- choose one of five geometric symbols and five restrained accents;
- drag tabs directly onto workspace destinations;
- delete workspaces without losing tabs—open pages move to an adjacent space;
- search for the `New workspace` action from the command palette.

It also includes the version 0.2 independent browser-chrome foundation:

- a restrained navigation skin that retains Gecko's security-aware URL field;
- a flatter, denser Flow sidebar with a 44px compact rail;
- icon-only persistent pinned tabs and quieter workspace indicators;
- `Cmd/Ctrl+K` search across commands, tabs, workspaces, history, and bookmarks;
- `Cmd/Ctrl+Shift+A` high-volume open-tab search;
- a blank new-tab surface with immediate address-field focus;
- native macOS traffic-light controls and a real HTTPS rendering release gate;
- removal of inherited Firefox startup icon, onboarding, and visible app
  branding.

## Install

1. Download the `.dmg` file and open it.
2. Drag `Fluxion.app` to the Applications link.
3. Open Fluxion from Applications.

The preview is ad-hoc signed but not Apple-notarized. If macOS blocks the first
launch, right-click Fluxion and choose **Open**, or approve it under **System
Settings → Privacy & Security**. The attached `.sha256` file can be used to
verify the download.

Private browsing, downloads, permissions, PDF viewing, developer tools, media,
and WebExtensions continue to use Firefox/Gecko's existing implementations.
Platform passkeys are unavailable in this ad-hoc-signed preview because that
macOS entitlement requires an Apple provisioning profile.
