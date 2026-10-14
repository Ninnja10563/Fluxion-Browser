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
  const context = vm.createContext({ TextDecoder, Services: {
    appinfo: { OS: "Darwin" }, policies: { isAllowed: () => true }, prompt: { confirm: () => true },
    dirsvc: { get: key => ({ path: key === "Home" ? "/home" : "/fluxion" }) },
  }, Ci: {}, Cc: { "@mozilla.org/file/local;1": { createInstance: () => ({
    initWithPath(value) { this.path = value; }, normalize() {}, isDirectory() { return directories.has(this.path); }, equals(other) { return this.path === other.path; },
  }) } }, PathUtils: { join: path.posix.join, filename: path.posix.basename },
  IOUtils: { exists: async p => entries.has(p) || p.endsWith("bookmarkbackups"), stat: async () => ({ type: "regular", size: 200 }),
    read: async p => { calls.push(["read", p]); return new TextEncoder().encode(entries.get(p)); },
    getChildren: async p => ["bookmarks-2026-10-01_5_hash.jsonlz4", "bookmarks-2026-10-14_6_hash.jsonlz4", "random.json"].map(name => path.posix.join(p, name)),
  }, ChromeUtils: { importESModule: name => {
    if (name.includes("PrivateBrowsing")) return { PrivateBrowsingUtils: { isWindowPrivate: () => false } };
    if (name.includes("MigrationUtils")) return { MigrationUtils: { getMigrator: async () => ({ hasPermissions: async () => true,
      getSourceProfiles: async () => [{ id: "Profile 1", name: "Person" }] }), MIGRATION_ENTRYPOINTS: { PREFERENCES: "prefs" },
      showMigrationWizard: async (_w, options) => calls.push(["wizard", options]) } };
    if (name.includes("BookmarkJSONUtils")) return { BookmarkJSONUtils: { importFromFile: async (file, options) => { calls.push(["import", file, options]); return 6; } } };
    throw Error(name);
  } } });
  const source = fs.readFileSync(path.join(__dirname, "../modules/FluxionImportDiscovery.sys.mjs"), "utf8").replace(/^export /gm, "");
  const adapter = vm.runInContext(`${source}\nforWindow({ closed: false })`, context);
  const result = await adapter.discover();
  assert.equal(result.profiles.length, 3); assert.equal(result.warnings.length, 1);
  assert.equal(calls.length, 2, "only profiles.ini files read during discovery");
  await adapter.transfer(result.profiles[0].id);
  assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1))), ["import",
    "/home/Library/Application Support/zen/Profiles/work/bookmarkbackups/bookmarks-2026-10-14_6_hash.jsonlz4", { replace: false }]);
  await adapter.transfer(result.profiles[2].id);
  assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1))), ["wizard", { entrypoint: "prefs", migratorKey: "chrome", profileId: "Profile 1" }]);
});
