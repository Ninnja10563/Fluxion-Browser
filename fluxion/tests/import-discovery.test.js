"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), vm = require("node:vm"), path = require("node:path");
const ready = import("../modules/FluxionImportDiscovery.sys.mjs");
async function fixture(overrides = {}) {
  const { createImportDiscovery } = await ready;
  const calls = [], state = { allowed: true };
  const controller = createImportDiscovery({ allowed: () => state.allowed,
    scan: async () => { calls.push("scan"); return { profiles: [
      { source: "zen", name: "Work", path: "/private/zen", kind: "backup" },
      { source: "chrome", name: "Person 1", profileId: "Profile 1", kind: "native" },
    ], warnings: [] }; },
    latestBackup: async () => { calls.push("backup"); return "/private/backup.jsonlz4"; },
    confirm: async () => { calls.push("confirm"); return true; },
    importBackup: async () => { calls.push("import"); return 5; },
    openWizard: async profile => { calls.push(["wizard", profile.profileId]); }, ...overrides });
  return { calls, state, controller };
}
test("profile parser handles CRLF, multiple profiles and custom locations without treating install sections as profiles", async () => {
  const { parseProfiles } = await ready;
  assert.deepEqual(parseProfiles("[Profile0]\r\nName=Work\r\nIsRelative=1\r\nPath=Profiles/abc\r\n[Install123]\nDefault=ignored\n[Profile1]\nName=Custom\nIsRelative=0\nPath=/custom/location\n[Profile2]\nPath=missing-relative"), [
    { Name: "Work", IsRelative: "1", Path: "Profiles/abc" }, { Name: "Custom", IsRelative: "0", Path: "/custom/location" },
  ]);
  assert.deepEqual(parseProfiles("x".repeat(1024 * 1024 + 1)), []);
  assert.equal(parseProfiles(Array.from({ length: 70 }, (_, i) => `[Profile${i}]\nIsRelative=1\nPath=p${i}`).join("\n")).length, 64);
});
test("backup copies retain native roots and remap descendants and saved folder queries", async () => {
  const { prepareBookmarkCopy } = await ready;
  let id = 0;
  const tree = { guid: "root________", children: [{ guid: "toolbar_____", children: [
    { guid: "folderOld___", id: 42, title: "café", children: [{ guid: "bookmarkOld_", uri: "https://example.org/", tags: "tag" }] },
    { guid: "queryOld____", uri: "place:parent=folderOld___&parent=toolbar_____" },
  ] }] };
  const copy = prepareBookmarkCopy(structuredClone(tree), () => `new${++id}`);
  assert.equal(copy.guid, tree.guid); assert.equal(copy.children[0].guid, "toolbar_____");
  const [folder, query] = copy.children[0].children;
  assert.equal(folder.guid, "new1"); assert.equal(folder.id, 42); assert.equal(folder.title, "café");
  assert.equal(folder.children[0].guid, "new2"); assert.equal(folder.children[0].tags, "tag");
  assert.equal(query.uri, "place:parent=new1&parent=toolbar_____");
  assert.equal(tree.children[0].children[0].guid, "folderOld___", "source object retained");
});
test("backup copy rejects malformed folders and excessive nesting before importing", async () => {
  const { prepareBookmarkCopy } = await ready;
  assert.throws(() => prepareBookmarkCopy(null, () => "guid"), /Invalid/);
  assert.throws(() => prepareBookmarkCopy({ children: [{ children: {} }] }, () => "guid"), /Invalid/);
  let tree = {};
  for (let i = 0; i < 132; i++) tree = { children: [tree] };
  assert.throws(() => prepareBookmarkCopy(tree, () => "guid"), /too large/);
});
test("discovery reads metadata only and exposes opaque selections rather than filesystem paths", async () => {
  const h = await fixture(); assert.deepEqual(h.calls, []);
  const result = await h.controller.discover();
  assert.equal(result.profiles.length, 2); assert.deepEqual(h.calls, ["scan"]);
  assert.doesNotMatch(JSON.stringify(result), /private|profileId|Profile 1/);
  await assert.rejects(h.controller.transfer("/private/zen"), /choose one/);
});
test("backup import is separate, confirmed, additive, and Chrome forwards its exact detected profile", async () => {
  const h = await fixture(), { profiles } = await h.controller.discover();
  assert.deepEqual(await h.controller.transfer(profiles[0].id), { state: "done", kind: "bookmarks", added: 5 });
  assert.deepEqual(h.calls, ["scan", "confirm", "backup", "import"]);
  assert.deepEqual(await h.controller.transfer(profiles[1].id), { state: "wizard" });
  assert.deepEqual(h.calls.at(-1), ["wizard", "Profile 1"]);
});
test("cancel, missing backup, and revoked permission never import", async () => {
  const h = await fixture({ confirm: () => false });
  const { profiles } = await h.controller.discover();
  assert.deepEqual(await h.controller.transfer(profiles[0].id), { state: "cancelled" });
  assert.deepEqual(h.calls, ["scan"]);
  h.state.allowed = false;
  await assert.rejects(h.controller.discover(), /unavailable/);
  await assert.rejects(h.controller.transfer(profiles[0].id), /unavailable/);
  const missing = await fixture({ latestBackup: () => null });
  const result = await missing.controller.discover();
  await assert.rejects(missing.controller.transfer(result.profiles[0].id), /HTML/);
  assert.ok(!missing.calls.includes("import"));
  let revoked;
  revoked = await fixture({ latestBackup: () => { revoked.state.allowed = false; return "/backup"; } });
  const r = await revoked.controller.discover();
  await assert.rejects(revoked.controller.transfer(r.profiles[0].id), /unavailable/);
  assert.ok(!revoked.calls.includes("import"));
});
test("refresh invalidates old selections; scans/transfers cannot overlap and failures unlock retry", async () => {
  const h = await fixture(); const first = await h.controller.discover();
  await h.controller.discover(); await assert.rejects(h.controller.transfer(first.profiles[0].id), /again/);
  let finish;
  const blocked = await fixture({ scan: () => new Promise(resolve => { finish = resolve; }) });
  const pending = blocked.controller.discover();
  assert.deepEqual(await blocked.controller.discover(), { state: "busy" });
  assert.deepEqual(await blocked.controller.transfer("1"), { state: "busy" });
  finish({ profiles: [], warnings: [] }); await pending;
  let failure = true;
  const retry = await fixture({ scan: () => { if (failure) throw Error("scan"); return { profiles: [] }; } });
  await assert.rejects(retry.controller.discover(), /scan/); failure = false;
  assert.equal((await retry.controller.discover()).state, "detected");
});
test("native adapter detects macOS registries, ignores current profile and missing paths, and appends the newest saved backup", async () => {
  const calls = [], entries = new Map([
    ["/home/Library/Application Support/zen/profiles.ini", "[Profile0]\nName=Work\nIsRelative=1\nPath=Profiles/work\n[Profile1]\nIsRelative=0\nPath=/fluxion\n[Profile2]\nIsRelative=0\nPath=/missing"],
    ["/home/Library/Application Support/Firefox/profiles.ini", "[Profile0]\nName=Default\nIsRelative=0\nPath=/firefox"],
  ]);
  const directories = new Set(["/home/Library/Application Support/zen/Profiles/work", "/fluxion", "/firefox"]);
  let temporaryText = null, temporaryRemoved = false, failImport = false;
  const context = vm.createContext({ TextDecoder, Services: {
    appinfo: { OS: "Darwin" }, policies: { isAllowed: () => true }, prompt: { confirm: () => true },
    dirsvc: { get: key => key === "TmpD" ? { path: "/tmp/owned-import.json", append() {}, createUnique(_type, mode) { assert.equal(mode, 0o600); } } : ({ path: key === "Home" ? "/home" : "/fluxion" }) },
  }, Ci: { nsIFile: { NORMAL_FILE_TYPE: 0 } }, Cc: { "@mozilla.org/file/local;1": { createInstance: () => ({
    initWithPath(value) { this.path = value; }, normalize() {}, isDirectory() { return directories.has(this.path); }, equals(other) { return this.path === other.path; },
  }) } }, PathUtils: { join: (base, ...leaves) => {
    assert.ok(leaves.every(leaf => !leaf.includes("/")), "Gecko join accepts leaf names, not nested relative paths");
    return path.posix.join(base, ...leaves);
  }, joinRelative: path.posix.join, filename: path.posix.basename },
  IOUtils: { exists: async p => entries.has(p) || p.endsWith("bookmarkbackups"), stat: async () => ({ type: "regular", size: 200 }),
    read: async p => { calls.push(["read", p]); return p.endsWith("jsonlz4") ? new Uint8Array(12) : new TextEncoder().encode(entries.get(p)); },
    readUTF8: async (p, options) => {
      assert.equal(p, "/home/Library/Application Support/zen/Profiles/work/bookmarkbackups/bookmarks-2026-10-14_6_hash.jsonlz4");
      assert.equal(options.decompress, true);
      return JSON.stringify({ children: [{ guid: "toolbar_____", children: [{ guid: "original", uri: "https://example.org/" }] }] });
    },
    writeUTF8: async (_p, value) => { temporaryText = JSON.parse(value); },
    remove: async p => { assert.equal(p, "/tmp/owned-import.json"); temporaryRemoved = true; },
    getChildren: async p => ["bookmarks-2026-10-01_5_hash.jsonlz4", "bookmarks-2026-10-14_6_hash.jsonlz4", "random.json"].map(name => path.posix.join(p, name)),
  }, ChromeUtils: { importESModule: name => {
    if (name.includes("PrivateBrowsing")) return { PrivateBrowsingUtils: { isWindowPrivate: () => false } };
    if (name.includes("PlacesUtils")) return { PlacesUtils: { history: { makeGuid: () => "fresh-guid" } } };
    if (name.includes("MigrationUtils")) return { MigrationUtils: { getMigrator: async () => ({ hasPermissions: async () => true,
      getSourceProfiles: async () => [{ id: "Profile 1", name: "Person" }] }), MIGRATION_ENTRYPOINTS: { PREFERENCES: "prefs" },
      showMigrationWizard: async (_w, options) => calls.push(["wizard", options]) } };
    if (name.includes("BookmarkJSONUtils")) return { BookmarkJSONUtils: { importFromFile: async (file, options) => {
      calls.push(["import", file, options]); if (failImport) throw Error("import failed"); return 6;
    } } };
    throw Error(name);
  } } });
  const source = fs.readFileSync(path.join(__dirname, "../modules/FluxionImportDiscovery.sys.mjs"), "utf8").replace(/^export /gm, "");
  const adapter = vm.runInContext(`${source}\nforWindow({ closed: false })`, context);
  const result = await adapter.discover();
  assert.equal(result.profiles.length, 3); assert.equal(result.warnings.length, 1);
  assert.equal(calls.length, 2, "only profiles.ini files read during discovery");
  await adapter.transfer(result.profiles[0].id);
  assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1))), ["import",
    "/tmp/owned-import.json", { replace: false }]);
  assert.equal(temporaryText.children[0].children[0].guid, "fresh-guid");
  assert.equal(temporaryRemoved, true);
  failImport = true; temporaryRemoved = false;
  await assert.rejects(adapter.transfer(result.profiles[0].id), /import failed/);
  assert.equal(temporaryRemoved, true, "private temporary copy removed on import failure too");
  await adapter.transfer(result.profiles[2].id);
  assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1))), ["wizard", { entrypoint: "prefs", migratorKey: "chrome", profileId: "Profile 1" }]);
});
