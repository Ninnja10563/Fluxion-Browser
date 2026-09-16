"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { spawnSync } = require("node:child_process");
const builder = fs.readFileSync(path.join(__dirname, "../scripts/prepare-macos-runtime.sh"), "utf8");
const helper = builder.slice(builder.indexOf("runtime_build_iconset() {"), builder.indexOf("runtime_brand_associations() {"));
const artwork = path.resolve(__dirname, "../assets/app-icons/app-icon-1024.png");
const expected = { "icon_16x16.png": 16, "icon_16x16@2x.png": 32, "icon_32x32.png": 32,
  "icon_32x32@2x.png": 64, "icon_128x128.png": 128, "icon_128x128@2x.png": 256,
  "icon_256x256.png": 256, "icon_256x256@2x.png": 512, "icon_512x512.png": 512, "icon_512x512@2x.png": 1024 };
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fluxion-user-icon-"));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  const iconset = path.join(root, "Fluxion.iconset"), log = path.join(root, "calls");
  const shim = `sips() {
    if [[ "$1" == -g ]]; then
      printf 'format: %s\\npixelWidth: %s\\npixelHeight: %s\\n' "$FORMAT" "$WIDTH" "$HEIGHT"
    else
      [[ "$1" == -z && "$2" == "$3" && "$5" == --out && "$4" == "$SOURCE" ]] || return 2
      printf '%s %s\\n' "$2" "$6" >> "$LOG"
      [[ "$2" != "$FAIL_SIZE" ]] || return 1
      cp "$4" "$6"
    fi
  }
  ditto() { cp "$@"; }
  `;
  return { iconset, log, run(extra = {}, source = artwork) {
    return spawnSync("bash", ["-c", `set -euo pipefail\n${shim}\n${helper}\nruntime_build_iconset "$1" "$2"`, "fixture", source, iconset], {
      encoding: "utf8", env: { ...process.env, SOURCE: artwork, LOG: log, FORMAT: "png", WIDTH: "1024", HEIGHT: "1024", FAIL_SIZE: "", ...extra },
    });
  } };
}

test("the supplied 1024PNG is the sole macOS source and generates all ten required variants", t => {
  const bytes = fs.readFileSync(artwork);
  assert.deepEqual(bytes.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.equal(bytes.readUInt32BE(16), 1024); assert.equal(bytes.readUInt32BE(20), 1024);
  const f = fixture(t), result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(fs.readdirSync(f.iconset).sort(), Object.keys(expected).sort());
  const calls = fs.readFileSync(f.log, "utf8").trim().split("\n").map(line => line.split(" "));
  assert.equal(calls.length, 9);
  for (const [size, file] of calls) assert.equal(Number(size), expected[path.basename(file)]);
  assert.deepEqual(fs.readFileSync(path.join(f.iconset, "icon_512x512@2x.png")), bytes, "largest variant preserves exact supplied bytes");
  assert.match(builder, /runtime_build_iconset "\$fluxion_root\/assets\/app-icons\/app-icon-1024\.png"/);
  assert.doesNotMatch(builder, /qlmanage|assets\/fluxion\.svg/);
  assert.match(builder, /runtime_brand_associations "\$info" "\$resources"/);
});

test("missing, wrong-format, or incorrectly sized artwork fails before producing an iconset", t => {
  for (const extra of [{ FORMAT: "jpeg" }, { WIDTH: "512" }, { HEIGHT: "2048" }]) {
    const f = fixture(t), result = f.run(extra);
    assert.notEqual(result.status, 0);
    assert.equal(fs.existsSync(f.iconset), false);
  }
  const f = fixture(t);
  assert.notEqual(f.run({}, path.join(f.iconset, "missing.png")).status, 0);
  assert.equal(fs.existsSync(f.iconset), false);
});

test("native resizing failure aborts packaging instead of completing with inherited artwork", t => {
  const f = fixture(t), result = f.run({ FAIL_SIZE: "128" });
  assert.notEqual(result.status, 0);
  assert.equal(fs.existsSync(path.join(f.iconset, "icon_512x512@2x.png")), false);
  assert.match(builder, /refusing a Firefox-branded build/);
});
