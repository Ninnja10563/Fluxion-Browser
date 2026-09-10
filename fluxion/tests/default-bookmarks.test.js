"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtemp, mkdir, readFile, writeFile, symlink, rm, access } = require("node:fs/promises");
const { spawnSync } = require("node:child_process");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");
const helper = resolve(__dirname, "../scripts/install-default-bookmarks.py");
const asset = resolve(__dirname, "../assets/default-bookmarks.html");
const entry = "chrome/browser/content/browser/default-bookmarks.html";

async function fixture(t, entries = [entry]) {
  const directory = await mkdtemp(join(tmpdir(), "fluxion-default-bookmarks-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, "browser"));
  const archive = join(directory, "browser", "omni.ja");
  const built = spawnSync("python3", ["-c", "import sys,json,zipfile\nwith zipfile.ZipFile(sys.argv[1], 'w') as z:\n for name in json.loads(sys.argv[2]): z.writestr(name, '<html>Original defaults</html>')\n z.writestr('unrelated/chrome.js', 'unaltered runtime')", archive, JSON.stringify(entries)], { encoding: "utf8" });
  assert.equal(built.status, 0, built.stderr);
  return { directory, archive, install: () => spawnSync("python3", [helper, directory, asset], { encoding: "utf8" }) };
}

test("default branding installs a single local override without changing any Gecko archive bytes", async t => {
  const f = await fixture(t), before = await readFile(f.archive);
  const installed = f.install(); assert.equal(installed.status, 0, installed.stderr);
  assert.deepEqual(await readFile(f.archive), before);
  assert.equal(await readFile(join(f.directory, "fluxion-defaults/chrome.manifest"), "utf8"),
    "override chrome://browser/content/default-bookmarks.html default-bookmarks.html\n");
  assert.deepEqual(await readFile(join(f.directory, "fluxion-defaults/default-bookmarks.html")), await readFile(asset));
  assert.equal(f.install().status, 0, "reinstalling the managed files is idempotent");
});

test("unknown or ambiguous upstream resource layouts fail before installing an override", async t => {
  for (const entries of [["new/location/default-bookmarks.html"], [entry, entry]]) {
    const f = await fixture(t, entries), before = await readFile(f.archive);
    const result = f.install(); assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Unsupported Gecko/);
    assert.deepEqual(await readFile(f.archive), before);
    await assert.rejects(access(join(f.directory, "fluxion-defaults")));
  }
});

test("a symlinked upstream archive is read-only and a symlinked output is refused", async t => {
  const f = await fixture(t);
  const upstream = join(f.directory, "upstream.ja"), bytes = await readFile(f.archive);
  await writeFile(upstream, bytes); await rm(f.archive); await symlink(upstream, f.archive);
  assert.equal(f.install().status, 0);
  assert.deepEqual(await readFile(upstream), bytes);
  const target = join(f.directory, "fluxion-defaults/default-bookmarks.html");
  const userFile = join(f.directory, "user-bookmarks.html");
  await writeFile(userFile, "User bookmarks must stay unchanged");
  await rm(target); await symlink(userFile, target);
  const result = f.install(); assert.notEqual(result.status, 0);
  assert.match(result.stderr, /non-regular/);
  assert.equal(await readFile(userFile, "utf8"), "User bookmarks must stay unchanged");
});
