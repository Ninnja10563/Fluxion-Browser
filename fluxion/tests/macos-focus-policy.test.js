"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process"), { resolve } = require("node:path"), fs = require("node:fs");
const helper = resolve(__dirname, "../scripts/install-macos-focus-policy.py");
const load = `import importlib.util,json,hashlib,tempfile,pathlib,zipfile,struct,os
s=importlib.util.spec_from_file_location("policy",${JSON.stringify(helper)})
m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
`;
function python(code) {
  const run = spawnSync("python3", ["-c", load + code], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr); return run.stdout;
}
const replacements = JSON.parse(python("print(json.dumps(m.REPLACEMENTS))"));
const prefAllowsHide = new Function("Services", "window", "document", "BrowserHandler", `${replacements[0][1]} return true;`);
const inputVeto = new Function("focused", "document", "BrowserHandler", "gNavToolbox", "fluxionFocus",
  `return Boolean(focused && focused.ownerDocument == document && ${replacements[1][1]});`);
const tabReplacements = JSON.parse(python("print(json.dumps(m.TAB_REPLACEMENTS))"));
const focusReplacement = new Function("aNewTab", "document", "gURLBar", tabReplacements[0][1]);

test("automatic last-tab replacements do not claim address focus in explicit Focus, without blurring real editing", () => {
  for (const mode of ["expanded", "compact", "focus", "native-focus"]) for (const aNewTab of [false, true]) {
    for (const alreadyEditing of [false, true]) {
      const originalFocus = alreadyEditing ? { id: "urlbar-input", value: "unfinished query" } : { id: "page" };
      const document = { activeElement: originalFocus, documentElement: { hasAttribute: name =>
        name === "data-fluxion-focus-mode" ? mode === "focus" : name === "data-fluxion-native-focus" && mode === "native-focus" } };
      let selects = 0;
      const gURLBar = { select() { selects++; } };
      focusReplacement(aNewTab, document, gURLBar);
      assert.equal(selects, Number(aNewTab && ["expanded", "compact"].includes(mode)));
      assert.equal(document.activeElement, originalFocus, "no deferred or blanket focus release");
      if (alreadyEditing) assert.equal(originalFocus.value, "unfinished query");
      gURLBar.select();
      assert.equal(selects, Number(aNewTab && ["expanded", "compact"].includes(mode)) + 1,
        "explicit native location commands are not intercepted");
    }
  }
});

