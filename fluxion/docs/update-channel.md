# Verified update channel: implementation in progress

This work is separate from the 0.63 release candidate. Its consumer and
deployment are not yet enabled; ordinary Fluxion update checks still use the
existing explicit GitHub API request. No new endpoint or success fixture has
been substituted into 0.63's native release gate.

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

This is maintainer-controlled metadata delivered over HTTPS, not an independent
digital signature or a native-build attestation. Existing build and release
gates remain responsible for browser validation before public release.

## Deployment

Publish on a dedicated `update-channel` branch only after the release is public
and its assets are verified. Serialize producers, query current releases inside
that serialization, and refuse non-fast-forward publication. A failed update
leaves the preceding feed intact; retry feed publication without recreating the
release. Reconcile periodically to refresh expiry and detect removed or changed
assets. Initial bootstrap must describe an already verified public release,
never the candidate awaiting its own validation.

The browser consumer must preserve explicit action, a bounded deadline/response,
single-flight sharing, no credentials/cookies/referrer, canonical destinations,
preview/stable compatibility and no automatic asset download. Raw hosting can
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
