"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const script = path.resolve(__dirname, "../scripts/package-macos-dmg.sh");

test("packaging parses with the platform system bash, including macOS bash 3", () => {
  const result = spawnSync("/bin/bash", ["-n", script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});

function fixture(t, release = "0.12.0-preview.2") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fluxion-dmg-version-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const app = path.join(root, "Older Fluxion.app"), output = path.join(root, "output"), bin = path.join(root, "bin");
  const settings = path.join(app, "Contents/Resources/fluxion/chrome/fluxion-settings.js");
  const plist = path.join(app, "Contents/Info.plist"), log = path.join(root, "tools.log");
  fs.mkdirSync(path.dirname(settings), { recursive: true });
  fs.mkdirSync(path.join(app, "Contents/MacOS"), { recursive: true });
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(app, "Contents/MacOS/Fluxion"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  let failedTool = "";
  const metadata = (version = release, overrides = {}) => {
    const base = version.split("-")[0];
    const [major, minor, patch] = base.split(".").map(Number);
    const signed = overrides.signed ?? (major > 0 || minor > 70 || minor === 70 && patch > 0);
    const bundle = signed ? version.replace("-preview.", "b") : base;
    fs.writeFileSync(settings, `(() => {\n const PRODUCT_VERSION = "${overrides.product || base}";\n const PRODUCT_RELEASE = "${version}";\n})();\n`);
    fs.writeFileSync(plist, `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict>
      <key>CFBundleShortVersionString</key><string>${overrides.short || base}</string>
      <key>CFBundleVersion</key><string>${overrides.bundle || bundle}</string>
      ${signed ? `<key>FluxionReleaseVersion</key><string>${overrides.fluxion || version}</string>` : ""}</dict></plist>`);
  };
  metadata();
  fs.writeFileSync(path.join(bin, "uname"), "#!/bin/sh\nprintf 'Darwin\\n'\n", { mode: 0o755 });
  const shim = `#!${process.execPath}
const fs = require('node:fs'), path = require('node:path');
const name = path.basename(process.argv[1]), args = process.argv.slice(2);
fs.appendFileSync(process.env.FLUXION_PACKAGE_TEST_LOG, JSON.stringify({name,args})+'\\n');
if(process.env.FLUXION_PACKAGE_FAILED_TOOL===name) process.exit(1);
if(name==='lipo') console.log('arm64 x86_64');
if(name==='ditto') fs.cpSync(args[0],args[1],{recursive:true});
if(name==='xcrun' && args.some(a=>a.endsWith('/dmg-background.swift'))) { for(const file of ['background.png','background@2x.png']) fs.writeFileSync(path.join(args.at(-1),file),'synthetic artwork'); }
if(name==='screencapture') fs.writeFileSync(args.at(-1),'synthetic capture');
if(name==='tiffutil') fs.writeFileSync(args.at(-1),'synthetic Retina artwork');
if(name==='osascript') { fs.writeFileSync(path.join(args.at(-1),'.DS_Store'),'synthetic Finder metadata'); console.log('42'); }
if(name==='hdiutil') {
  if(['create','convert'].includes(args[0])) fs.writeFileSync(args.at(-1),'synthetic disk image for shell control-flow testing');
  if(args[0]==='attach') {
    const calls=fs.readFileSync(process.env.FLUXION_PACKAGE_TEST_LOG,'utf8').trim().split('\\n').map(JSON.parse);
    const stage=path.dirname(calls.find(c=>c.name==='ditto').args[1]);
    fs.cpSync(stage,args[args.indexOf('-mountpoint')+1],{recursive:true,verbatimSymlinks:true});
  }
}
`;
  for (const tool of ["lipo", "codesign", "ditto", "hdiutil", "xcrun", "tiffutil", "osascript", "screencapture"]) fs.writeFileSync(path.join(bin, tool), shim, { mode: 0o755 });
  return { root, app, output, settings, plist, metadata,
    failTool(name) { failedTool = name; },
    calls: () => fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").map(JSON.parse) : [],
    run: (...args) => spawnSync("bash", [script, "--app", app, "--output-dir", output, ...args], {
      cwd: root, encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FLUXION_PACKAGE_TEST_LOG: log,
        FLUXION_PACKAGE_FAILED_TOOL: failedTool },
    }),
  };
}

test("default DMG release comes from supplied older app, independently of checkout and working directory", t => {
  const f = fixture(t), result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.ok(fs.existsSync(path.join(f.output, "Fluxion-0.12.0-preview.2-macOS-universal.dmg")));
  assert.ok(fs.existsSync(path.join(f.output, "Fluxion-0.12.0-preview.2-macOS-universal.dmg.sha256")));
  const image = f.calls().find(call => call.name === "hdiutil");
  assert.equal(image.args[image.args.indexOf("-volname") + 1], "Fluxion 0.12.0-preview.2");
  assert.deepEqual(f.calls().filter(call => call.name === "hdiutil").map(call => call.args[0]),
    ["create", "attach", "detach", "convert", "attach", "detach"]);
  const mounts = f.calls().filter(call => call.name === "hdiutil" && call.args[0] === "attach");
  assert.equal(mounts[0].args.includes("-readonly"), false);
  assert.equal(mounts[1].args.includes("-readonly"), true);
});

test("explicit current release packages the exact signed native beta version and full release marker", t => {
  const release = require("../package.json").version, f = fixture(t, release);
  const result = f.run("--version", release);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(fs.existsSync(path.join(f.output, `Fluxion-${release}-macOS-universal.dmg`)));
  assert.ok(fs.readFileSync(f.plist, "utf8").includes(`<string>${release.replace("-preview.", "b")}</string>`));
  assert.ok(f.calls().some(call => call.name === "lipo"));
  assert.ok(f.calls().some(call => call.name === "codesign" && call.args.join(" ").startsWith("--verify --deep --strict")));
});

test("layout failure does not promote a DMG or overwrite a prior package and detaches its owned image", t => {
  const f = fixture(t); f.failTool("osascript");
  fs.mkdirSync(f.output);
  const previous = path.join(f.output, "Fluxion-0.12.0-preview.2-macOS-universal.dmg");
  fs.writeFileSync(previous, "previous verified image");
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.equal(fs.readFileSync(previous, "utf8"), "previous verified image");
  assert.deepEqual(fs.readdirSync(f.output), [path.basename(previous)]);
  assert.ok(f.calls().some(call => call.name === "hdiutil" && call.args[0] === "detach"));
  assert.equal(f.calls().some(call => call.name === "hdiutil" && call.args[0] === "convert"), false);
});

test("DMG art uses native type and real Finder icons, with reopened read-only layout verification", () => {
  const artwork = fs.readFileSync(path.resolve(__dirname, "../packaging/macos/dmg-background.swift"), "utf8");
  const layout = fs.readFileSync(path.resolve(__dirname, "../packaging/macos/dmg-layout.applescript"), "utf8");
  const helper = fs.readFileSync(path.resolve(__dirname, "../scripts/style-macos-dmg.sh"), "utf8");
  assert.match(artwork, /for scale in \[1, 2\]/);
  assert.match(artwork, /NSFont\.systemFont/);
  assert.match(artwork, /Drag Fluxion to Applications/);
  assert.match(layout, /\{180, 212\}/); assert.match(layout, /\{460, 212\}/);
  assert.match(helper, /verify-dmg-background\.swift/);
  assert.match(helper, /screencapture -x -o -l/);
  assert.match(helper, /attach_options\+=\(-readonly\)/);
  assert.match(helper, /codesign --verify --deep --strict/);
  assert.doesNotMatch(helper, /detach -force/);
});

test("signed native version, display release, and marker must agree before any packaging tools run", t => {
  for (const overrides of [{ bundle: "0.70.1" }, { bundle: "0.70.1b2" }, { short: "0.70.1b1" },
    { fluxion: "0.70.1-preview.2" }, { signed: false }]) {
    const f = fixture(t, "0.70.1-preview.1"); f.metadata("0.70.1-preview.1", overrides);
    const result = f.run();
    assert.notEqual(result.status, 0, JSON.stringify(overrides));
    assert.deepEqual(f.calls(), []); assert.equal(fs.existsSync(f.output), false);
  }
});

test("signed prerelease mapping enforces Apple's 1 through 255 beta bound", t => {
  for (const release of ["0.70.1-preview.0", "0.70.1-preview.256", "0.70.1-preview.01"]) {
    const f = fixture(t, release), result = f.run();
    assert.notEqual(result.status, 0, release); assert.deepEqual(f.calls(), []);
  }
  const f = fixture(t, "0.70.1-preview.255"), result = f.run();
  assert.equal(result.status, 0, result.stderr);
});

test("same-base but wrong preview or stable release is rejected before expensive tools or output creation", t => {
  for (const version of ["0.12.0-preview.1", "0.12.0", "0.13.0-preview.2", "../outside"]) {
    const f = fixture(t), result = f.run("--version", version);
    assert.notEqual(result.status, 0, version);
    assert.deepEqual(f.calls(), []); assert.equal(fs.existsSync(f.output), false);
  }
});

test("metadata conflicts and omissions preserve existing artifacts without invoking packaging tools", t => {
  for (const mutate of [
    f => f.metadata("0.12.0-preview.2", { short: "0.11.0" }),
    f => f.metadata("0.12.0-preview.2", { bundle: "0.11.0" }),
    f => f.metadata("0.12.0-preview.2", { product: "0.11.0" }),
    f => fs.rmSync(f.settings),
    f => fs.appendFileSync(f.settings, '\nconst PRODUCT_RELEASE = "0.12.0-preview.2";\n'),
    f => fs.appendFileSync(f.settings, ' const PRODUCT_RELEASE = "0.12.0-preview.2";'),
    f => fs.writeFileSync(f.plist, "not a plist"),
    f => f.metadata("00.12.0-preview.2"),
  ]) {
    const f = fixture(t); mutate(f);
    fs.mkdirSync(f.output); fs.writeFileSync(path.join(f.output, "keep.dmg"), "previous valid image");
    const result = f.run();
    assert.notEqual(result.status, 0); assert.deepEqual(f.calls(), []);
    assert.deepEqual(fs.readdirSync(f.output), ["keep.dmg"]);
    assert.equal(fs.readFileSync(path.join(f.output, "keep.dmg"), "utf8"), "previous valid image");
  }
});

test("explicit empty or missing version never silently defaults to the app release", t => {
  for (const args of [["--version"], ["--version", ""]]) {
    const f = fixture(t), result = f.run(...args);
    assert.equal(result.status, 64);
    assert.deepEqual(f.calls(), []); assert.equal(fs.existsSync(f.output), false);
  }
});

test("stable app releases are inferred without requiring a preview suffix", t => {
  const f = fixture(t, "1.2.3"), result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.ok(fs.existsSync(path.join(f.output, "Fluxion-1.2.3-macOS-universal.dmg")));
});
