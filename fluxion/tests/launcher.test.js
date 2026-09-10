"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtemp, mkdir, writeFile, realpath, stat, copyFile, rm } = require("node:fs/promises");
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
  const flags = ["-Wall", "-Wextra", "-Werror"];
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
    assert.deepEqual(launch(args, { FLUXION_PROFILE: profile }).args, ["--profile", profile, ...args]);
    assert.equal((await stat(profile)).mode & 0o777, 0o700);
  });

  await t.test("normal launch creates only the dedicated default profile without remote-disabling flags", async () => {
    const userHome = join(directory, "user home é");
    const profile = join(userHome, "Library/Application Support/Fluxion/Profiles/default");
    assert.deepEqual(launch([], { HOME: userHome, FLUXION_PROFILE: "" }).args, ["--profile", profile]);
    assert.equal((await stat(profile)).mode & 0o777, 0o700);
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
