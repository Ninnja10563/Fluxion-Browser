"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { spawnSync } = require("node:child_process");
const os = require("node:os");
const source = fs.readFileSync(path.join(__dirname, "../modules/FluxionChromeCache.sys.mjs"), "utf8");
function fixture({ pending = "1", id = "a".repeat(64), failure = false } = {}) {
  const writes = [];
  const context = vm.createContext({
    Services: { env: { get: key => key.endsWith("PENDING") ? pending : id } },
    PathUtils: { profileDir: "/actual/locked-profile", join: (...parts) => parts.join("/") },
    IOUtils: { writeUTF8: async (...args) => { writes.push(args); if (failure) throw Error("read-only profile"); } },
  });
  vm.runInContext(source.replace("export async function", "async function"), context);
  return { writes, run: () => context.acknowledgeChromeCache() };
}
test("chrome cache acknowledgment uses actual locked profile and atomic marker", async () => {
  const f = fixture();
  assert.equal(await f.run(), true);
  assert.deepEqual(JSON.parse(JSON.stringify(f.writes)), [["/actual/locked-profile/.fluxion-chrome-cache", "a".repeat(64) + "\n", {
    tmpPath: "/actual/locked-profile/.fluxion-chrome-cache.tmp",
  }]]);
});
test("warm starts, absent launcher identity and malformed identities never write", async () => {
  for (const options of [{ pending: "0" }, { pending: "" }, { id: "" }, { id: "x".repeat(64) }, { id: "a".repeat(65) }]) {
    const f = fixture(options); assert.equal(await f.run(), false); assert.equal(f.writes.length, 0);
  }
});
test("failed atomic stamp write is not acknowledged and can be retried next launch", async () => {
  const f = fixture({ failure: true });
  await assert.rejects(f.run(), /read-only profile/);
});

test("upgrade reproducer only reverses exact pinned brand resources in an owned disposable app", () => {
  const script = path.join(__dirname, "../scripts/seed-branding-cache-fixture.py");
  const result = spawnSync("python3", ["-c", `
import importlib.util,io,json,pathlib,tempfile,zipfile
s=importlib.util.spec_from_file_location('fixture',${JSON.stringify(script)})
m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
with tempfile.TemporaryDirectory(prefix='fluxion-branding-upgrade.') as root:
 p=pathlib.Path(root)/'Fluxion.app/Contents/Resources';(p/'browser').mkdir(parents=True)
 fixture=json.loads((m.ROOT/'tests/fixtures/gecko-branding-155.json').read_text())['archives']['browser/omni.ja']
 rules=json.loads((m.ROOT/'branding/strings.json').read_text())['archives']['browser/omni.ja']
 names=['localization/en-US/branding/brand.ftl','chrome/en-US/locale/branding/brand.properties']
 b=io.BytesIO()
 with zipfile.ZipFile(b,'w') as z:
  for name in names:
   text=fixture[name]
   for r in rules[name]['replacements']:text=text.replace(r['before'],r['after'])
   z.writestr(name,text)
  z.writestr('unrelated','unchanged')
 t=importlib.util.spec_from_file_location('archive',m.ROOT/'scripts/install-macos-session-policy.py')
 a=importlib.util.module_from_spec(t);t.loader.exec_module(a)
 archive=p/'browser/omni.ja';archive.write_bytes(a.optimize_zip(b.getvalue(),set(names)))
 m.seed(p)
 with a._archive.readable_archive(archive) as z:
  for name in names:assert z.read(name).decode()==fixture[name]
  assert z.read('unrelated')==b'unchanged'
 before=archive.read_bytes()
 try:m.seed(p)
 except ValueError:pass
 else:raise AssertionError('already seeded archive accepted')
 assert archive.read_bytes()==before
 try:m.seed(pathlib.Path(root)/'outside')
 except ValueError:pass
 else:raise AssertionError('unowned path accepted')
`], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});

test("upgrade runner canonicalizes temporary aliases before computing app and profile ownership", t => {
  const source = fs.readFileSync(path.join(__dirname, "../scripts/verify-macos-branding-upgrade.sh"), "utf8");
  const normalize = source.match(/^check_root="\$\(CDPATH= cd -P -- "\$check_root" && pwd -P\)"$/m)?.[0];
  assert.ok(normalize);
  assert.ok(source.indexOf(normalize) < source.indexOf('app="$check_root/Fluxion.app"'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fluxion-owned-path-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "actual"));
  fs.symlinkSync(path.join(root, "actual"), path.join(root, "alias"));
  const result = spawnSync("bash", ["-c", `${normalize}\nprintf '%s' "$check_root"`], {
    encoding: "utf8", env: { ...process.env, check_root: `${root}/alias//` },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, fs.realpathSync(path.join(root, "actual")));
});