test("native Focus alone bypasses stale autohide=false, without changing any preference or DOM/kiosk behavior", () => {
  for (const pref of [false, true]) for (const locked of [false, true]) for (const explicit of [false, true]) for (const fullScreen of [false, true]) {
    for (const dom of ["none", "element", "attribute"]) for (const kiosk of [false, true]) {
      const document = { fullscreenElement: dom === "element" ? {} : null,
        documentElement: { hasAttribute: name => name === "data-fluxion-native-focus" ? explicit : dom === "attribute" } };
      const Services = { prefs: {
        getBoolPref: name => { assert.equal(name, "browser.fullscreen.autohide"); return pref; },
        prefIsLocked: name => { assert.equal(name, "browser.fullscreen.autohide"); return locked; },
      } };
      assert.equal(Boolean(prefAllowsHide(Services, { fullScreen }, document, { kiosk })),
        pref || (explicit && fullScreen && dom === "none" && !kiosk && !locked));
    }
  }
});
test("only native toolbar inputs veto explicit Focus collapse; Settings/Library inputs retain their page focus", () => {
  const document = {}, otherDocument = {}, toolbar = { ownerDocument: document, localName: "input" },
    settings = { ownerDocument: document, localName: "input" }, library = { ownerDocument: document, localName: "input" },
    page = { ownerDocument: otherDocument, localName: "input" }, button = { ownerDocument: document, localName: "toolbarbutton" };
  const toolbox = { contains: node => node === toolbar };
  for (const explicit of [false, true]) for (const kiosk of [false, true]) {
    for (const node of [toolbar, settings, library, page, button, null]) {
      const expected = !kiosk && (node === toolbar || (!explicit && [settings, library].includes(node)));
      assert.equal(inputVeto(node, document, { kiosk }, toolbox, explicit), expected);
    }
  }
});
test("installer rejects unsupported versions, changed members and ambiguous ZIP entries without mutating the archive", () => {
  python(`
with tempfile.TemporaryDirectory() as temp:
 p=pathlib.Path(temp);(p/'browser').mkdir();archive=p/'browser/omni.ja'
 for version in ['155.0.2',m.VERSION]:
  (p/'application.ini').write_text('[App]\\nVersion='+version+'\\n')
  with zipfile.ZipFile(archive,'w') as z:z.writestr(m.ENTRY,b'changed native controller')
  before=archive.read_bytes()
  try:m.install(p)
  except ValueError:pass
  else:raise AssertionError('unknown native source accepted')
  assert archive.read_bytes()==before
 data='\\n'.join(before for before,after in m.REPLACEMENTS).encode()
 m.SHA256=hashlib.sha256(data).hexdigest()
 tabdata='\\n'.join(before for before,after in m.TAB_REPLACEMENTS).encode()
 m.TAB_SHA256=hashlib.sha256(tabdata).hexdigest()
 for duplicate in [False,True]:
  with zipfile.ZipFile(archive,'w') as z:
   z.writestr('other',b'unchanged')
   if duplicate:z.writestr(m.ENTRY,data);z.writestr(m.ENTRY,data)
  before=archive.read_bytes()
  try:m.install(p)
  except ValueError:pass
  else:raise AssertionError('missing/duplicate native member accepted')
  assert archive.read_bytes()==before
`);
});
test("optimized archive patch preserves unrelated bytes, metadata, member order and preload boundary", () => {
  python(`
with tempfile.TemporaryDirectory() as temp:
 p=pathlib.Path(temp);(p/'browser').mkdir();archive=p/'browser/omni.ja'
 (p/'application.ini').write_text('[App]\\nVersion='+m.VERSION+'\\n')
 data='\\n'.join(before for before,after in m.REPLACEMENTS).encode()
 m.SHA256=hashlib.sha256(data).hexdigest()
 tabdata='\\n'.join(before for before,after in m.TAB_REPLACEMENTS).encode()
 m.TAB_SHA256=hashlib.sha256(tabdata).hexdigest()
 with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED) as z:
  z.writestr('keep-first',b'preloaded bytes'*100)
  z.writestr(m.ENTRY,data)
  z.writestr(m.TAB_ENTRY,tabdata)
  z.writestr('keep-last',b'other policy output unchanged')
 archive.write_bytes(m.archive_tools.optimize_zip(archive.read_bytes(),{'keep-first'}))
 archive.chmod(0o640)
 with m.archive_tools._archive.readable_archive(archive) as z:
  before={i.filename:(z.read(i),i.date_time,i.compress_type,i.external_attr) for i in z.infolist()}
 m.install(p)
 preload=struct.unpack('<I',archive.read_bytes()[:4])[0]
 with m.archive_tools._archive.readable_archive(archive) as z:
  assert z.testzip() is None and z.namelist()==list(before)
  assert {i.filename for i in z.infolist() if i.header_offset<preload}=={'keep-first'}
  for i in z.infolist():
   expected=m.patch_source(data) if i.filename==m.ENTRY else m.patch_tab_source(tabdata) if i.filename==m.TAB_ENTRY else before[i.filename][0]
   assert z.read(i)==expected
   assert (i.date_time,i.compress_type,i.external_attr)==before[i.filename][1:]
 assert archive.stat().st_mode&0o777==0o640
 # A second patch cannot silently repatch modified code.
 original=archive.read_bytes()
 try:m.install(p)
 except ValueError:pass
 else:raise AssertionError('already modified native source accepted')
 assert archive.read_bytes()==original
`);
});
test("unrecognized tab policy prevents either native member from being written", () => {
  python(`
with tempfile.TemporaryDirectory() as temp:
 p=pathlib.Path(temp);(p/'browser').mkdir();archive=p/'browser/omni.ja'
 (p/'application.ini').write_text('[App]\\nVersion='+m.VERSION+'\\n')
 data='\\n'.join(before for before,after in m.REPLACEMENTS).encode()
 m.SHA256=hashlib.sha256(data).hexdigest()
 with zipfile.ZipFile(archive,'w') as z:
  z.writestr(m.ENTRY,data)
  z.writestr(m.TAB_ENTRY,b'changed or unpatched tabbrowser source')
 before=archive.read_bytes()
 try:m.install(p)
 except ValueError as error:assert 'session-policy-patched' in str(error)
 else:raise AssertionError('unknown tab source accepted')
 assert archive.read_bytes()==before
`);
});
test("source anchor drift and build cache omissions fail closed", () => {
  python(`
data=b'no expected source anchors'
m.SHA256=hashlib.sha256(data).hexdigest()
try:m.patch_source(data)
except ValueError:pass
else:raise AssertionError('missing anchors accepted')
m.TAB_SHA256=hashlib.sha256(data).hexdigest()
try:m.patch_tab_source(data)
except ValueError:pass
else:raise AssertionError('missing tab focus anchor accepted')
`);
  const build = fs.readFileSync(resolve(__dirname, "../scripts/prepare-macos-runtime.sh"), "utf8");
  assert.match(build, /runtime_file_digest "\$fluxion_root\/scripts\/install-macos-focus-policy\.py"/);
  assert.match(build, /python3 "\$fluxion_root\/scripts\/install-macos-focus-policy\.py" "\$resources"/);
  assert.ok(build.indexOf('python3 "$fluxion_root/scripts/install-macos-session-policy.py"') <
    build.indexOf('python3 "$fluxion_root/scripts/install-macos-focus-policy.py"'), "tab source must have the pinned session policy first");
});
