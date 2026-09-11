"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const REPO = "Ninnja10563/Fluxion-Browser", API = `https://api.github.com/repos/${REPO}`;
const PUBLIC = `https://github.com/${REPO}`, NOW = Date.parse("2026-09-11T07:00:00.000Z");
const SHA = "a".repeat(40), TAG = "b".repeat(40);
const digest = bytes => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
function fixture() {
  const bodies = new Map(), calls = [], releases = [];
  function release(version, id) {
    const name = `Fluxion-${version}-macOS-universal.dmg`, tag_name = `v${version}`;
    const dmg = Buffer.from(`actual fixture bytes ${version}`);
    const checksum = Buffer.from(`${digest(dmg).slice(7)}  ${name}\n`);
    const assets = [dmg, checksum].map((body, index) => {
      const assetName = index ? `${name}.sha256` : name;
      const url = `${PUBLIC}/releases/download/${tag_name}/${assetName}`;
      bodies.set(url, body);
      return { id: id * 10 + index, name: assetName, size: body.length, state: "uploaded", digest: digest(body), browser_download_url: url };
    });
    const value = { id, tag_name, draft: false, prerelease: version.includes("preview"),
      html_url: `${PUBLIC}/releases/tag/${tag_name}`, published_at: "2026-09-10T07:00:00Z", assets };
    releases.push(value); return value;
  }
  const f = { bodies, calls, releases, release, pages: null, annotate: false, override: null, refReads: 0 };
  f.fetchImpl = async (url, options) => {
    calls.push({ url, options });
    const overridden = await f.override?.(url, options);
    if (overridden) return overridden;
    if (url.startsWith(`${API}/releases?`)) {
      const page = Number(new URL(url).searchParams.get("page"));
      return Response.json(f.pages ? f.pages[page - 1] || [] : releases);
    }
    if (url.startsWith(`${API}/git/ref/tags/`)) {
      f.refReads++;
      return Response.json({ ref: `refs/tags/${decodeURIComponent(url.split("/").at(-1))}`,
        object: { type: f.annotate ? "tag" : "commit", sha: f.annotate ? TAG : SHA } });
    }
    if (url === `${API}/git/tags/${TAG}`) return Response.json({ sha: TAG, object: { type: "commit", sha: SHA } });
    if (url === `${API}/commits/${SHA}`) return Response.json({ sha: SHA });
    if (bodies.has(url)) {
      const body = bodies.get(url);
      // Deliberately stream chunks; builder must not call arrayBuffer on DMGs.
      return new Response(new ReadableStream({ start(controller) {
        for (let offset = 0; offset < body.length; offset += 7) controller.enqueue(body.subarray(offset, offset + 7));
        controller.close();
      } }), { headers: { "Content-Length": String(body.length) } });
    }
    throw new Error(`Unexpected request ${url}`);
  };
  f.build = async options => {
    const { buildReleaseFeed } = await import("../scripts/build-release-feed.mjs");
    return buildReleaseFeed({ fetchImpl: f.fetchImpl, now: () => NOW, apiToken: "fixture-token", ...options });
  };
  return f;
}

test("publisher verifies newest stable and preview independently, including annotated tags and streamed bytes", async () => {
  const f = fixture(); f.release("0.2.0", 1); f.release("0.1.0", 2); f.release("0.3.0-preview.2", 3); f.annotate = true;
  const feed = await f.build();
  assert.deepEqual(feed.releases.map(r => r.tag_name), ["v0.2.0", "v0.3.0-preview.2"]);
  assert.ok(feed.releases.every(r => r.sourceCommit === SHA && r.published_at === "2026-09-10T07:00:00.000Z"));
  assert.equal(f.refReads, 4); assert.equal(feed.generatedAt, new Date(NOW).toISOString());
  for (const { url, options } of f.calls) {
    assert.equal(options.credentials, "omit"); assert.equal(options.redirect, "manual");
    assert.equal(options.headers.Authorization, url.startsWith(API) ? "Bearer fixture-token" : undefined);
  }
});

test("publisher completes pagination before choosing a release and rejects incomplete bounds", async () => {
  const f = fixture(); const latest = f.release("1.2.0-preview.1", 1001);
  f.pages = [Array.from({ length: 100 }, (_, i) => ({ id: i + 1, tag_name: `misc-${i}`, draft: false })), [latest]];
  assert.equal((await f.build()).releases[0].tag_name, latest.tag_name);
  await assert.rejects(f.build({ maxPages: 1 }), /pagination bound/);
  f.pages[1].push(f.pages[0][0]); await assert.rejects(f.build(), /Ambiguous release pagination/);
});

test("invalid newest asset cannot silently downgrade to an older valid release", async () => {
  for (const mutate of [r => { r.assets = []; }, r => { r.assets.push(r.assets[0]); },
    r => { r.assets[0].digest = "sha256:" + "0".repeat(64); }, r => { r.prerelease = true; }]) {
    const f = fixture(); f.release("0.1.0", 1); const newest = f.release("0.2.0", 2); mutate(newest);
    await assert.rejects(f.build());
  }
});

