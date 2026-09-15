# Workspace accounts: proposed Gecko container integration

Status: **not implemented; not included in 0.69**. This design is pending a
complete native account-isolation gate. Existing workspaces organise tabs; they
do not currently create separate cookie/account environments.

## Two independent properties

A tab's workspace determines where it appears in Flow. Its native Gecko
`userContextId` determines its container/account environment. Choosing Workspace
2's account for a tab in Workspace 1 must not move that tab to Workspace 2.
Moving tabs between workspaces must not change their container or reload them.

| Action | Proposed account selection |
| --- | --- |
| New tab, Cmd/Ctrl-T, first tab in an empty workspace | Workspace's configured default |
| Link, popup or Peek opened from a tab | Source tab's native container |
| Duplicate, reopen closed tab, session/crash restoration | Preserved native container |
| Explicit account selection | Chosen account; original workspace retained |
| Private window | Native private browsing; no persistent account creation |

The default affects future tabs only. Existing tabs remain unchanged when this
feature is enabled or the workspace default changes. A visible tab account
indicator must reflect its actual native container, not infer it from placement.

## Native boundaries verified against pinned Firefox 155.0.1

- Use `ContextualIdentityService.create(name, icon, color)` and public identity
  lookup. Do not allocate numeric IDs or rewrite `containers.json` ourselves.
- Pass `userContextId` into native tab creation. Gecko creates the tab and its
  browser before emitting `TabOpen`; changing an attribute after that event is
  not a safe way to change an established browsing context.
- Do not mutate a loaded tab's container. An explicit account change opens a
  fresh tab in that account, in the same workspace, retaining the original to
  protect unsaved work. Do not copy cookies, storage, POST data, principals or
  session state across accounts. Any later replacement workflow needs explicit
  confirmation and native page-leave protection.
- Preserve native opener, referrer, principal and private-browsing parameters.
  Gecko's link helpers already suppress referrers when changing containers.
- Leave duplication and restoration to SessionStore: it already carries
  `userContextId`. Fluxion adds only independent workspace metadata.
- **Deleting a workspace must not delete its account.** Native identity removal
  clears that container's website data and invalidates corresponding closed-tab
  recovery. Account deletion requires a separate, explicit destructive action.
- Respect managed preferences. Disabling `privacy.userContext.enabled` is not a
  harmless UI toggle: Gecko closes container tabs and resets container data.

Audited upstream sources: [identity service](https://github.com/mozilla-firefox/firefox/blob/FIREFOX_155_0_1_RELEASE/toolkit/components/contextualidentity/ContextualIdentityService.sys.mjs),
[tab creation](https://github.com/mozilla-firefox/firefox/blob/FIREFOX_155_0_1_RELEASE/browser/components/tabbrowser/content/tabbrowser.js),
[link loading](https://github.com/mozilla-firefox/firefox/blob/FIREFOX_155_0_1_RELEASE/browser/modules/URILoadingHelper.sys.mjs),
[context-menu link parameters](https://github.com/mozilla-firefox/firefox/blob/FIREFOX_155_0_1_RELEASE/browser/base/content/nsContextMenu.sys.mjs),
and [SessionStore](https://github.com/mozilla-firefox/firefox/blob/FIREFOX_155_0_1_RELEASE/browser/components/sessionstore/SessionStore.sys.mjs).

## Proposed integration

A profile-scoped container service owns versioned workspace-to-identity mappings,
validates them against live public identities and coordinates creation across
windows. Missing or externally deleted identities require a visible repair
choice; never silently substitute the shared default account. Native identity
storage and Fluxion preferences are asynchronously saved in separate files, so
restart tests must cover incomplete mappings and orphan identities. Do not
automatically delete retained accounts as cleanup.

A small window adapter supplies explicit account options for Flow New Tab,
empty-workspace creation, new split tabs, palette/Library destinations and
Settings links. The native New Tab command must reach it before browser
creation. Avoid a blanket `addTab` override that changes extension-created,
restored, linked or explicitly containerised tabs. New-window startup and
external-application URLs require separately verified routing; never retrofit
an identity into an already loaded initial tab.

Private windows must not create or update persisted mappings. No webpage API is
exposed. Container IDs select native origin attributes; they are not permission
to read another account's data or a substitute for private browsing.

## Required release gate

Before implementation is called complete, packaged Gecko must prove:

- Two containers on the same loopback origin have independent cookies and
  localStorage; changing the active workspace cannot leak either value.
- A tab can use another workspace's account while remaining in its original
  workspace; moves preserve live document identity, drafts and account state.
- Native Cmd/Ctrl-T and visible New Tab use the configured workspace default;
  links, popups and Peek inherit the source account instead.
- Duplicate, close/reopen, cross-window transfer, clean restart and crash
  restoration retain both account identity and independent placement.
- Changing defaults leaves existing pages unchanged. Unknown identities,
  interrupted persistence and policy locks cannot fall back silently.
- Workspace deletion preserves retained account data; private windows create
  neither persisted mappings nor normal-profile account evidence.

Unit tests additionally cover validated mapping schemas, stale menu snapshots,
cross-window creation races, private exclusion and exact native creation options.
Passing mocked API calls alone is not sufficient evidence of account isolation.
