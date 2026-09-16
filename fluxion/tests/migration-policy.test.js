"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const helper = path.resolve(__dirname, "../scripts/install-migration-policy.py");
const fixturePath = path.resolve(__dirname, "fixtures/gecko-migration-155.mjs");
const load = `import importlib.util,json,hashlib,tempfile,pathlib,zipfile,struct,os
s=importlib.util.spec_from_file_location("policy",${JSON.stringify(helper)})
m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
native=pathlib.Path(${JSON.stringify(fixturePath)}).read_bytes()
`;
function python(code) {
  const result = spawnSync("python3", ["-c", load + code], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
const patched = python("print(m.patch_source(native).decode(),end='')");
function method(source) {
  const start = source.indexOf("  showMigrationWizard(aOpener, aOptions) {"), end = source.indexOf("\n  /**", start);
  assert.ok(start > 0 && end > start);
  return source.slice(start, end);
}
function run({ native = false, marker = true, system = true, startup = false, behavior = "default", entrypoint = "unknown", noOpener = false, allowed = true } = {}) {
  const windows = [], preferences = [], telemetry = [], options = { isStartupMigration: startup, entrypoint, profileId: "selected-profile" };
  const opener = noOpener ? null : { ...(marker ? { FluxionUI: {} } : {}), document: { nodePrincipal: { isSystemPrincipal: system } },
    openPreferences: value => { preferences.push(value); return Promise.resolve(); } };
  const context = vm.createContext({ Services: {
    policies: { isAllowed: feature => { assert.equal(feature, "profileImport"); return allowed; } },
    prefs: { getCharPref: () => behavior }, env: { get: () => false },
    ww: { openWindow: (...args) => windows.push(args) },
  }, Glean: { browserMigration: { entryPointCategorical: new Proxy({}, { get: (_target, name) => ({ add: count => telemetry.push([name, count]) }) }) } } });
  const invoke = vm.runInContext(`({${method(native ? fs.readFileSync(fixturePath, "utf8") : patched)}}).showMigrationWizard`, context);
  const result = invoke.call({ MIGRATION_ENTRYPOINTS: { UNKNOWN: "unknown", NEWTAB: "newtab" } }, opener, options);
  return { windows, preferences, telemetry, opener, options, result };
}

test("privileged Fluxion import uses Gecko's nonblocking standalone wizard with unchanged native options", async () => {
  for (const behavior of ["default", "autoclose", "standalone"]) for (const entrypoint of ["unknown", "newtab"]) {
    const f = run({ behavior, entrypoint }); await f.result;
    assert.equal(f.windows.length, 1); assert.deepEqual(f.preferences, []);
    const [opener, url, name, features, arguments_] = f.windows[0];
    assert.equal(opener, f.opener); assert.equal(arguments_.options, f.options);
    assert.equal(url, "chrome://browser/content/migration/migration-dialog-window.html");
    assert.equal(name, "_blank"); assert.equal(features, "dialog,centerscreen,resizable=no");
    assert.deepEqual(f.telemetry, [[entrypoint, 1]]);
  }
});

test("standalone routing retains the original preferences import-policy boundary", async () => {
  const f = run({ allowed: false }); await f.result;
  assert.deepEqual(f.windows, []); assert.deepEqual(f.preferences, []);
  assert.equal(f.telemetry.length, 1, "native entrypoint accounting remains unchanged");
});

test("startup, non-Fluxion, unprivileged-marker and missing-opener routes retain original Gecko behavior", async () => {
  for (const variant of [{ startup: true }, { marker: false }, { system: false }, { noOpener: true }]) {
    for (const behavior of ["default", "autoclose", "standalone"]) {
      const options = { ...variant, behavior, entrypoint: "newtab" };
      const actual = run(options), original = run({ ...options, native: true });
      await actual.result; await original.result;
      assert.deepEqual(actual.preferences, original.preferences);
      assert.deepEqual(actual.windows.map(args => args.slice(1, 4)), original.windows.map(args => args.slice(1, 4)));
      assert.deepEqual(actual.telemetry, original.telemetry);
    }
  }
});

test("migration installer patches only the pinned native module and retains optimized archive metadata", () => {
  python(`
with tempfile.TemporaryDirectory() as temp:
 p=pathlib.Path(temp);(p/'browser').mkdir();(p/'application.ini').write_text('[App]\\nVersion='+m.VERSION+'\\n')
 archive=p/'browser/omni.ja'
 with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED) as z:
  z.writestr('untouched.bin',b'unchanged native resource');z.writestr(m.ENTRY,native)
 archive.write_bytes(m.archive_tools.optimize_zip(archive.read_bytes(),{'untouched.bin'}))
 with m.archive_tools._archive.readable_archive(archive) as z:
  original={i.filename:(z.read(i),i.date_time,i.compress_type,i.external_attr) for i in z.infolist()}
 m.install(p)
 with m.archive_tools._archive.readable_archive(archive) as z:
  assert z.testzip() is None
  assert z.namelist()==list(original)
  for i in z.infolist():
   assert z.read(i)==(m.patch_source(native) if i.filename==m.ENTRY else original[i.filename][0])
   assert (i.date_time,i.compress_type,i.external_attr)==original[i.filename][1:]
  preload=struct.unpack('<I',archive.read_bytes()[:4])[0]
  assert {i.filename for i in z.infolist() if i.header_offset<preload}=={'untouched.bin'}
 before=archive.read_bytes()
 try:m.install(p)
 except ValueError:pass
 else:raise AssertionError('double patch accepted')
 assert archive.read_bytes()==before
 assert not list((p/'browser').glob('.fluxion-migration-*'))
`);
});

test("unsupported migration source/version and linked archives fail before any runtime mutation", () => {
  python(`
with tempfile.TemporaryDirectory() as temp:
 p=pathlib.Path(temp);(p/'browser').mkdir();archive=p/'browser/omni.ja'
 for version,data in [('155.0.2',native),(m.VERSION,native+b'\\n')]:
  (p/'application.ini').write_text('[App]\\nVersion='+version+'\\n')
  with zipfile.ZipFile(archive,'w') as z:z.writestr(m.ENTRY,data)
  before=archive.read_bytes()
  try:m.install(p)
  except ValueError:pass
  else:raise AssertionError('source drift accepted')
  assert archive.read_bytes()==before
 archive.rename(p/'owned.ja');archive.symlink_to(p/'owned.ja')
 try:m.install(p)
 except ValueError:pass
 else:raise AssertionError('symlink accepted')
 assert (p/'owned.ja').read_bytes()==before
`);
});
