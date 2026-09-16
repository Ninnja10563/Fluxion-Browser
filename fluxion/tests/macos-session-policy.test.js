"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { resolve } = require("node:path");
const helper = resolve(__dirname, "../scripts/install-macos-session-policy.py");
const load = `import importlib.util,json,hashlib,tempfile,pathlib,zipfile,struct,os
s=importlib.util.spec_from_file_location("policy",${JSON.stringify(helper)})
m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
`;
function python(code) {
  const run = spawnSync("python3", ["-c", load + code], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  return run.stdout;
}
const replacements = JSON.parse(python("print(json.dumps([m.STORE_REPLACEMENTS,m.SAVER_REPLACEMENTS]))"));
const store = replacements[0], saver = replacements[1][0][1];
const restoreChoice = new Function("AppConstants", "PrivateBrowsingUtils", "Services", `return ({
${store[0][1].slice(0, store[0][1].indexOf("  initializeWindow"))}
})._fluxionRestoreLastWindow;`);
const shouldPinOnly = new Function("AppConstants", "lazy", `return ${store[1][1]};`);
const closeCondition = store[3][1].slice(0, store[3][1].indexOf("        //"));
const shouldMark = new Function("AppConstants", "winData", `${closeCondition}return true;}return false;`);
const project = new Function("AppConstants", "Services", "state", "lazy = { PrivateBrowsingUtils: { permanentPrivateBrowsing: false } }", saver.slice(0, saver.indexOf("    // Clear cookies")));
const services = startup => ({ prefs: { getIntPref: () => startup } });
const mac = { platform: "macosx" };

test("macOS last-window policy follows the explicit startup choice, not stale initial startup state", () => {
  for (const platform of ["macosx", "linux", "win"]) for (const startup of [0, 1, 3]) for (const permanentPrivateBrowsing of [false, true]) {
    assert.equal(restoreChoice({ platform }, { permanentPrivateBrowsing }, services(startup)),
      platform === "macosx" && startup === 3 && !permanentPrivateBrowsing);
  }
  for (const willRestore of [false, true]) {
    const lazy = { SessionStartup: { willRestore: () => willRestore } };
    assert.equal(shouldPinOnly.call({ _fluxionRestoreLastWindow: true }, mac, lazy), false);
    assert.equal(shouldPinOnly.call({ _fluxionRestoreLastWindow: false }, mac, lazy), true);
    assert.equal(shouldPinOnly.call({}, { platform: "linux" }, lazy), !willRestore);
  }
});

test("only the final normal regular window is marked, never private/popups/taskbar tabs or an earlier close", () => {
  const normal = {}, privateWindow = { isPrivate: true }, popup = { isPopup: true }, taskbar = { isTaskbarTab: true };
  for (const closing of [normal, privateWindow, popup, taskbar]) {
    assert.equal(shouldMark.call({ _fluxionRestoreLastWindow: true, _windows: { closing, privateWindow, popup, taskbar } }, mac, closing), closing === normal);
  }
  assert.equal(shouldMark.call({ _fluxionRestoreLastWindow: true, _windows: { a: {}, b: {} } }, mac, normal), false);
  assert.equal(shouldMark.call({ _fluxionRestoreLastWindow: false, _windows: { a: {} } }, mac, normal), false);
});

test("relaunch projection preserves the live native closed record and repeated saves, including pinned/session metadata", () => {
  const earlier = { closedId: 1, tabs: [{ entries: [{ url: "https://earlier.example/" }] }] };
  const last = { closedId: 2, closedAt: 123, _shouldRestore: true,
    tabs: [{ pinned: true, entries: [{ url: "https://pinned.example/" }] }, { entries: [{ url: "https://normal.example/" }] }],
    extData: { workspace: "research" }, selected: 2, groups: [{ id: "native" }] };
  const liveClosed = [last, earlier], original = JSON.stringify(liveClosed);
  for (let i = 0; i < 3; i++) {
    const snapshot = { windows: [], _closedWindows: liveClosed.slice(), selectedWindow: 0 };
    project(mac, services(3), snapshot);
    assert.deepEqual(snapshot._closedWindows, [earlier]);
    assert.equal(snapshot.windows.length, 1);
    assert.equal(snapshot.windows[0].tabs, last.tabs);
    assert.equal(snapshot.windows[0].extData, last.extData);
    assert.equal(snapshot.windows[0].selected, 2);
    assert.equal(snapshot.windows[0].closedAt, undefined);
    assert.equal(snapshot.windows[0]._shouldRestore, undefined);
    assert.equal(snapshot.selectedWindow, 1);
    assert.equal(JSON.stringify(liveClosed), original, "public undoCloseWindow still has the original record");
  }
});

test("projection never replaces open/external-link windows or restores private records, explicit opt-outs or earlier closes", () => {
  const privateOnly = { windows: [], _closedWindows: [{ _shouldRestore: true }], selectedWindow: 0 };
  const privateBefore = JSON.stringify(privateOnly);
  project(mac, services(3), privateOnly, { PrivateBrowsingUtils: { permanentPrivateBrowsing: true } });
  assert.equal(JSON.stringify(privateOnly), privateBefore, "permanent private mode cannot project an older normal marker");
  for (const startup of [0, 1, 3]) for (const existing of [[], [{ tabs: [{ entries: [{ url: "https://external.example/" }] }] }]]) {
    for (const record of [{}, { _shouldRestore: true, isPrivate: true }, { _shouldRestore: true, isPopup: true }, { _shouldRestore: true, isTaskbarTab: true }]) {
      const state = { windows: existing, _closedWindows: [record], selectedWindow: 0 }, original = JSON.stringify(state);
      project(mac, services(startup), state);
      assert.equal(JSON.stringify(state), original);
    }
    if (startup !== 3 || existing.length) {
      const state = { windows: existing, _closedWindows: [{ _shouldRestore: true }], selectedWindow: 0 }, original = JSON.stringify(state);
      project(mac, services(startup), state); assert.equal(JSON.stringify(state), original);
    }
  }
});

test("private-only activity retains the normal marker and cannot consume the pending reopen", () => {
  const clearGuard = store[4][1].slice(0, store[4][1].indexOf("    for (let"));
  const clear = new Function(`${clearGuard.replace("  _clearRestoringWindows: function ssi_clearRestoringWindows() {", "")}return "cleared";`);
  const pending = { _fluxionRestoreLastWindow: true, _windows: { private: { isPrivate: true } } };
  assert.equal(clear.call(pending), undefined);
  assert.equal(clear.call({ ...pending, _windows: { normal: {} } }), "cleared");
  const resetCondition = store[2][1].trim().slice(4, -3);
  const reset = new Function("aWindow", "isRegularWindow", `return ${resetCondition};`);
  assert.equal(reset.call({ _restoreLastWindow: true, _fluxionRestoreLastWindow: true }, { toolbar: { visible: true } }, false), false);
  assert.equal(reset.call({ _restoreLastWindow: true, _fluxionRestoreLastWindow: true }, { toolbar: { visible: true } }, true), true);
});

test("full last-window restoration cancels the memoized homepage without consuming explicit external requests", () => {
  const restore = new Function("aWindow", "state", "newWindowState", store[5][1]);
  for (const enabled of [false, true]) for (const overwriteTabs of [false, true]) for (const cached of [false, true]) {
    let initializations = 0, restored = false;
    const defaultURL = "file:///Fluxion.app/fluxion/newtab/index.html";
    const request = overwriteTabs ? defaultURL : "https://external.example/request";
    const init = { get uriToLoadPromise() {
      initializations++;
      delete this.uriToLoadPromise;
      return (this.uriToLoadPromise = request);
    } };
    if (cached) void init.uriToLoadPromise;
    const aWindow = { gBrowserInit: init }, desired = { tabs: ["retained"] };
    restore.call({
      _fluxionRestoreLastWindow: enabled,
      _isCmdLineEmpty(win) { assert.equal(win, aWindow); return overwriteTabs; },
      restoreWindow(win, state, options) {
        assert.equal(win, aWindow); assert.equal(state, desired); assert.equal(options.overwriteTabs, overwriteTabs);
        assert.equal(init.uriToLoadPromise, enabled && overwriteTabs ? null : request);
        restored = true;
      },
    }, aWindow, {}, desired);
    assert.equal(restored, true);
    assert.equal(initializations, 1, "native lazy initializer is evaluated once, never replaced");
  }
});

test("installer fails closed on unsupported source/version and does not mutate the runtime", () => {
  python(`
with tempfile.TemporaryDirectory() as temp:
 p=pathlib.Path(temp);(p/'browser').mkdir()
 archive=p/'browser/omni.ja'
 with zipfile.ZipFile(archive,'w') as z:
  for name in m.HASHES:z.writestr(name,b'changed upstream')
  for name in m.DEPENDENCY_HASHES:z.writestr(name,b'changed startup interface')
 original=archive.read_bytes()
 for version in ['155.0.2',m.VERSION]:
  (p/'application.ini').write_text('[App]\\nVersion='+version+'\\n')
  try:m.install(p)
  except ValueError:pass
  else:raise AssertionError('unknown input accepted')
  assert archive.read_bytes()==original
`);
});

test("atomic optimized-archive rebuild retains unrelated entries, metadata, preload boundary and CRC validation", () => {
  python(`
with tempfile.TemporaryDirectory() as temp:
 p=pathlib.Path(temp);(p/'browser').mkdir()
 (p/'application.ini').write_text('[App]\\nVersion='+m.VERSION+'\\n')
 archive=p/'browser/omni.ja'
 # Synthetic exact anchor fixtures: production digests remain immutable outside this test process.
 originals={}
 for name in m.HASHES:
  changes=m.REPLACEMENTS[name]
  originals[name]='\\n'.join(before for before,after in changes).encode()
  m.HASHES[name]=hashlib.sha256(originals[name]).hexdigest()
 with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED) as z:
  z.writestr('keep-before.bin',b'private archive fixture'*100)
  for name,data in originals.items():z.writestr(name,data)
  for name in m.DEPENDENCY_HASHES:
   data=b'unchanged verified startup interface'
   m.DEPENDENCY_HASHES[name]=hashlib.sha256(data).hexdigest()
   z.writestr(name,data)
  z.writestr('keep-after.bin',b'after data')
 archive.write_bytes(m.optimize_zip(archive.read_bytes(),{'keep-before.bin'}))
 with m._archive.readable_archive(archive) as z:
  before={i.filename:(z.read(i),i.date_time,i.compress_type,i.external_attr) for i in z.infolist()}
 m.install(p)
 with m._archive.readable_archive(archive) as z:
  assert z.testzip() is None
  assert z.namelist()==list(before)
  for i in z.infolist():
   expected=m.patch_source(i.filename,originals[i.filename]) if i.filename in originals else before[i.filename][0]
   assert z.read(i)==expected
   assert (i.date_time,i.compress_type,i.external_attr)==before[i.filename][1:]
  preload=struct.unpack('<I',archive.read_bytes()[:4])[0]
  assert {i.filename for i in z.infolist() if i.header_offset<preload}=={'keep-before.bin'}
 changed=archive.read_bytes()
 try:m.install(p)
 except ValueError:pass
 else:raise AssertionError('double patch accepted')
 assert archive.read_bytes()==changed
 assert not list((p/'browser').glob('.fluxion-session-*'))
`);
});
