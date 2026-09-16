"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const load = `import importlib.util,json,hashlib,tempfile,pathlib,zipfile,struct
s=importlib.util.spec_from_file_location('branding',${JSON.stringify(path.join(root, "scripts/install-branding.py"))})
m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
fixtures=json.loads(pathlib.Path(${JSON.stringify(path.join(__dirname, "fixtures/gecko-branding-155.json"))}).read_text())
manifest=json.loads((m.ROOT/'branding/strings.json').read_text())
art=json.loads((m.ROOT/'branding/artwork.json').read_text())
`;
function python(code) {
  const result = spawnSync("python3", ["-c", load + code], { encoding: "utf8", timeout: 60000 });
  assert.equal(result.status, 0, result.stderr || String(result.error));
}

test("branding patches exact native resources while preserving archive metadata and unrelated bytes", () => {
  python(`
with tempfile.TemporaryDirectory() as temp:
 p=pathlib.Path(temp);(p/'browser').mkdir()
 (p/'application.ini').write_text('[App]\\nVersion=155.0.1\\n')
 expected={}
 for arc,rules in manifest['archives'].items():
  raw={n:fixtures['archives'][arc][n].encode() for n in rules}
  for n,rule in art['archives'][arc].items():
   raw[n]=b'<svg>original mascot fixture</svg>' if n.endswith('.svg') else b'original png fixture'
   rule['sha256']=hashlib.sha256(raw[n]).hexdigest()
  raw['unrelated.bin']=b'preserved security implementation'
  expected[arc]=raw
  with zipfile.ZipFile(p/arc,'w',compression=zipfile.ZIP_DEFLATED) as z:
   for n,data in raw.items():z.writestr(n,data)
  (p/arc).write_bytes(m.archive_tools.optimize_zip((p/arc).read_bytes(),set(raw)))
 m.install(p,manifest,art)
 for arc,raw in expected.items():
  with m.archive_tools._archive.readable_archive(p/arc) as z:
   assert z.testzip() is None
   assert z.namelist()==list(raw)
   assert z.read('unrelated.bin')==raw['unrelated.bin']
   for n,rule in manifest['archives'][arc].items():assert z.read(n)==m.patch_text(raw[n],rule,n)
   for n,rule in art['archives'][arc].items():
    data=z.read(n)
    assert data!=raw[n]
    if rule['kind'] in ['normal','warning','disabled']:assert b'data:image/png;base64,' in data
 before={arc:(p/arc).read_bytes() for arc in expected}
 try:m.install(p,manifest,art)
 except ValueError:pass
 else:raise AssertionError('double branding accepted')
 assert all((p/arc).read_bytes()==data for arc,data in before.items())
 assert not list(p.rglob('.fluxion-branding-*'))
`);
});

test("unknown second archive input fails before replacing the already prepared first archive", () => {
  python(`
with tempfile.TemporaryDirectory() as temp:
 p=pathlib.Path(temp);(p/'browser').mkdir();(p/'application.ini').write_text('[App]\\nVersion=155.0.1\\n')
 before={}
 # Empty audited maps are valid test fixtures, not production configuration.
 for arc in ['browser/omni.ja','omni.ja']:
  with zipfile.ZipFile(p/arc,'w') as z:z.writestr('keep',b'unchanged')
  (p/arc).write_bytes(m.archive_tools.optimize_zip((p/arc).read_bytes(),{'keep'}))
  before[arc]=(p/arc).read_bytes()
 small={'version':'155.0.1','archives':{'browser/omni.ja':{},'omni.ja':{'missing':{'sha256':'0'*64,'replacements':[]}}}}
 images={'version':'155.0.1','markSHA256':art['markSHA256'],'archives':{}}
 try:m.install(p,small,images)
 except ValueError:pass
 else:raise AssertionError('missing source accepted')
 assert all((p/arc).read_bytes()==data for arc,data in before.items())
 assert not list(p.rglob('.fluxion-branding-*'))
`);
});

test("mascot replacements preserve distinct warning and disabled indicators without external image requests", () => {
  python(`
mark=(m.ROOT/'assets/app-icons/fluxion-mark.png').read_bytes()
normal,warning,disabled=[m.brand_svg(mark,state) for state in ['normal','warning','disabled']]
assert len({normal,warning,disabled})==3
assert b'<path ' in warning and b'<circle ' in disabled
for data in [normal,warning,disabled]:
 assert b'xlink:href="data:image/png;base64,' in data
 assert b'<script' not in data and b'<foreignObject' not in data
 assert b'filter=' not in data
`);
});

test("native Extensions empty state packages the existing transparent F without changing its controls or layout rules", () => {
  python(`
import base64,xml.etree.ElementTree as ET
name='chrome/browser/skin/classic/browser/addons/extensions-panel-empty-illustration.svg'
rule=art['archives']['browser/omni.ja'][name]
assert rule=={'sha256':'df233112dc63cd14a04e235ba97959d4b07aaea756b034f7b700d669b91c498b','kind':'normal'}
original=b'<svg xmlns="http://www.w3.org/2000/svg" width="329" height="162"><path id="original-fox"/></svg>'
images={'version':art['version'],'markSHA256':art['markSHA256'],'archives':{'browser/omni.ja':{name:{**rule,'sha256':hashlib.sha256(original).hexdigest()}}}}
strings={'version':manifest['version'],'archives':{}}
# Archive routing remains native: the browser document, popup commands and CSS
# are opaque unchanged bytes; only the image they already request is replaced.
untouched={
 'chrome/browser/content/browser/browser.xhtml':b'<html:img src="chrome://browser/skin/addons/extensions-panel-empty-illustration.svg" loading="lazy"/><toolbarbutton id="unified-extensions-manage-extensions" data-l10n-id="unified-extensions-manage-extensions"/>',
 'chrome/browser/skin/classic/browser/addons/unified-extensions.css':b'#unified-extensions-empty-state > img { align-self:center; max-width:100%; height:auto; }',
 'chrome/browser/content/browser/browser-unified-extensions.js':b'untouched native extension permissions and management commands',
}
with tempfile.TemporaryDirectory() as temp:
 p=pathlib.Path(temp);(p/'browser').mkdir();(p/'application.ini').write_text('[App]\\nVersion=155.0.1\\n')
 with zipfile.ZipFile(p/'browser/omni.ja','w') as z:
  z.writestr(name,original)
  for path,data in untouched.items():z.writestr(path,data)
 (p/'browser/omni.ja').write_bytes(m.archive_tools.optimize_zip((p/'browser/omni.ja').read_bytes(),{name,*untouched}))
 m.install(p,strings,images)
 with m.archive_tools._archive.readable_archive(p/'browser/omni.ja') as z:
  for path,data in untouched.items():assert z.read(path)==data
  svg=ET.fromstring(z.read(name))
  assert svg.attrib['width']=='100' and svg.attrib['height']=='100'
  assert [child.tag for child in svg]==['{http://www.w3.org/2000/svg}image']
  image=svg[0].attrib['{http://www.w3.org/1999/xlink}href']
  assert image.startswith('data:image/png;base64,')
  assert base64.b64decode(image.split(',',1)[1])==(m.ROOT/'assets/app-icons/fluxion-mark.png').read_bytes()
`);
});
