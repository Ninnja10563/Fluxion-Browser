# Fluxion

Fluxion is a calm, vertical-first desktop browser powered by Gecko. It keeps
Firefox's mature web platform, security model, downloads, permissions, PDF
viewer, developer tools, private browsing, session recovery, and WebExtension
support, then replaces the primary tab interaction with Fluxion's compact
**Flow** sidebar.

## Current milestone

Phase 1 is runnable and includes:

- arbitrary website rendering through Firefox ESR/Gecko;
- URL/search navigation, back, forward, reload, stop, and security identity;
- compact vertical tabs with favicons, titles, audio state, close controls,
  reordering, pinning, duplication, and native tab session restoration;
- three-state sidebar (expanded, compact, focus rail);
- workspace switching and moving tabs between workspaces;
- private windows and all mature Firefox browser services;
- a restrained custom new-tab page and Fluxion product identity.

This is intentionally an incremental browser fork. Later phases are tracked in
[`docs/roadmap.md`](docs/roadmap.md); controls for unfinished features are not
shown in the UI.

## Run

Fluxion requires Firefox ESR 140 or compatible Firefox on the host. On Debian:

```sh
sudo apt install firefox-esr
./bin/fluxion
```

Alternatively point the launcher at a Firefox binary:

```sh
FLUXION_FIREFOX_BIN=/path/to/firefox ./bin/fluxion
```

Fluxion creates a dedicated profile under `.profiles/default` by default, so
it never mutates the user's normal Firefox profile. Override it with
`FLUXION_PROFILE=/absolute/path`.

Useful launcher options:

```sh
./bin/fluxion --private-window
./bin/fluxion https://example.com
./bin/fluxion --safe-mode       # Gecko troubleshooting mode
./bin/fluxion --version
```

## Develop and test

No JavaScript package installation is required.

```sh
./scripts/check.sh
node --test tests/*.test.js
```

To validate Gecko and the privileged chrome together in a desktop session (or
under Xvfb):

```sh
./scripts/smoke-gecko.sh
```

The smoke test needs a locally installed Firefox or `FLUXION_FIREFOX_BIN`.
Architecture and upstream strategy are described in
[`docs/architecture.md`](docs/architecture.md).

## Keyboard model

Firefox shortcuts remain available. Fluxion adds:

| Action | macOS | Windows/Linux |
| --- | --- | --- |
| Cycle Flow sidebar | `Cmd+Shift+\\` | `Ctrl+Shift+\\` |
| Next workspace | `Cmd+Option+]` | `Ctrl+Alt+]` |
| Previous workspace | `Cmd+Option+[` | `Ctrl+Alt+[` |
| New tab | `Cmd+T` | `Ctrl+T` |
| Reopen closed tab | `Cmd+Shift+T` | `Ctrl+Shift+T` |
| Tab search | `Cmd+Shift+A` | `Ctrl+Shift+A` |

## License

Fluxion code is available under the repository's MIT license. Mozilla Firefox
and its trademarks have their own licenses and policies; Fluxion does not
redistribute Firefox binaries from this repository.
