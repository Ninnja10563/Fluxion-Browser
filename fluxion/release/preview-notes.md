This is a downloadable Fluxion Gecko Foundation Preview for macOS.

It includes real Gecko webpage rendering, the Fluxion **Flow** vertical tab
sidebar, workspaces, navigation, Firefox's mature browser services, a separate
Fluxion profile, and a native universal launcher with Apple Silicon support.

This is an early development preview, not a stable release. Fluxion is still a
Firefox-derived runtime overlay, and some secondary Gecko preference surfaces
retain upstream terminology while the independent product interface is built
out.

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
