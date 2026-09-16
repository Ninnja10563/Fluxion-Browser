const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const pinned = require("../runtime/sparkle-lock.json");
test("Sparkle download admits only reviewed source and byte identity, never overwrites existing files", async t => {
  const { downloadSparkle } = await import("../scripts/download-sparkle.mjs");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "fluxion-sparkle-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const bytes = Buffer.from("reviewed archive"), lock = { ...pinned, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  const target = path.join(root, "archive.xz");
  const fetch = async (_url, options) => {
    assert.equal(options.credentials, "omit"); assert.equal(options.redirect, "manual");
    return new Response(bytes);
  };
  await downloadSparkle(lock, target, fetch);
  assert.deepEqual(await fs.readFile(target), bytes);
  await assert.rejects(downloadSparkle(lock, target, fetch), /EEXIST/);
  assert.deepEqual(await fs.readdir(root), ["archive.xz"]);
  for (const bad of [Buffer.from("wrong"), Buffer.alloc(bytes.length + 1)]) {
    await assert.rejects(downloadSparkle(lock, path.join(root, "bad"), async () => new Response(bad)), /locked size|reviewed digest/);
    assert.deepEqual(await fs.readdir(root), ["archive.xz"]);
  }
  let calls = 0;
  await assert.rejects(downloadSparkle(lock, path.join(root, "bad"), async () => {
    calls++; return new Response(null, { status: 302, headers: { location: "https://evil.invalid/archive" } });
  }), /Unsafe/);
  assert.equal(calls, 1);
  await assert.rejects(downloadSparkle({ ...lock, url: "https://evil.invalid" }, target, fetch), /Invalid/);
});
