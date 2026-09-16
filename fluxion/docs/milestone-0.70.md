# Fluxion 0.70 — Product identity and interaction repairs

[Published as 0.70.0-preview.1](https://github.com/Ninnja10563/Fluxion-Browser/releases/tag/v0.70.0-preview.1).
All 1,065 regression tests and every mandatory native macOS gate passed in
[35062000814](https://github.com/Ninnja10563/Fluxion-Browser/actions/runs/35062000814).
See [release provenance](../release/provenance/v0.70.0-preview.1.md) and the
[candidate audit](validation/0.70-candidate.md) for failures, fixes and limits.

## Identity

The packaged Gecko brand terms, legacy string bundles and audited hardcoded
product messages now identify Fluxion. This covers quit confirmation and shared
permission/error/security surfaces, not just the macOS menu. Exact upstream
version and resource hashes are required; unknown inputs fail packaging.
Web content, user-agent compatibility, internal identifiers, legal notices and
real external Mozilla services retain their accurate identities.

A transparent silver F derived from the owner's artwork replaces packaged
browser mascots and generic product logos. The original supplied Dock/Finder
tile is unchanged. About and New Tab use the transparent mark. Security warning
and disabled states retain distinct badges, wording and functional controls;
branding must not conceal connection or protection status. The asset edit prompt
and provenance are in `assets/app-icons/README.md`.

## Implemented and verified

- Physical Control shortcuts on macOS remain distinct from Command shortcuts;
  recording, saved display and dispatch use the same representation.
- Tab-close compression no longer waits for pointer movement before adjacent
  rows move into place. Native page-leave cancellation remains authoritative.
- Import opens Gecko's real standalone migration wizard instead of hiding it
  under Fluxion's custom Settings. Enterprise import policy remains enforced.
- Explicit sidebar collapse releases automatic New Tab address focus. Keyboard
  address entry and security popups remain available; ordinary native fullscreen
  continues to use Gecko's toolbar controller.
- Workspace colour selection stays within the editor, with live pointer and
  keyboard adjustments, validation and explicit Save/Cancel semantics.
- General has native default-browser status and an explicit Make Fluxion Default
  action. The operating system owns confirmation; requesting the change is not
  treated as proof that it succeeded. CI intercepts the mutation and leaves the
  runner's actual default browser unchanged.
- Tab context menus expose existing Gecko account containers. Opening a page in
  another container keeps the original and its data intact; workspace placement
  and cookie/storage identity remain separate concepts.

The last-visible-tab close decision is narrowly patched to account for live tabs
hidden in other workspaces. Native last-window tests now include Flow-created
pages across workspaces and an explicit homepage-to-restore startup choice in an
isolated profile, not an imported user profile. Gecko may omit a user preference
that equals its default; the gate records both the effective value and its
provenance. That scenario uses normal quit
and relaunch with no test-forced session saving or pre-close state collection;
post-close waits allow native closed records to settle. The separate fresh-profile
scenario retains repeated-checkpoint coverage. All six packaged macOS stages
passed, with 26 checks and no duplicate or private closed-window records.
Startup opt-outs remained authoritative.
The confirmed last-visible-tab bug is distinct from the reported last-window
restoration issue: this tests the native close-window command used by ordinary
window closure, not the user's original profile or a physical red-button click.

Native frame verification passed 18 checks. With the pointer stationary after
closure, New Tab settled in 97.7ms in this CI sample; no physical-M3 speed claim
is inferred. Fullscreen had real eight-pixel clipping, native edge hover and
Command-L/Escape, with stable captures after the OS transition. Product chrome
passed 17 checks, including native pointer/range-keyboard colour adjustment,
hex editing, Save/switch/Cancel/Reset and unchanged global webpage appearance.
The unslop-ui review kept compact controls, shared alignment and restrained
surface treatment; the colour field's gradient communicates selectable colour.

The branded security popup is correctly anchored and preserves protection
controls and warning meanings. Its programmatic Settings-to-page fixture
retained a provisional address state until two native Escape actions dismissed
suggestions and reverted editing. The cause of that initial transition remains
unresolved; the passing branding check does not establish its repair.

## Distribution and next milestone

This preview remains ad-hoc signed. Removing the unverified-app warning requires
Developer ID signing, notarization and a stapled ticket; no signing credentials
were supplied or committed. Do not disable Gatekeeper globally.

0.71 is reserved for measured performance work. Establish the
user's benchmark/version and controlled same-device comparison first, profile
browser-owned overhead, then record repeated before/after measurements. Never
weaken sandboxing, permissions, private-data isolation or session durability to
improve a benchmark. No fastest-browser or score-improvement claim is made.
