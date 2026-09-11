"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const feedModule = import("../modules/FluxionReleaseFeed.sys.mjs");
const NOW = Date.parse("2026-09-11T12:00:00.000Z"), DAY = 86400000;
const iso = value => new Date(value).toISOString();
function release(version = "0.64.0-preview.1", id = 1) {
  const root = "https://github.com/Ninnja10563/Fluxion-Browser";
  const name = `Fluxion-${version}-macOS-universal.dmg`;
  return { id, tag_name: `v${version}`, draft: false, prerelease: version.includes("-preview."),
    html_url: `${root}/releases/tag/v${version}`, published_at: iso(NOW - DAY),
    sourceCommit: "a".repeat(40), verifiedAt: iso(NOW - 1000),
    assets: [name, `${name}.sha256`].map((assetName, index) => ({ id: id * 10 + index,
      name: assetName, state: "uploaded", size: index ? 110 : 200000000,
      digest: `sha256:${String(index + 1).repeat(64)}`,
      browser_download_url: `${root}/releases/download/v${version}/${assetName}` })) };
}
function feed() {
  return { schemaVersion: 1, repository: "Ninnja10563/Fluxion-Browser", generatedAt: iso(NOW),
    expiresAt: iso(NOW + DAY), releases: [release(), release("0.63.0", 2)] };
}
async function validate(value, now = NOW) { return (await feedModule).FluxionReleaseFeed.validate(value, now); }
test("valid stable/preview manifest preserves canonical metadata without mutating or aliasing input", async () => {
  const input = feed(), before = JSON.stringify(input);
  const result = await validate(input);
  assert.deepEqual(result, { releases: input.releases, generatedAt: input.generatedAt, expiresAt: input.expiresAt });
  assert.equal(JSON.stringify(input), before);
  result.releases[0].assets[0].digest = "changed";
  assert.equal(JSON.stringify(input), before);
  input.releases = [release("0.0.0-preview.0")];
  assert.ok(await validate(input), "Lowest supported version is valid metadata");
});
test("freshness accepts exact permitted limits but rejects expiry, future skew and stale verification", async () => {
  for (const mutate of [
    f => { f.expiresAt = iso(NOW); },
    f => { f.expiresAt = iso(NOW + 7 * DAY + 1); },
    f => { f.generatedAt = iso(NOW + 300001); },
    f => { f.generatedAt = iso(NOW - 8 * DAY); f.expiresAt = iso(NOW - DAY); },
    f => { f.releases[0].published_at = iso(NOW - 9 * DAY); f.releases[0].verifiedAt = iso(NOW - 7 * DAY - 1); },
    f => { f.releases[0].verifiedAt = iso(NOW + 1); },
    f => { f.releases[0].published_at = iso(NOW); },
  ]) { const input = feed(); mutate(input); assert.equal(await validate(input), null); }
  const boundary = feed(); boundary.generatedAt = iso(NOW + 300000);
  boundary.expiresAt = iso(NOW + 300000 + 7 * DAY);
  boundary.releases[0].published_at = iso(NOW - 8 * DAY);
  boundary.releases[0].verifiedAt = iso(NOW + 300000 - 7 * DAY);
  assert.ok(await validate(boundary));
});
test("timestamps must be real canonical UTC ISO values throughout the feed", async () => {
  for (const invalid of ["2026-09-11T12:00:00Z", "2026-09-11T13:00:00.000+01:00", "2026-02-30T12:00:00.000Z", "not a date", 0, null]) {
    for (const field of ["generatedAt", "expiresAt", "published_at", "verifiedAt"]) {
      const input = feed(); (field.includes("At") && field !== "verifiedAt" ? input : input.releases[0])[field] = invalid;
      assert.equal(await validate(input), null, field);
    }
  }
});
test("a still-unexpired feed cannot extend asset verification beyond seven days", async () => {
  const input = feed(); input.generatedAt = iso(NOW - DAY); input.expiresAt = iso(NOW + DAY);
  for (const entry of input.releases) {
    entry.published_at = iso(NOW - 8 * DAY); entry.verifiedAt = iso(NOW - 2 * DAY);
  }
  input.releases[0].verifiedAt = iso(NOW - 7 * DAY);
  assert.ok(await validate(input));
  input.releases[0].verifiedAt = iso(NOW - 7 * DAY - 1);
  assert.equal(await validate(input), null);
});
test("duplicate IDs, tags, channels and missing or extra entries reject the entire feed", async () => {
  for (const mutate of [
    f => { f.releases = []; }, f => { f.releases.push(release("0.62.0", 3)); },
    f => { f.releases[1].id = f.releases[0].id; },
    f => { f.releases[1] = release("0.65.0-preview.1", 2); },
    f => { f.releases[1] = release(f.releases[0].tag_name.slice(1), 2); },
    f => { f.releases[1].assets[0].id = f.releases[0].assets[0].id; },
    f => { f.releases[0].assets[1].id = f.releases[0].assets[0].id; },
    f => { f.releases[0].assets.pop(); }, f => { f.releases[0].assets.push({ ...f.releases[0].assets[0], id: 999 }); },
  ]) { const input = feed(); mutate(input); assert.equal(await validate(input), null); }
});
test("foreign URLs, malformed versions, drafts and mismatched channel flags never get partial salvage", async () => {
  for (const mutate of [
    f => { f.repository = "attacker/Fluxion-Browser"; }, f => { f.schemaVersion = 2; },
    f => { f.releases[0].html_url += "?source=feed"; },
    f => { f.releases[0].assets[0].browser_download_url = "https://evil.invalid/browser.dmg"; },
    f => { f.releases[0].assets[1].name += ".exe"; },
    f => { f.releases[0].tag_name = "v0.64.0-beta.1"; },
    f => { f.releases[0].draft = true; }, f => { delete f.releases[0].draft; },
    f => { f.releases[0].prerelease = false; },
    f => { f.releases[0].assets[0].state = "new"; },
  ]) { const input = feed(); mutate(input); assert.equal(await validate(input), null); }
});
test("IDs, sizes, source commits and digests require exact bounded types", async () => {
  for (const invalid of [0, -1, 1.5, "12", Number.MAX_SAFE_INTEGER + 1, NaN]) {
    for (const field of ["releaseId", "assetId", "size"]) {
      const input = feed();
      if (field === "releaseId") input.releases[0].id = invalid;
      else input.releases[0].assets[0][field === "assetId" ? "id" : "size"] = invalid;
      assert.equal(await validate(input), null);
    }
  }
  for (const digest of ["sha256:AB".padEnd(71, "A"), `sha512:${"a".repeat(64)}`, `sha256:${"a".repeat(63)}`, null]) {
    const input = feed(); input.releases[0].assets[0].digest = digest; assert.equal(await validate(input), null);
  }
  for (const commit of ["A".repeat(40), "a".repeat(39), "main", null]) {
    const input = feed(); input.releases[0].sourceCommit = commit; assert.equal(await validate(input), null);
  }
  assert.equal(await validate(feed(), NaN), null);
});
