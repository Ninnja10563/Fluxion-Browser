"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const modulePromise = import("../modules/FluxionRelease.sys.mjs");
const repo = "https://github.com/Ninnja10563/Fluxion-Browser";

function release(version, change = {}) {
  const tag = `v${version}`;
  const name = `Fluxion-${version}-macOS-universal.dmg`;
  return { tag_name: tag, html_url: `${repo}/releases/tag/${tag}`, draft: false,
    prerelease: version.includes("-"), assets: [name, `${name}.sha256`].map(name => ({
      name, state: "uploaded", size: 100, browser_download_url: `${repo}/releases/download/${tag}/${name}`,
    })), ...change };
}

test("numeric semantic ordering selects the highest eligible release regardless of input order", async () => {
  const { FluxionRelease } = await modulePromise;
  const releases = [release("0.50.0-preview.2"), release("0.9.0"), release("0.50.0-preview.10"), release("0.49.9")];
  const result = FluxionRelease.select(releases, "v0.49.0-preview.1");
  assert.equal(result.state, "available");
  assert.equal(result.installed, "0.49.0-preview.1");
  assert.equal(result.latest, "0.50.0-preview.10");
  assert.equal(result.releaseURL, `${repo}/releases/tag/v0.50.0-preview.10`);
  assert.equal(result.downloadURL, `${repo}/releases/download/v0.50.0-preview.10/Fluxion-0.50.0-preview.10-macOS-universal.dmg`);
  assert.equal(result.checksumURL, `${result.downloadURL}.sha256`);
});

test("stable clients ignore previews while preview clients accept stable and preview upgrades", async () => {
  const { select } = (await modulePromise).FluxionRelease;
  assert.equal(select([release("2.0.0-preview.1"), release("1.0.1")], "1.0.0").latest, "1.0.1");
  assert.equal(select([release("1.0.0-preview.999"), release("1.0.0")], "1.0.0-preview.1").latest, "1.0.0");
  assert.equal(select([release("2.0.0-preview.1")], "1.0.0").state, "unavailable");
  assert.equal(select([release("1.0.0-preview.10")], "1.0.0-preview.9").state, "available");
});

test("equal or older releases never expose downgrade download links", async () => {
  const { select } = (await modulePromise).FluxionRelease;
  for (const value of ["1.0.0", "0.99.99", "0.99.99-preview.100"]) {
    const result = select([release(value)], "1.0.0-preview.1");
    if (value === "1.0.0") { assert.equal(result.state, "available"); continue; }
    assert.equal(result.state, "current");
    assert.equal(result.downloadURL, undefined);
    assert.equal(result.checksumURL, undefined);
  }
  assert.equal(select([release("1.0.0")], "1.0.0").state, "current");
  assert.equal(select([release("1.0.0-preview.1")], "1.0.0-preview.1").state, "current");
});

test("malformed version syntax and misleading release flags are rejected", async () => {
  const { select } = (await modulePromise).FluxionRelease;
  for (const value of ["01.0.0", "1.00.0", "1.0", "1.0.0-preview.01", "1.0.0-preview.-1",
    "1.0.0-beta.1", "1.0.0+metadata", "1.0.0 ", "1.0.0\n", "9007199254740992.0.0"]) {
    assert.equal(select([release(value)], "0.1.0-preview.1").state, "unavailable", value);
    assert.equal(select([release("2.0.0")], value).state, "unavailable", value);
  }
  for (const change of [{ draft: true }, { draft: undefined }, { prerelease: true }, { prerelease: undefined }, { tag_name: "2.0.0" }]) {
    assert.equal(select([release("2.0.0", change)], "1.0.0").state, "unavailable");
  }
});

test("repository, tag and asset URLs must be exact canonical official destinations", async () => {
  const { select } = (await modulePromise).FluxionRelease;
  for (const mutate of [
    item => { item.html_url += "?redirect=evil"; },
    item => { item.html_url = item.html_url.replace("github.com", "github.com.evil.test"); },
    item => { item.html_url = item.html_url.replace("Ninnja10563", "other-owner"); },
    item => { item.assets[0].browser_download_url = item.assets[0].browser_download_url.replace("v2.0.0/", "v1.0.0/"); },
    item => { item.assets[1].browser_download_url += "#ignored"; },
    item => { item.assets[0].browser_download_url = "https://user:pass@github.com/Ninnja10563/Fluxion-Browser/download"; },
  ]) {
    const item = release("2.0.0"); mutate(item);
    assert.equal(select([item], "1.0.0").state, "unavailable");
  }
});

test("a complete unambiguous uploaded DMG and checksum pair is required", async () => {
  const { select } = (await modulePromise).FluxionRelease;
  for (const mutate of [
    item => item.assets.pop(),
    item => item.assets.push({ ...item.assets[0] }),
    item => { item.assets[0].name = "Fluxion-2.0.0-macOS-arm64.dmg"; },
    item => { item.assets[1].name = "checksums.txt"; },
    item => { item.assets[0].state = "starter"; },
    item => { item.assets[1].size = 0; },
    item => { item.assets[0].size = -1; },
    item => { item.assets[0].size = "100"; },
    item => { item.assets[0].size = 0.5; },
  ]) {
    const item = release("2.0.0"); mutate(item);
    assert.equal(select([item], "1.0.0").state, "unavailable");
  }
});

test("unsupported platforms and invalid or oversized input are handled within bounds", async () => {
  const { select } = (await modulePromise).FluxionRelease;
  for (const platform of ["Linux", "WINNT", "darwin", ""]) {
    assert.deepEqual(select([release("2.0.0")], "1.0.0", platform), { state: "unsupported", installed: "1.0.0" });
  }
  for (const input of [null, {}, "[]", [null, false, {}, 1], []]) {
    assert.equal(select(input, "1.0.0").state, "unavailable");
  }
  const releases = Array.from({ length: 100 }, () => release("1.0.0"));
  releases.push(release("2.0.0"));
  assert.equal(select(releases, "1.0.0").state, "current");
  assert.equal(select([release("2.0.0", { assets: Array(101).fill(null) })], "1.0.0").state, "unavailable");
});
