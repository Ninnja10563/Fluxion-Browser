This is a downloadable Fluxion Gecko Foundation Preview for macOS.

It includes real Gecko webpage rendering, the Fluxion **Flow** vertical tab
sidebar, workspaces, navigation, Firefox's mature browser services, a separate
Fluxion profile, and a native universal launcher with Apple Silicon support.

This is an early development preview, not a stable release. Fluxion is still a
Firefox-derived runtime overlay, and some Firefox surfaces and branding remain
while the independent product interface is built out.

Version 0.2 introduces Fluxion's first independent browser-chrome milestone:

- a restrained navigation skin that retains Gecko's security-aware URL field;
- a flatter, denser Flow sidebar with a 44px compact rail;
- icon-only persistent pinned tabs and quieter workspace indicators;
- `Cmd/Ctrl+K` search across commands, tabs, workspaces, history, and bookmarks;
- `Cmd/Ctrl+Shift+A` high-volume open-tab search;
- a blank new-tab surface with immediate address-field focus;
- removal of inherited Firefox application icon and permission-dialog branding.

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
