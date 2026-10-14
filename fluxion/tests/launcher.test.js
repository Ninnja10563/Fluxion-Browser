"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtemp, mkdir, writeFile, realpath, stat, copyFile, rm, symlink, readFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");

test("compiled application launcher preserves native forwarding and isolates Fluxion", {
  skip: !["linux", "darwin"].includes(process.platform),
}, async t => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "fluxion-launcher-")));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bundle = join(directory, "Fluxion café 流.app");
  const macos = join(bundle, "Contents", "MacOS");
  await mkdir(macos, { recursive: true });
  const executable = join(macos, "Fluxion");
  const sources = [resolve(__dirname, "../packaging/macos/launcher.c")];
  const fingerprint = "abcde12345".repeat(6) + "abcd";
  const flags = ["-Wall", "-Wextra", "-Werror", `-DFLUXION_CHROME_CACHE_ID="${fingerprint}"`];
  if (process.platform === "linux") {
    // Only dyld path discovery is substituted; the actual shipped C main,
    // argument construction, environment setup, mkdir and execv all execute.
    await mkdir(join(directory, "mach-o"));
    await writeFile(join(directory, "mach-o", "dyld.h"),
      "#include <stdint.h>\nint _NSGetExecutablePath(char *, uint32_t *);\n");
    const stub = join(directory, "dyld-stub.c");
    await writeFile(stub, `#include <stdint.h>
#include <unistd.h>
int _NSGetExecutablePath(char *buffer, uint32_t *size) {
  ssize_t length = readlink("/proc/self/exe", buffer, *size);
  if (length < 0 || (uint32_t)length >= *size) return -1;
  buffer[length] = '\\0';
  return 0;
}
`);
    sources.push(stub);
    flags.push("-I", directory);
  }
  const build = spawnSync("cc", [...flags, ...sources, "-o", executable], { encoding: "utf8" });
  assert.ifError(build.error);
  assert.equal(build.status, 0, build.stderr);
  await writeFile(join(macos, "firefox"), `#!${process.execPath}
process.stdout.write(JSON.stringify({
  args: process.argv.slice(2),
  root: process.env.FLUXION_ROOT,
  remotingName: process.env.MOZ_APP_REMOTINGNAME,
  cacheID: process.env.FLUXION_CHROME_CACHE_ID,
  cachePending: process.env.FLUXION_CHROME_CACHE_PENDING,
  pid: process.pid
}));
`, { mode: 0o700 });

  function launch(args, environment) {
    const result = spawnSync(executable, args, {
      encoding: "utf8", timeout: 10000,
      env: { ...process.env, FLUXION_ROOT: "/incorrect/inherited/root",
        MOZ_APP_REMOTINGNAME: "firefox", ...environment },
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    const evidence = JSON.parse(result.stdout);
    assert.equal(evidence.pid, result.pid, "launcher must exec, preserving the application process identity");
    assert.equal(evidence.root, join(bundle, "Contents", "Resources", "fluxion"));
    assert.equal(evidence.remotingName, "fluxion", "inherited Firefox namespace must not override Fluxion");
    return evidence;
  }

  await t.test("private-window arguments and multiple URLs preserve exact order and Unicode paths", async () => {
    const profile = join(directory, "private profiles", "mémoire 流");
    const args = ["--private-window", "https://example.com/caf%C3%A9?q=one&next=two",
      "--new-tab", "file:///tmp/a%20file.html", "https://example.org/#part"];
    assert.deepEqual(launch(args, { FLUXION_PROFILE: profile }).args, ["--profile", profile, "--purgecaches", ...args]);
    assert.equal((await stat(profile)).mode & 0o777, 0o700);
  });

  await t.test("normal launch creates only the dedicated default profile without remote-disabling flags", async () => {
    const userHome = join(directory, "user home é");
    const profile = join(userHome, "Library/Application Support/Fluxion/Profiles/default");
    assert.deepEqual(launch([], { HOME: userHome, FLUXION_PROFILE: "" }).args, ["--profile", profile, "--purgecaches"]);
    assert.equal((await stat(profile)).mode & 0o777, 0o700);
  });

  await t.test("relaunch recreates a deleted default profile without touching neighbouring profiles", async () => {
    const userHome = join(directory, "deleted-profile home");
    const profiles = join(userHome, "Library/Application Support/Fluxion/Profiles");
    const profile = join(profiles, "default");
    const other = join(profiles, "other", "places.sqlite");
    const firefoxData = join(userHome, "Library/Application Support/Firefox/Profiles/existing", "places.sqlite");
    await mkdir(join(profiles, "other"), { recursive: true });
    await mkdir(join(userHome, "Library/Application Support/Firefox/Profiles/existing"), { recursive: true });
    await writeFile(other, "other Fluxion profile");
    await writeFile(firefoxData, "Firefox bookmarks");
    const environment = { HOME: userHome, FLUXION_PROFILE: "" };
    launch([], environment);
    await writeFile(join(profile, ".fluxion-chrome-cache"), `${fingerprint}\n`);
    // Simulate the user's deletion only inside this test's temporary directory.
    await rm(profile, { recursive: true });
    const evidence = launch([], environment);
    assert.deepEqual(evidence.args, ["--profile", profile, "--purgecaches"]);
    assert.equal(evidence.cachePending, "1");
    assert.equal((await stat(profile)).mode & 0o777, 0o700);
    assert.equal(await readFile(other, "utf8"), "other Fluxion profile");
    assert.equal(await readFile(firefoxData, "utf8"), "Firefox bookmarks");
    await assert.rejects(stat(join(profile, ".fluxion-chrome-cache")), { code: "ENOENT" });
  });

  await t.test("relaunch recreates a deleted custom profile and its missing parents", async () => {
    const parent = join(directory, "deleted custom profiles");
    const profile = join(parent, "mémoire 流");
    launch([], { FLUXION_PROFILE: profile });
    await rm(parent, { recursive: true });
    assert.deepEqual(launch([], { FLUXION_PROFILE: profile }).args,
      ["--profile", profile, "--purgecaches"]);
    assert.equal((await stat(profile)).mode & 0o777, 0o700);
  });

  await t.test("a file at the profile path is reported, never replaced or passed to Gecko", async () => {
    const profile = join(directory, "profile-is-a-file");
    await writeFile(profile, "preserve this file");
    const result = spawnSync(executable, [], {
      encoding: "utf8", timeout: 10000,
      env: { ...process.env, FLUXION_PROFILE: profile },
    });
    assert.ifError(result.error);
    assert.equal(result.status, 73);
    assert.equal(result.stdout, "", "runtime must not start with an invalid profile directory");
    assert.match(result.stderr, /could not create or open its profile directory/);
    assert.ok(result.stderr.includes(profile));
    assert.equal(await readFile(profile, "utf8"), "preserve this file");
  });

  await t.test("only exact acknowledged chrome reuses caches, preserving the profile and user arguments", async () => {
    const profile = join(directory, "existing profile");
    await mkdir(profile);
    const marker = join(profile, ".fluxion-chrome-cache");
    const history = join(profile, "places.sqlite");
    await writeFile(history, "do not touch existing data");
    const cold = launch([], { FLUXION_PROFILE: profile, FLUXION_CHROME_CACHE_ID: "inherited", FLUXION_CHROME_CACHE_PENDING: "0" });
    assert.equal(cold.cacheID, fingerprint);
    assert.equal(cold.cachePending, "1");
    await assert.rejects(stat(marker), { code: "ENOENT" }, "exec alone must not acknowledge invalidation");
    await writeFile(marker, `${fingerprint}\n`);
    const warm = launch(["https://example.org/"], { FLUXION_PROFILE: profile });
    assert.equal(warm.cachePending, "0");
    assert.deepEqual(warm.args, ["--profile", profile, "https://example.org/"]);
    for (const stale of ["0".repeat(64) + "\n", fingerprint, fingerprint + "\nextra", "bad\n"]) {
      await writeFile(marker, stale);
      assert.equal(launch([], { FLUXION_PROFILE: profile }).cachePending, "1");
      assert.equal(await readFile(marker, "utf8"), stale, "launcher never rewrites marker before Gecko accepts profile");
    }
    await rm(marker);
    const outside = join(directory, "outside-marker");
    await writeFile(outside, `${fingerprint}\n`);
    await symlink(outside, marker);
    assert.equal(launch([], { FLUXION_PROFILE: profile }).cachePending, "1", "do not follow profile stamp symlinks");
    assert.equal(await readFile(outside, "utf8"), `${fingerprint}\n`);
    assert.equal(await readFile(history, "utf8"), "do not touch existing data");
  });

  await t.test("an executable outside its bundle refuses to invoke a runtime", async () => {
    const misplaced = join(directory, "misplaced-launcher");
    await copyFile(executable, misplaced);
    const result = spawnSync(misplaced, [], { encoding: "utf8", timeout: 10000 });
    assert.ifError(result.error);
    assert.equal(result.status, 69);
    assert.match(result.stderr, /must run from its application bundle/);
    assert.equal(result.stdout, "");
  });
});
