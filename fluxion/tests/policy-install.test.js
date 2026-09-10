"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtemp, mkdir, readFile, writeFile, symlink, readdir, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { spawnSync } = require("node:child_process");
const installer = resolve(__dirname, "../scripts/install-update-policy.py");
const template = resolve(__dirname, "../runtime/distribution/policies.json");

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "fluxion-policies-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const distribution = join(root, "distribution");
  await mkdir(distribution);
  return { root, distribution, install: () => spawnSync("python3", [installer, distribution, template], { encoding: "utf8" }) };
}

test("policy installation preserves unrelated enterprise and extension settings", async t => {
  const h = await fixture(t);
  const target = join(h.distribution, "policies.json");
  await writeFile(target, JSON.stringify({ policies: { ExtensionUpdate: true, DNSOverHTTPS: { Enabled: true }, DisableAppUpdate: false } }));
  const result = h.install(); assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(await readFile(target, "utf8")), {
    policies: { ExtensionUpdate: true, DNSOverHTTPS: { Enabled: true }, DisableAppUpdate: true },
  });
  assert.deepEqual(await readdir(h.distribution), ["policies.json"]);
});

test("inherited policy symlinks are replaced without changing upstream files", async t => {
  const h = await fixture(t);
  const upstream = join(h.root, "upstream.json");
  const original = '{"policies":{"ExtensionUpdate":true}}';
  await writeFile(upstream, original);
  const target = join(h.distribution, "policies.json");
  await symlink(upstream, target);
  const result = h.install(); assert.equal(result.status, 0, result.stderr);
  assert.equal(await readFile(upstream, "utf8"), original);
  assert.equal(JSON.parse(await readFile(target, "utf8")).policies.DisableAppUpdate, true);
});

test("malformed inherited policies fail rather than dropping existing controls", async t => {
  const h = await fixture(t);
  const target = join(h.distribution, "policies.json");
  for (const original of ['{"policies":[]}', "malformed"]) {
    await writeFile(target, original);
    assert.notEqual(h.install().status, 0);
    assert.equal(await readFile(target, "utf8"), original);
    assert.deepEqual(await readdir(h.distribution), ["policies.json"]);
  }
});
