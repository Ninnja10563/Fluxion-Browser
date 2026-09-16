const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const NOW = Date.parse("2026-09-16T10:00:00.000Z");

async function fixture(t, version = "0.70.1-preview.1") {
  const signing = await import("../scripts/sign-update-asset.mjs");
  const { buildSparkleFeed } = await import("../scripts/build-sparkle-feed.mjs");
  const pair = crypto.generateKeyPairSync("ed25519");
  const seed = pair.privateKey.export({ type: "pkcs8", format: "der" }).subarray(-32).toString("base64");
  const lock = { publicKey: pair.publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("base64"), minimumMacOS: "12.0" };
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "fluxion-sparkle-signing-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const body = Buffer.from("isolated archive fixture\n"), assetPath = path.join(directory, signing.archiveName(version));
  await fs.writeFile(assetPath, body);
  const calls = [], signingOptions = { assetPath, version, sourceCommit: "a".repeat(40), signUpdatePath: "/reviewed/sign_update", seed, lock };
  const run = (tool, args, options) => {
    calls.push({ tool, args, options });
    assert.equal(options.input, `${seed}\n`);
    assert.ok(!args.includes(seed));
    assert.equal(options.env.FLUXION_SPARKLE_PRIVATE_KEY, undefined);
    assert.equal(options.stdio[2], "pipe");
    if (args.includes("--verify")) {
      assert.ok(crypto.verify(null, body, pair.publicKey, Buffer.from(args.at(-1), "base64")));
      return "";
    }
    return crypto.sign(null, body, pair.privateKey).toString("base64") + "\n";
  };
  const record = await signing.signUpdateAsset({ ...signingOptions, run });
  const name = signing.archiveName(version), url = signing.archiveURL(version);
  const release = { id: 1, tag_name: `v${version}`, draft: false, prerelease: version.includes("preview"),
    html_url: `https://github.com/Ninnja10563/Fluxion-Browser/releases/tag/v${version}`,
    published_at: "2026-09-16T09:00:00.000Z", verifiedAt: "2026-09-16T09:59:00.000Z", sourceCommit: record.sourceCommit,
    assets: [{ id: 11, name, state: "uploaded", size: body.length, digest: `sha256:${record.sha256}`, browser_download_url: url },
      { id: 12, name: `${name}.sha256`, state: "uploaded", size: 100, digest: `sha256:${"b".repeat(64)}`, browser_download_url: `${url}.sha256` }] };
  const feed = { schemaVersion: 1, repository: "Ninnja10563/Fluxion-Browser", generatedAt: new Date(NOW).toISOString(),
    expiresAt: new Date(NOW + 86400000).toISOString(), releases: [release] };
  const requests = [];
  const build = overrides => buildSparkleFeed(feed, { seed, lock, now: () => NOW, fetchImpl: async (request, options) => {
    requests.push({ request, options }); return Response.json(record);
  }, ...overrides });
  return { signing, signingOptions, body, assetPath, directory, pair, seed, lock, record, calls, run, feed, release, requests, build };
}

test("official signer receives seed only via stdin; archive and strict metadata independently authenticate", async t => {
  const f = await fixture(t);
  assert.equal(f.calls.length, 2);
  assert.deepEqual(f.calls[0].args, ["--ed-key-file", "-", "-p", f.assetPath]);
  assert.equal(f.calls[1].args[2], "--verify");
  assert.equal(f.record.bundleVersion, "0.70.1b1");
  assert.equal(f.signing.validateSignedRecord(f.record, f.lock).sourceCommit, "a".repeat(40));
  assert.ok(crypto.verify(null, f.signing.canonicalRecord(f.record), f.pair.publicKey, Buffer.from(f.record.metadataSignature, "base64")));
});

test("metadata rejects tampering with every signed field, unknown fields, and a different signing key", async t => {
  const f = await fixture(t);
  for (const [key, value] of Object.entries(f.record)) {
    const mutation = typeof value === "number" ? value + 1 : `${value}x`;
    assert.equal(f.signing.validateSignedRecord({ ...f.record, [key]: mutation }, f.lock), null, key);
  }
  assert.equal(f.signing.validateSignedRecord({ ...f.record, downloadOverride: "https://evil.invalid" }, f.lock), null);
  const other = crypto.generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("base64");
  assert.equal(f.signing.validateSignedRecord(f.record, { ...f.lock, publicKey: other }), null);
  await assert.rejects(f.signing.signUpdateAsset({ ...f.signingOptions, seed: crypto.randomBytes(32), run: f.run }), /reviewed public key/);
});

test("version mapping rejects ambiguous, out-of-range, or injected prerelease values", async t => {
  const f = await fixture(t);
  for (const value of ["0.70.1-preview.0", "0.70.1-preview.256", "0.70.1-preview.01", "00.70.1", "0.70.1\n", "0.70.1\r", "0.70.1\u2028", "0.70.1-beta.1", "0.70.1\"/>bad", null])
    assert.throws(() => f.signing.nativeVersion(value), /Unsupported/);
  assert.equal(f.signing.nativeVersion("0.70.1-preview.255"), "0.70.1b255");
  assert.equal(f.signing.nativeVersion("0.70.1"), "0.70.1");
});

