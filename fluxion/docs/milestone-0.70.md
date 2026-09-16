# Fluxion 0.70 — Product identity and interaction repairs

Candidate; local changes are not a published or native-verified release yet.

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

## Repairs being validated

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
pages across workspaces and an explicitly stored restore preference in an
isolated profile, not an imported user profile. That scenario uses normal quit
and relaunch with no test-forced session saving or pre-close state collection;
post-close waits allow native closed records to settle. The separate fresh-profile
scenario retains repeated-checkpoint coverage. These paths remain release blockers until the
packaged macOS tests pass; startup opt-outs must not be overwritten to
manufacture a pass.

## Distribution and next milestone

This preview remains ad-hoc signed. Removing the unverified-app warning requires
Developer ID signing, notarization and a stapled ticket; no signing credentials
were supplied or committed. Do not disable Gatekeeper globally.

0.71 is reserved for measured performance work after 0.70 passes. Establish the
user's benchmark/version and controlled same-device comparison first, profile
browser-owned overhead, then record repeated before/after measurements. Never
weaken sandboxing, permissions, private-data isolation or session durability to
improve a benchmark. No fastest-browser or score-improvement claim is made.
