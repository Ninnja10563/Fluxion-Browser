"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), vm = require("node:vm"), path = require("node:path");
const moduleReady = import("../modules/FluxionBrowserImport.sys.mjs");

async function fixture(overrides = {}) {
  const { createBrowserImport } = await moduleReady;
  const calls = [];
  const state = { allowed: true };
  const controller = createBrowserImport({
    allowed: () => state.allowed,
    chooseFile: async kind => { calls.push(["picker", kind]); return kind === "bookmarks" ? "/export.html" : "/export.csv"; },
    stat: async () => ({ type: "regular", size: 20 }),
    importBookmarks: async path => { calls.push(["bookmarks", path]); return 4; },
    importPasswords: async path => { calls.push(["passwords", path]); return [{ result: "added" }, { result: "modified" }, { result: "error_missing_field" }]; },
    openWizard: async source => { calls.push(["wizard", source]); },
    confirmPasswords: () => true, confirmTabs: () => true,
    openTabs: async urls => { calls.push(["tabs", urls]); return urls.length; },
    ...overrides,
  });
  return { controller, calls, state };
}

test("browser import is idle until an explicit action and never routes Zen/Firefox through profile replacement", async () => {
  const h = await fixture(); assert.deepEqual(h.calls, []);
  for (const source of ["zen", "firefox"]) await assert.rejects(h.controller.run("browser", source), /full-profile/);
  assert.deepEqual(h.calls, []);
  assert.deepEqual(await h.controller.run("browser", "chrome"), { state: "wizard" });
  assert.deepEqual(h.calls, [["wizard", "chrome"]]);
  await assert.rejects(h.controller.run("browser", "unknown"), /source/);
});
test("HTML bookmarks and password reports are explicit, bounded transfers", async () => {
  const h = await fixture();
  assert.deepEqual(await h.controller.run("bookmarks", "zen"), { state: "done", kind: "bookmarks", added: 4 });
  assert.deepEqual(await h.controller.run("passwords", "firefox"), { state: "done", kind: "passwords", added: 1, updated: 1, errors: 1 });
  assert.deepEqual(h.calls.map(call => call[0]), ["picker", "bookmarks", "picker", "passwords"]);
});
test("cancelled picker or password warning does not read or import a file", async () => {
  for (const overrides of [{ chooseFile: async () => null }, { confirmPasswords: () => false }]) {
    const h = await fixture(overrides);
    assert.deepEqual(await h.controller.run("passwords"), { state: "cancelled" });
    assert.deepEqual(h.calls, []);
  }
});
test("invalid file types, sizes and policy changes fail before writing browser data", async () => {
  const { IMPORT_FILE_LIMIT } = await moduleReady;
  for (const overrides of [
    { chooseFile: async () => "/profile.jsonlz4" },
    { stat: async () => ({ type: "directory", size: 10 }) },
    { stat: async () => ({ type: "regular", size: 0 }) },
    { stat: async () => ({ type: "regular", size: IMPORT_FILE_LIMIT + 1 }) },
  ]) {
    const h = await fixture(overrides);
    await assert.rejects(h.controller.run("bookmarks"));
    assert.ok(h.calls.every(call => call[0] === "picker"));
  }
  const denied = await fixture(); denied.state.allowed = false;
  await assert.rejects(denied.controller.run("bookmarks"), /unavailable/); assert.deepEqual(denied.calls, []);
  let h;
  h = await fixture({ chooseFile: async () => { h.state.allowed = false; return "/export.html"; } });
  await assert.rejects(h.controller.run("bookmarks"), /unavailable/); assert.deepEqual(h.calls, []);
});
test("overlapping import requests are refused and failures release the busy state", async () => {
  let resolve;
  const h = await fixture({ chooseFile: () => new Promise(done => { resolve = done; }) });
  const pending = h.controller.run("bookmarks");
  assert.deepEqual(await h.controller.run("passwords"), { state: "busy" });
  resolve(null); await pending;
  assert.deepEqual(await h.controller.run("browser", "chrome"), { state: "wizard" });
});
test("tab transfer validates the entire list, deduplicates web links, rejects privileged URLs and requires confirmation", async () => {
  const { parseTabURLs } = await moduleReady;
  assert.deepEqual(parseTabURLs("https://example.com\nhttps://example.com/\nhttp://another.example/a"), ["https://example.com/", "http://another.example/a"]);
  for (const input of ["", "javascript:alert(1)", "about:config", "file:///secret", "https://user:password@example.com", "bad url",
    Array.from({ length: 101 }, (_, i) => `https://example.com/${i}`).join("\n"), " ".repeat(262145)]) assert.throws(() => parseTabURLs(input));
  const h = await fixture();
  await assert.rejects(h.controller.tabs("https://example.com\nfile:///secret")); assert.deepEqual(h.calls, []);
  assert.deepEqual(await h.controller.tabs("https://example.com"), { state: "done", kind: "tabs", added: 1 });
  const cancelled = await fixture({ confirmTabs: () => false });
  assert.deepEqual(await cancelled.controller.tabs("https://example.com"), { state: "cancelled" }); assert.deepEqual(cancelled.calls, []);
});