test("signer failures suppress captured output and signing cannot succeed if verification fails", async t => {
  const f = await fixture(t);
  let count = 0;
  await assert.rejects(f.signing.signUpdateAsset({ ...f.signingOptions, run() {
    if (++count === 1) return f.record.archiveSignature;
    throw new Error(`private tool output ${f.seed}`);
  } }), error => !error.message.includes(f.seed) && /private output was suppressed/.test(error.message));
  assert.equal(count, 2);
});

test("archive mutation and symlink inputs cannot yield signed release metadata", async t => {
  const f = await fixture(t);
  const sync = require("node:fs");
  await assert.rejects(f.signing.signUpdateAsset({ ...f.signingOptions, run(_tool, args) {
    if (args.includes("--verify")) sync.writeFileSync(f.assetPath, Buffer.from("changed archive"));
    return f.record.archiveSignature;
  } }), /changed during signing/);
  await fs.unlink(f.assetPath); await fs.writeFile(path.join(f.directory, "other.dmg"), f.body);
  await fs.symlink(path.join(f.directory, "other.dmg"), f.assetPath);
  await assert.rejects(f.signing.signUpdateAsset({ ...f.signingOptions, run: f.run }), /Invalid update archive file/);
});

test("appcast authenticates exact preceding UTF-8 bytes using the official Sparkle trailer", async t => {
  const f = await fixture(t), result = await f.build();
  const trailer = result.match(/<!-- sparkle-signatures:\nedSignature: ([A-Za-z0-9+/=]+)\nlength: (\d+)\n-->\n$/);
  assert.ok(trailer);
  const content = Buffer.from(result.slice(0, trailer.index));
  assert.equal(content.length, Number(trailer[2]));
  assert.ok(crypto.verify(null, content, f.pair.publicKey, Buffer.from(trailer[1], "base64")));
  content[content.length - 2] ^= 1;
  assert.equal(crypto.verify(null, content, f.pair.publicKey, Buffer.from(trailer[1], "base64")), false);
  assert.match(result, /sparkle:version="0\.70\.1b1"/);
  assert.match(result, /sparkle:shortVersionString="0\.70\.1-preview\.1"/);
  assert.match(result, /<sparkle:channel>preview<\/sparkle:channel>/);
  assert.equal(f.requests[0].request, `${f.record.url}.sparkle.json`);
  assert.equal(f.requests[0].options.credentials, "omit");
  assert.equal(f.requests[0].options.headers, undefined);
});

test("stable appcast has no preview channel and legacy releases alone produce an authenticated empty channel", async t => {
  const stable = await fixture(t, "0.70.1");
  assert.doesNotMatch(await stable.build(), /<sparkle:channel>/);
  const old = await fixture(t, "0.70.0-preview.1");
  assert.doesNotMatch(await old.build({ fetchImpl() { throw new Error("Legacy must not fetch"); } }), /<item>/);
});

test("new releases cannot fall back to unsigned or absent metadata", async t => {
  const f = await fixture(t);
  await assert.rejects(f.build({ fetchImpl: async () => new Response(null, { status: 404 }) }), /missing signed/);
  await assert.rejects(f.build({ fetchImpl: async () => Response.json({ ...f.record, metadataSignature: undefined }) }), /does not match/);
  await assert.rejects(f.build({ fetchImpl: async () => Response.json({ ...f.record, archiveSignature: crypto.randomBytes(64).toString("base64") }) }), /does not match/);
});

test("even validly signed records must match independently verified release hash, size, and source commit", async t => {
  const f = await fixture(t);
  for (const patch of [{ sha256: "c".repeat(64) }, { size: f.record.size + 1 }, { sourceCommit: "d".repeat(40) }]) {
    const record = { ...f.record, ...patch };
    record.metadataSignature = crypto.sign(null, f.signing.canonicalRecord(record), f.pair.privateKey).toString("base64");
    assert.ok(f.signing.validateSignedRecord(record, f.lock));
    await assert.rejects(f.build({ fetchImpl: async () => Response.json(record) }), /does not match/);
  }
});

test("sidecar fetch allows only bounded anonymous HTTPS GitHub release redirects", async t => {
  const f = await fixture(t);
  for (const target of ["http://github.com/file", "https://evil.invalid/file", "https://u@github.com/file", "https://github.com:444/file"]) {
    let calls = 0;
    await assert.rejects(f.build({ fetchImpl: async () => { calls++; return new Response(null, { status: 302, headers: { location: target } }); } }), /Unsafe/);
    assert.equal(calls, 1);
  }
  let calls = 0;
  await f.build({ fetchImpl: async (_url, options) => {
    assert.equal(options.credentials, "omit"); assert.equal(options.headers, undefined);
    return ++calls === 1 ? new Response(null, { status: 302, headers: { location: "https://release-assets.githubusercontent.com/file?token=public" } }) : Response.json(f.record);
  } });
  assert.equal(calls, 2);
  await assert.rejects(f.build({ fetchImpl: async () => new Response(null, { status: 302, headers: { location: "https://github.com/loop" } }) }), /Excessive/);
});

test("oversized, invalid UTF-8, and expired metadata fail closed", async t => {
  const f = await fixture(t);
  await assert.rejects(f.build({ fetchImpl: async () => new Response(" ".repeat(16385)) }), /exceeds/);
  await assert.rejects(f.build({ fetchImpl: async () => new Response(Buffer.from([0xff])) }));
  f.feed.expiresAt = new Date(NOW - 1).toISOString();
  await assert.rejects(f.build(), /invalid or expired/);
});