test("public asset redirects remain anonymous and reject unsafe destinations", async () => {
  const f = fixture(); const r = f.release("0.1.0", 1), original = r.assets[0].browser_download_url;
  const cdn = "https://release-assets.githubusercontent.com/fixture?signature=public";
  f.bodies.set(cdn, f.bodies.get(original));
  f.override = url => url === original ? new Response(null, { status: 302, headers: { location: cdn } }) : null;
  await f.build(); assert.equal(f.calls.find(call => call.url === cdn).options.headers.Authorization, undefined);
  for (const target of ["http://127.0.0.1/secret", "https://api.github.com/private", "https://evil.invalid/asset", "https://user:password@github.com/asset"]) {
    f.override = url => url === original ? new Response(null, { status: 302, headers: { location: target } }) : null;
    await assert.rejects(f.build(), /Unsafe public asset redirect/);
  }
});

test("REST digests, byte sizes, checksum filename and exact content are all mandatory", async () => {
  for (const kind of ["size", "bytes", "checksum", "missingDigest"]) {
    const f = fixture(); const r = f.release("0.1.0", 1);
    if (kind === "size") r.assets[0].size++;
    if (kind === "bytes") f.bodies.set(r.assets[0].browser_download_url, Buffer.alloc(r.assets[0].size));
    if (kind === "missingDigest") delete r.assets[0].digest;
    if (kind === "checksum") {
      const body = Buffer.from(`${r.assets[0].digest.slice(7)}  wrong-name.dmg\n`);
      Object.assign(r.assets[1], { size: body.length, digest: digest(body) }); f.bodies.set(r.assets[1].browser_download_url, body);
    }
    await assert.rejects(f.build());
  }
});

test("tag cycles, wrong reference and changing source cannot emit verified metadata", async () => {
  for (const kind of ["cycle", "ref", "changed"]) {
    const f = fixture(); f.release("0.1.0", 1); f.annotate = kind === "cycle";
    f.override = url => {
      if (kind === "cycle" && url === `${API}/git/tags/${TAG}`) return Response.json({ sha: TAG, object: { type: "tag", sha: TAG } });
      if (kind === "ref" && url.includes("/git/ref/")) return Response.json({ ref: "refs/tags/wrong", object: { type: "commit", sha: SHA } });
      if (kind === "changed" && url.includes("/git/ref/") && f.refReads) return Response.json({ ref: "refs/tags/v0.1.0", object: { type: "commit", sha: "c".repeat(40) } });
      return null;
    };
    await assert.rejects(f.build());
  }
});

test("short page advertising another page and API redirects fail closed", async () => {
  const f = fixture(); f.release("0.1.0", 1);
  f.override = url => url.includes("/releases?") ? Response.json(f.releases, { headers: { link: '<https://example.invalid>; rel="next"' } }) : null;
  await assert.rejects(f.build(), /Incomplete release pagination/);
  f.override = url => url.includes("/releases?") ? new Response(null, { status: 302, headers: { location: "https://evil.invalid" } }) : null;
  await assert.rejects(f.build(), /API HTTP 302/);
});

test("network deadline aborts outstanding public verification and never returns a feed", async () => {
  const f = fixture(); const r = f.release("0.1.0", 1);
  f.override = (url, options) => url === r.assets[0].browser_download_url ? new Promise((resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
  }) : null;
  await assert.rejects(f.build({ timeoutMs: 20 }), /deadline exceeded/);
});

test("postflight discovery rejects replacement, deletion and newly published channels", async () => {
  for (const kind of ["asset", "deleted", "newer", "channel", "publication"]) {
    const f = fixture(); const r = f.release("0.1.0", 1);
    let listings = 0;
    f.override = url => {
      if (url.includes("/releases?") && ++listings === 2) {
        if (kind === "asset") r.assets[0].id = 999;
        if (kind === "deleted") r.draft = true;
        if (kind === "newer") f.release("0.2.0", 2);
        if (kind === "channel") f.release("0.2.0-preview.1", 2);
        if (kind === "publication") r.published_at = "2026-09-10T08:00:00Z";
      }
      return null;
    };
    await assert.rejects(f.build(), /changed during verification|No supported published release/);
  }
});

test("postflight discovery ignores download counters but still completes pagination", async () => {
  const f = fixture(); const r = f.release("0.1.0", 1);
  let listings = 0;
  f.override = url => {
    if (url.includes("/releases?") && ++listings === 2) {
      r.assets[0].download_count = 5; r.body = "Edited release description";
    }
    return null;
  };
  assert.equal((await f.build()).releases[0].id, r.id);
  assert.equal(listings, 2);
});

test("publication dates and UTF-8 are validated before feed emission", async () => {
  for (const value of [null, 0, "2026-02-30T12:00:00Z", "2026-09-10", "not a date"]) {
    const f = fixture(); f.release("0.1.0", 1).published_at = value;
    await assert.rejects(f.build());
  }
  const f = fixture(); f.release("0.1.0", 1);
  f.override = url => url.includes("/releases?") ? new Response(Buffer.from([0xff])) : null;
  await assert.rejects(f.build(), /encoded data/);
});
