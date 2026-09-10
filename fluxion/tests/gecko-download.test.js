"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtemp, readFile, readdir, rm, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { createHash } = require("node:crypto");
const original = require("../runtime/gecko-lock.json");

test("runtime lock binds the version, archive origin and digest", async () => {
  const { validateLock } = await import("../scripts/download-gecko.mjs");
  assert.equal(validateLock(original), original);
  for (const change of [{ version: "latest" }, { url: original.url.replace("archive.mozilla.org", "example.com") },
    { sha256: "invalid" }, { version: "155.0.2" }, { checksumsUrl: "https://example.com/SHA256SUMS" }]) {
    assert.throws(() => validateLock({ ...original, ...change }));
  }
});

test("only verified runtime bytes become visible at the destination", async t => {
  const { downloadRuntime } = await import("../scripts/download-gecko.mjs");
  const directory = await mkdtemp(join(tmpdir(), "fluxion-download-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bytes = Buffer.from("controlled runtime bytes");
  const lock = { ...original, sha256: createHash("sha256").update(bytes).digest("hex") };
  const file = join(directory, "runtime.dmg");
  const result = await downloadRuntime(lock, file, async (url, options) => {
    assert.equal(url, original.url); assert.equal(options.redirect, "error");
    return new Response(bytes);
  });
  assert.equal(result.bytes, bytes.length);
  assert.deepEqual(await readFile(file), bytes);
  assert.deepEqual(await readdir(directory), ["runtime.dmg"]);
});

test("checksum and HTTP failures leave no installable file or partial download", async t => {
  const { downloadRuntime } = await import("../scripts/download-gecko.mjs");
  const directory = await mkdtemp(join(tmpdir(), "fluxion-download-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const response of [new Response("tampered"), new Response("missing", { status: 404 })]) {
    await assert.rejects(downloadRuntime(original, join(directory, "runtime.dmg"), async () => response));
    assert.deepEqual(await readdir(directory), []);
  }
});

test("verified downloads never overwrite an existing runtime", async t => {
  const { downloadRuntime } = await import("../scripts/download-gecko.mjs");
  const directory = await mkdtemp(join(tmpdir(), "fluxion-download-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "runtime.dmg");
  await writeFile(file, "existing");
  const bytes = Buffer.from("new");
  const lock = { ...original, sha256: createHash("sha256").update(bytes).digest("hex") };
  await assert.rejects(downloadRuntime(lock, file, async () => new Response(bytes)), { code: "EEXIST" });
  assert.equal(await readFile(file, "utf8"), "existing");
  assert.deepEqual(await readdir(directory), ["runtime.dmg"]);
});
