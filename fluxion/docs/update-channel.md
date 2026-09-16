# Verified update channel

## 0.70.1-preview.1 — native replacement verified

Published 0.70 and earlier discover updates and open a manual download only on
request; those shipped apps cannot gain an installer without one manual DMG
upgrade. The [0.70.1-preview.1 release](https://github.com/Ninnja10563/Fluxion-Browser/releases/tag/v0.70.1-preview.1) adds a pinned
[Sparkle 2.10.0 integration](https://github.com/sparkle-project/Sparkle/releases/tag/2.10.0),
not a shell-based replacement script. All 1,126 tests and mandatory native gates
passed, including real installation with isolated signed fixture versions.
[The milestone](milestone-0.70.1.md) and
[release provenance](../release/provenance/v0.70.1-preview.1.md) record exact
source/run identities and do not claim an update of the published 0.70 binary.

There are two distinct metadata paths. The existing expiring `releases.json`
supports lightweight version discovery. It is HTTPS-delivered verified public
metadata, not the executable-signing trust anchor. An explicit install action
uses Sparkle's separately signed `appcast.xml` and signed archive, authenticated
with the embedded Ed25519 public key. `runtime/sparkle-lock.json` pins the
framework version/archive and public key; maintainers keep the corresponding
private signing material outside the repository, app, logs and release artifacts.

The shared coordinator schedules discovery approximately every five minutes
while normal windows are registered, starting after a short delay and applying
failure backoff/server retry timing. Settings → About can opt out or check
manually. Private-window subscriptions do not start automatic checks. Discovery
never grants consent to download, replace or restart the application.

The available-update icon explicitly names “Update to VERSION and restart
Fluxion.” Clicking it binds consent to that offer. Progress, cancel/retry when
supported, release notes and a manual-DMG fallback live in About. A stale offer
must be refreshed rather than silently substituting a different version for
the one approved.

The privileged Gecko module loads a native main-thread bridge with js-ctypes;
neither the C launcher nor webpages host the updater. Sparkle requests normal
Apple-event quit. Gecko retains unsaved-page confirmation, SessionStore and
profile flushing; canceled quit must leave the running app intact and permit a
version-bound retry. No forced termination is an acceptable success path.

Initial installation scope is macOS 12+, the canonical default profile, one
running Fluxion application process and an application outside its mounted
DMG. Sparkle relaunches the bundle without arbitrary profile arguments, so other
profiles use manual installation rather than being silently redirected.
Multiple windows in that one process remain independent windows.

The native gate passed valid signed-feed authentication, corrupt/wrongly signed
archive rejection, observer-canceled native quit, version-bound retry, actual
replacement and same-default-profile relaunch. Its exact seeded tabs,
selection/pin, workspace metadata, bookmark and preference were retained.
The installation fixture uses restore-session startup (`browser.startup.page=3`);
normal quit/relaunch does not force restoration over startup choices 0 or 1.
It does not seed a private-window sentinel; separate session gates verify private
exclusion and startup opt-outs.
Observer cancellation is not a physical unsaved-page-dialog test. Version and
app-identity policy checks and separate signing interoperability tests must not
be confused with native invalid-feed rejection. Additional invalid-feed cases,
read-only/interrupted-install recovery and wider physical-machine audits remain
outside this installation evidence. The release is still ad-hoc signed, **not
Apple-notarized**; Ed25519 authentication does not supply Developer ID signing
or a notarization ticket. See [the milestone](milestone-0.70.1.md),
[native bridge contract](../packaging/macos/updater/README.md) and
[dependency/license inventory](dependencies.md).

## Existing discovery feed and publication history

The published 0.64 preview uses this feed for manual update discovery. Published 0.63
and earlier keep their existing explicit GitHub API request; their successful
native release evidence and shipped binaries have not been changed.

Repeated anonymous API quota exhaustion motivates a maintained public feed for
manual update discovery. A browser should not require a GitHub token to check
its own releases. Publishing can use authenticated repository access; browsing
must remain anonymous and send no installed-version query or browsing data.

## Producer and evidence

The builder must finish bounded release pagination before selecting the latest
stable and preview channels independently. Malformed or unverifiable newest
releases must fail the build, not silently expose an older release as current.
Each selected release must be publicly published. Its native tag must resolve
to the recorded source commit, and its complete DMG and checksum bytes must
match the uploaded asset sizes, SHA-256 digests and exact checksum filename.
The DMG is hashed as a stream, not loaded wholly into memory. API authorization
must never reach public asset requests or their redirects.

The implemented builder resolves tags before and after downloading and repeats
complete release discovery after verification. Changed release/asset identities,
deleted releases and newly published channel versions fail that attempt; changing
download counters or release prose do not. This is a bounded observation, not an
atomic GitHub snapshot, so deployment serialization and periodic reconciliation
remain necessary. Requests use one overall deadline, reject API redirects, and
permit only anonymous HTTPS asset redirects on GitHub's download hosts.

Run `node scripts/build-release-feed.mjs --output /new/path/feed.json` from
`fluxion/` to verify current public assets and generate a local manifest.
An optional `GH_TOKEN` authenticates only repository API reads. The output must
not already exist. This command downloads and hashes the newest channel DMGs;
it does not upload files, modify releases, deploy a feed or change the browser.

The versioned feed records only public release/asset IDs, canonical repository
URLs, tag, source commit, publication/verification times, sizes and hashes. It
contains at most the newest stable and newest preview release. Strict schema,
channel, identity, date, size and digest validation rejects the entire malformed
feed. Generated/verified timestamps have bounded clock skew; expiry is no more
than seven days after generation. Expired data cannot report a current browser.

This JSON is maintainer-controlled metadata delivered over HTTPS, not an independent
digital signature or a native-build attestation. The separate Sparkle appcast
does not change that JSON's meaning. Existing build and release
gates remain responsible for browser validation before public release.

## Deployment

Publish on a dedicated `update-channel` branch only after the release is public
and its assets are verified. Serialize producers, query current releases inside
that serialization, and refuse non-fast-forward publication. A failed update
leaves the preceding feed intact; retry feed publication without recreating the
release. Reconcile periodically to refresh expiry and detect removed or changed
assets. Initial bootstrap must describe an already verified public release,
never the candidate awaiting its own validation.

The low-level browser consumer must preserve a bounded deadline/response,
single-flight sharing, no credentials/cookies/referrer, canonical destinations,
preview/stable compatibility and no automatic asset download. The 0.70.1
coordinator adds optional scheduled metadata requests, not installation consent.
Raw hosting can
also fail or cache stale content; expiry and actionable failure UI are required.
The native gate must observe a real public HTTP 200 response and compare the
selected release with independent published-release evidence. Local fixtures
remain unit-test inputs, never release evidence.

The publisher now implements a dedicated `update-channel` branch with a
`releases.json` file. Git tree updates preserve unrelated branch files and use
the observed commit as parent. Ref updates explicitly prohibit force; branch
movement before verification or publication fails the attempt. Bootstrap
creates an independent root commit without deleting a source checkout.
The workflow serializes publication, refreshes every six hours, and responds
to release publication/edit/deletion or a manual dispatch. It checks out trusted
`main`, never a release tag's workflow code. Twenty-four producer, schema and
publication tests cover these boundaries before deployment.

Bootstrap workflow [34597299803](https://github.com/Ninnja10563/Fluxion-Browser/actions/runs/34597299803)
passed on producer source `114998f7c7336f0e281d20f5cb93e750613463a4`, publishing
feed commit `3b90726a5179619c56aaf5fcdd8a12325a977a6b`. A real anonymous fetch
returned its valid JSON describing public 0.63, generated
`2026-09-11T12:07:31.131Z`, expiring 24 hours later.

The second real publication run
[34598129536](https://github.com/Ninnja10563/Fluxion-Browser/actions/runs/34598129536)
passed on source `4e2a3cc1c59837dca295d00d3a36d3f48040a3ee`. Feed commit
`b318113206b34a3f72fde07d6532c7ebe78a0282` has the bootstrap commit as its
parent, independently confirming an ordinary fast-forward refresh. Full native
staging [34597750878](https://github.com/Ninnja10563/Fluxion-Browser/actions/runs/34597750878)
subsequently passed the actual Gecko feed request and all release gates.

Publication of 0.64 automatically triggered successful release-event run
[34598681368](https://github.com/Ninnja10563/Fluxion-Browser/actions/runs/34598681368).
Its feed commit `d46b1ad0431ecad8c896f9e073942edfeffb320e` advertises actual
public 0.64. A postpublication run of the real update module against the public
endpoint returned HTTP 200 and the correct available version/source/assets.

## Browser and native validation

The fixed endpoint is
`https://raw.githubusercontent.com/Ninnja10563/Fluxion-Browser/update-channel/releases.json`.
Each discovery request is a shared, credential-free GET with no query
parameters, cookies, referrer or API fallback. It accepts JSON or raw-hosting
text/plain only after strict JSON/schema validation. The whole response is
limited to 64 KiB and ten seconds. Expired or malformed data is unavailable,
never current; the user can retry explicitly or open the releases page. Checks
do not download the DMG/checksum. Published 0.70 and earlier offer only manual
installation; 0.70.1's explicit install route authenticates through
Sparkle separately.

Before launching the native verifier, the maintainer shell separately discovers
actual GitHub releases and anonymously hashes public DMG/checksum bytes. Its
repository API reads may use the workflow token; both `GH_TOKEN` and
`GITHUB_TOKEN` are removed from the browser launch environment, and the native
test asserts their absence. Only public expected metadata crosses that boundary.
The actual browser must receive feed HTTP 200, make no repository API request,
and match the independent latest version, release/source identity and all asset
IDs, URLs, sizes and digests. No local feed is injected into the browser.

GitHub's [reference API](https://docs.github.com/en/rest/git/refs) provides
non-forced fast-forward updates; its [tree API](https://docs.github.com/en/rest/git/trees)
supports preserving an existing base tree while replacing one file. Repository
write credentials are confined to the maintainer job, never sent by the browser.

## Prototype verification — 2026-09-11

The combined local suite passes 819 tests, including 18 producer/schema tests.
A real builder run completed at `2026-09-11T08:48:02.750Z`, resolving the latest
public preview as `v0.62.0-preview.1` (release `386832914`) at source
`b82978d1603becd68a98bf395bdd972c9003ee60`. It anonymously streamed the
224,807,604-byte DMG and its 111-byte checksum, matching REST asset IDs
`556669633`/`556669634` and SHA-256 values
`74660389f6ab4bacb291f59d512c06e262099772493790f00ebaa7fc32e285b9` /
`d56676cd063413c1e15707a31545d540b438ecf74c13c4c01ac85b0fa052e2f6`.
This generated only a local, expiring manifest; no public feed was deployed.