test("native import adapter appends bookmarks, selects Chrome and creates dormant workspace tabs without selecting them", async () => {
  const calls = []; let privateWindow = false, policyAllowed = true;
  const window = { closed: false, browsingContext: {},
    FluxionUI: { currentWorkspace: () => "work", workspaces: () => [{ id: "work" }], setTabWorkspace: (tab, workspace) => calls.push(["workspace", tab.url, workspace]) },
    gBrowser: { addTrustedTab: (url, options) => { calls.push(["tab", url, options]); return { url }; } },
  };
  const context = vm.createContext({ URL, window, Services: {
    policies: { isAllowed: key => { assert.equal(key, "profileImport"); return policyAllowed; } },
    prompt: { confirm: () => true },
  }, IOUtils: { stat: async () => ({ type: "regular", size: 10 }) },
  Ci: { nsIFilePicker: { modeOpen: 0, returnOK: 1 } },
  Cc: { "@mozilla.org/filepicker;1": { createInstance: () => ({
    init() {}, appendFilter() {}, file: { path: "/selected.html" }, open: callback => callback(1),
  }) } },
  ChromeUtils: { importESModule: uri => {
    if (uri.includes("PrivateBrowsingUtils")) return { PrivateBrowsingUtils: { isWindowPrivate: () => privateWindow } };
    if (uri.includes("BookmarkHTMLUtils")) return { BookmarkHTMLUtils: { importFromFile: async (...args) => { calls.push(["bookmark", ...args]); return 2; } } };
    if (uri.includes("MigrationUtils")) return { MigrationUtils: { MIGRATION_ENTRYPOINTS: { PREFERENCES: "preferences" }, showMigrationWizard: async (_window, options) => calls.push(["wizard", options]) } };
    throw Error(`Unexpected import ${uri}`);
  } } });
  const source = fs.readFileSync(path.join(__dirname, "../modules/FluxionBrowserImport.sys.mjs"), "utf8").replace(/^export /gm, "");
  const adapter = vm.runInContext(`${source}\nforWindow(window)`, context);
  await adapter.run("bookmarks", "zen");
  await adapter.run("browser", "chrome");
  await adapter.tabs("https://example.com");
  const records = JSON.parse(JSON.stringify(calls));
  assert.deepEqual(records, [
    ["bookmark", "/selected.html", { replace: false }],
    ["wizard", { entrypoint: "preferences", migratorKey: "chrome" }],
    ["tab", "https://example.com/", { createLazyBrowser: true, skipAnimation: true }],
    ["workspace", "https://example.com/", "work"],
  ]);
  privateWindow = true; await assert.rejects(adapter.run("bookmarks"), /unavailable/);
  privateWindow = false; policyAllowed = false; await assert.rejects(adapter.tabs("https://example.com"), /unavailable/);
  assert.equal(calls.length, 4);
});
