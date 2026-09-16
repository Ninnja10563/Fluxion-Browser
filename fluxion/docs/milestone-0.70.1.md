# Fluxion 0.70.1 — Updates and window behavior

**Candidate: native update, session and toolbar checks have passed; the final
complete release run and publication are pending.** The evidence below identifies
individual runs rather than implying that an unpublished candidate has shipped.

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
decorative notification badge. The unslop-ui review kept this a small inline
toolbar action rather than adding a notification card or persistent promotion.

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

## Native evidence

[Native updater run 35069931392](https://github.com/Ninnja10563/Fluxion-Browser/actions/runs/35069931392)
passed on source `69e0e8ab43ac4b61269341ee86d520466ae0341b`. It installed an
actually signed isolated fixture from bundle version `1.0.0b1` to `1.0.1b1`
through Sparkle, not a mock replacement and not an upgrade of the published
0.70 binary. Wrongly signed and corrupt archives were rejected while the live
session remained unchanged. A quit observer canceled one real native quit
request; version-bound retry then replaced the app and relaunched a different
process (PID 3042 → 4375). The same default-profile fixture retained its exact
three tab URLs, selected tab, pinned state, workspace metadata, bookmark GUID
and saved preference. This proves observer cancellation, not a physical click
on an unsaved-page confirmation dialog.
The updater fixture uses restore-session startup (`browser.startup.page=3`).
It does not override fresh-start choices or seed a private-window sentinel;
private exclusion and startup opt-outs are covered by separate session gates.

[Browser run 35069330208](https://github.com/Ninnja10563/Fluxion-Browser/actions/runs/35069330208),
on source `679d572e6de407620e535a8630641265c014eccf`, passed its product-chrome,
frame and last-window gates. These cover the inline update control's geometry
at ordinary/narrow widths, expanded/compact fullscreen navigation, actual
top-edge pointer reveal/retraction, retained keyboard focus, and a real page
click returning focus before native retraction. The indicator geometry fixture
does not manufacture an update offer or establish installation behavior.
Last-window checks include native window-button activation, final-tab
replacement, hidden-workspace retention, private exclusion and startup opt-outs.
An earlier [run 35067865158](https://github.com/Ninnja10563/Fluxion-Browser/actions/runs/35067865158)
also passed the seven-stage last-window gate; neither earlier browser run
substitutes for the final complete release run at the chosen source revision.

## Remaining release and hardware checks

Final full-pipeline acceptance and public DMG/feed publication remain pending.
Physical M3/trackpad and wider accessibility checks remain separate from
hosted-runner native widget/accessibility input evidence. The original reported
user profile is not an imported recovery fixture.

The native installation gate authenticated a valid signed feed; its rejection
cases concern archives, not an altered feed. Separate signing interoperability
tests are not native invalid-feed installation evidence. Read-only destination
and interrupted-install recovery must not be inferred from these passing cases.

No website benchmark, fastest-browser, or original-user-profile recovery claim
is made. The measured performance milestone remains separate.

### Continuous-wheel fixture timing

Run [35074101093](https://github.com/Ninnja10563/Fluxion-Browser/actions/runs/35074101093)
at `ee22f4ecc8832f26380e4b690728eee8f743ae7c` exposed a test-input timing error:
one requested 25ms delay between routed momentum events took 231.04875ms,
crossing the existing 220ms gesture-idle boundary. All 13 events were trusted
and canceled; replaying their recorded times through the unchanged state machine
reproduced the second switch. The continuous-input fixture now sends its bounded
native burst without inter-event timer yields and requires recorded cadence to
remain below that boundary. Its count, cancellation, one-switch and unchanged
page-history assertions remain, as do the separate delayed/new-gesture cases.
There is no threshold increase, retry or skipped check.

This does not solve physical trackpad phase detection: Gecko's exposed
[WheelEvent interface](https://searchfox.org/firefox-main/source/dom/webidl/WheelEvent.webidl)
has no momentum-phase property for this JavaScript controller. A sufficiently
long gap in delivered input is still classified by the existing idle heuristic.
