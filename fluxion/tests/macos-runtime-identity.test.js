"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const source = fs.readFileSync(path.join(__dirname, "../scripts/prepare-macos-runtime.sh"), "utf8");
const helpers = source.slice(source.indexOf("runtime_file_digest() {"), source.indexOf("upstream_identity="));

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fluxion-runtime-identity-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const app = path.join(root, "Firefox.app");
  const files = {
    executable: "Contents/MacOS/firefox",
    info: "Contents/Info.plist",
    application: "Contents/Resources/application.ini",
    platform: "Contents/Resources/platform.ini",
    signature: "Contents/_CodeSignature/CodeResources",
    library: "Contents/MacOS/XUL",
  };
  for (const [name, relative] of Object.entries(files)) {
    files[name] = path.join(app, relative);
    fs.mkdirSync(path.dirname(files[name]), { recursive: true });
    fs.writeFileSync(files[name], name);
  }
  const bin = path.join(root, "bin");
  fs.mkdirSync(bin);
  // Exercise the shipped shell helpers on Linux with only BSD stat's output
  // supplied by this shim. File traversal and content digests remain real.
  fs.writeFileSync(path.join(bin, "stat"), `#!${process.execPath}\n` +
    `const fs=require('node:fs');for(const p of process.argv.slice(4)){const s=fs.lstatSync(p,{bigint:true});console.log(p+':'+s.ino+':'+s.mtimeNs+':'+s.ctimeNs+':'+s.size);}\n`, { mode: 0o755 });
  return {
    files,
    run(code = 'runtime_source_identity "$1" "$2"') {
      return spawnSync("bash", ["-c", `set -euo pipefail\n${helpers}\n${code}`, "fixture", app, files.executable], {
        encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      });
    },
    identity() {
      const result = this.run();
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout.trim(), /^[a-f0-9]{64}$/);
      return result.stdout.trim();
    },
  };
}

test("unchanged upstream runtime reuses the same cache identity", t => {
  const state = fixture(t);
  assert.equal(state.identity(), state.identity());
});

test("replacing Firefox at the same path invalidates the cached application", t => {
  const state = fixture(t);
  const before = state.identity();
  fs.writeFileSync(state.files.executable, "new executable");
  assert.notEqual(state.identity(), before);
});

test("upstream build and signature manifest changes invalidate the cache", t => {
  const state = fixture(t);
  for (const file of [state.files.application, state.files.platform, state.files.signature]) {
    const before = state.identity();
    fs.appendFileSync(file, "new upstream build");
    assert.notEqual(state.identity(), before);
  }
});

test("same-size runtime library changes invalidate the cache even with preserved mtime", t => {
  const state = fixture(t);
  const before = state.identity();
  const stat = fs.statSync(state.files.library);
  fs.writeFileSync(state.files.library, "LIBRARY");
  fs.utimesSync(state.files.library, stat.atime, stat.mtime);
  assert.notEqual(state.identity(), before);
});

test("missing upstream identity files fail instead of reusing a stale runtime", t => {
  const state = fixture(t);
  fs.unlinkSync(state.files.signature);
  const result = state.run();
  assert.equal(result.status, 69);
  assert.match(result.stderr, /Required upstream runtime identity file is missing/);
});

test("runtime metadata reads exact INI sections and strips Windows line endings", t => {
  const state = fixture(t);
  fs.writeFileSync(state.files.application, "[Other]\r\nVersion=wrong\r\n[App]\r\nVersion=155.0\r\nBuildID=20260901000000\r\n");
  const result = state.run('runtime_ini_value "$1/Contents/Resources/application.ini" App Version');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "155.0\n");
});
