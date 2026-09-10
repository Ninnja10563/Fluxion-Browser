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
  fs.writeFileSync(path.join(bin, "ditto"), '#!/bin/sh\nexec cp "$@"\n', { mode: 0o755 });
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

test("default macOS bundle version derives the package base version and retains explicit overrides", t => {
  const state = fixture(t);
  // The existing fixture file is simply an argument path to the actual helper.
  fs.writeFileSync(state.files.executable, JSON.stringify({ version: "0.50.0-preview.7" }));
  const derived = state.run('runtime_app_version "$2"');
  assert.equal(derived.status, 0, derived.stderr);
  assert.equal(derived.stdout, "0.50.0\n");
  const override = state.run('runtime_app_version "$2" 9.8.7');
  assert.equal(override.status, 0, override.stderr);
  assert.equal(override.stdout, "9.8.7\n");
  const invalid = state.run('runtime_app_version "$2" invalid-version');
  assert.equal(invalid.status, 64);
  assert.match(invalid.stderr, /Invalid FLUXION_APP_VERSION/);
});

test("malformed package metadata fails rather than silently branding an app 0.1.0", t => {
  const state = fixture(t);
  for (const content of ["{invalid", "{}", '{"version":null}', '{"version":"0.50.bad"}']) {
    fs.writeFileSync(state.files.executable, content);
    const result = state.run('runtime_app_version "$2"');
    assert.equal(result.status, 64);
    assert.match(result.stderr, /Could not read Fluxion package version/);
  }
});

test("package-only preview changes and explicit bundle version changes invalidate product cache identity", t => {
  const state = fixture(t);
  fs.writeFileSync(state.files.executable, JSON.stringify({ version: "0.50.0-preview.1" }));
  const first = state.run('runtime_product_identity "$2" 0.50.0');
  assert.equal(first.status, 0, first.stderr);
  fs.writeFileSync(state.files.executable, JSON.stringify({ version: "0.50.0-preview.2" }));
  const nextPreview = state.run('runtime_product_identity "$2" 0.50.0');
  const override = state.run('runtime_product_identity "$2" 0.51.0');
  assert.notEqual(first.stdout, nextPreview.stdout);
  assert.notEqual(nextPreview.stdout, override.stdout);
  assert.match(source, /signature=.*runtime_product_identity "\$fluxion_root\/package\.json" "\$app_version"/);
});

for (const updatesDisabled of [true, false]) {
  test(`association branding preserves document and URL handlers; updater removal requires disabled policy=${updatesDisabled}`, t => {
    const state = fixture(t);
    const resources = path.dirname(state.files.application);
    fs.mkdirSync(path.join(resources, "distribution"));
    fs.writeFileSync(path.join(resources, "distribution/policies.json"), JSON.stringify({ policies: { DisableAppUpdate: updatesDisabled } }));
    fs.writeFileSync(path.join(resources, "fluxion.icns"), "verified Fluxion icon bytes");
    for (const name of ["firefox.icns", "document.icns", "fileBookmark.icns"]) fs.writeFileSync(path.join(resources, name), "old inherited artwork");
    fs.writeFileSync(state.files.info, `<?xml version="1.0"?><plist version="1.0"><dict>
      <key>CFBundleURLTypes</key><array><dict><key>CFBundleURLSchemes</key><array><string>http</string><string>https</string><string>file</string></array></dict></array>
      <key>CFBundleDocumentTypes</key><array><dict><key>CFBundleTypeExtensions</key><array><string>html</string><string>pdf</string></array><key>CFBundleTypeIconFile</key><string>document.icns</string></dict></array>
      <key>SMPrivilegedExecutables</key><dict><key>org.mozilla.updater</key><string>Mozilla updater signature</string><key>app.example.other</key><string>unrelated helper</string></dict>
    </dict></plist>`);
    const readInfo = () => JSON.parse(spawnSync("python3", ["-c", "import json,plistlib,sys; print(json.dumps(plistlib.load(open(sys.argv[1],'rb'))))", state.files.info], { encoding: "utf8" }).stdout);
    const before = readInfo();
    const result = state.run('runtime_brand_associations "$1/Contents/Info.plist" "$1/Contents/Resources"');
    assert.equal(result.status, 0, result.stderr);
    const after = readInfo();
    assert.deepEqual(after.CFBundleURLTypes, before.CFBundleURLTypes);
    assert.deepEqual(after.CFBundleDocumentTypes, before.CFBundleDocumentTypes);
    assert.equal(after.SMPrivilegedExecutables["app.example.other"], "unrelated helper");
    assert.equal(Object.hasOwn(after.SMPrivilegedExecutables, "org.mozilla.updater"), !updatesDisabled);
    for (const name of ["firefox.icns", "document.icns", "fileBookmark.icns"]) {
      assert.equal(fs.readFileSync(path.join(resources, name), "utf8"), "verified Fluxion icon bytes");
    }
  });
}
