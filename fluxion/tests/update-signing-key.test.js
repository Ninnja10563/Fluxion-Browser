"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");

test("Sparkle seed public key matches the RFC 8032 Ed25519 vector", async () => {
  const { publicKeyForSeed } = await import("../scripts/provision-update-key.mjs");
  const seed = Buffer.from("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60", "hex");
  assert.equal(Buffer.from(publicKeyForSeed(seed), "base64").toString("hex"),
    "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a");
  assert.throws(() => publicKeyForSeed(Buffer.alloc(31)), /32 bytes/);
});

test("provisioning refuses key replacement and checkout-local backup before generating material", async () => {
  const { provision } = await import("../scripts/provision-update-key.mjs");
  let calls = 0;
  assert.throws(() => provision(path.resolve(__dirname, "../.."), { run() { calls++; } }), /outside/);
  assert.equal(calls, 0);
  assert.throws(() => provision(os.tmpdir(), { run: () => '[{"name":"FLUXION_SPARKLE_PRIVATE_KEY"}]' }), /replace/);
});

test("provisioning keeps a restrictive backup and sends the seed through stdin, not command arguments", async () => {
  const { provision, publicKeyForSeed } = await import("../scripts/provision-update-key.mjs");
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "fluxion-key-test-"));
  try {
    const calls = [];
    const result = provision(parent, { run: (bin, args, options) => { calls.push({ bin, args, options }); return args[1] === "list" ? "[]" : ""; } });
    const content = fs.readFileSync(result.backup, "utf8");
    assert.equal(Buffer.from(content, "base64").length, 32);
    assert.equal(result.publicKey, publicKeyForSeed(Buffer.from(content, "base64")));
    assert.equal(fs.statSync(result.backup).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.dirname(result.backup)).mode & 0o777, 0o700);
    assert.equal(calls[1].options.input, content);
    assert.ok(!calls[1].args.includes(content));
    assert.ok(!JSON.stringify(result).includes(content));
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});
