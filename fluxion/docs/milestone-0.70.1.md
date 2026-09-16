# Fluxion 0.70.1 — Updates and window behavior

**Candidate in development. Native verification and publication are pending.**
The presence of source code or passing local tests is not evidence that a
packaged native update has installed successfully.

## Updates

The candidate integrates Sparkle 2.10.0 through a privileged native bridge.
The maintained updater authenticates both its signed appcast and update archive
against the embedded Ed25519 public key. The release-signing private key is not
part of the application or repository.

A process-wide coordinator checks public release metadata approximately every
five minutes while normal browser windows are registered, with failure backoff
and server retry timing. Settings → About can disable automatic checks or run
an explicit check. Private windows do not start automatic checks. Metadata
checks do not download an application or trigger installation.

An available-update toolbar icon has an explicit “Update to VERSION and restart
Fluxion” label. Clicking it requests that version's installation. During an
update the same control opens About for status; About exposes actual progress,
cancel/retry when available, release notes and a separate manual DMG action.
The control is quiet when no action is needed, without a permanent spinner or
decorative notification badge.

Sparkle requests ordinary browser quit rather than killing Gecko. Unsaved-page
confirmation and shutdown/profile flushing remain native. Canceling quit must
leave the installed app intact and offer a version-bound retry. The initial
integration supports macOS 12+, the default Fluxion profile, one running Fluxion
application process and an installed application outside `/Volumes`. Other
launch/profile arrangements keep the manual DMG route. Multiple ordinary
windows in one process are not copies of one another.

Users of published 0.70 or earlier need one manual DMG upgrade before any native
updater is available. Later automatic discovery still does not grant automatic
installation consent. The preview remains ad-hoc signed, **not Apple-notarized**.

## Tabs, windows and navigation

The pinned Gecko tab-removal policy now keeps normal browser windows open when
their final tab closes, including the final tab in a workspace. Native empty-tab
creation replaces it; pages in other workspaces must remain intact. Explicit
window close and application Quit are separate native paths, and popup/adoption
teardown retains its native handling. Restore-session startup uses SessionStore;
fresh-start choices and private exclusions remain authoritative. This does not
mirror one window's tabs into every new window.

Expanded and compact sidebars keep navigation visible, including macOS browser
fullscreen. Only hidden/Focus mode uses top-edge reveal and pointer-departure
retraction. Genuine address focus and security/menu interaction retain the
toolbar; DOM/video fullscreen stays under Gecko's controller. The implementation
uses native fullscreen notifications and per-window state rather than rewriting
a shared preference on every sidebar change.

## Acceptance still required

- Packaged macOS toolbar, Settings and geometry checks, including the visible
  update indicator at both ordinary and narrow window widths.
- Actual signed old-to-new update, valid signed-feed authentication,
  corrupt/wrongly signed archive rejection, canceled quit,
  retry, application replacement and same-default-profile relaunch.
- Native final-tab closure and actual window-close/session recovery cases,
  including private exclusion and startup opt-outs.
- Physical M3/trackpad and wider accessibility checks remain separate from
  hosted-runner widget-routing evidence.

Additional invalid-feed, read-only destination and interrupted-install recovery
cases must not be claimed from the narrower archive-rejection gate.

No website benchmark, fastest-browser, or original-user-profile recovery claim
is made. The measured performance milestone remains separate.
