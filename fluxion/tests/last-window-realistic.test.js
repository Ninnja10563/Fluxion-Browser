"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../chrome/fluxion-last-window-verification.js"), "utf8");

test("native last-window gate closes immediately without a test-only preclose state flush or delay", async () => {
  const calls = [], win = { closed: false, BrowserCommands: { tryToCloseWindow() { calls.push("close"); win.closed = true; } } };
  const start = source.indexOf("  async function close(win)"), end = source.indexOf("  async function closedNormal", start);
  const context = vm.createContext({ mode: "seed", closeNumber: 0, recordLifecycle: stage => calls.push(stage),
    wait: async () => calls.push("postclose-wait"), until: async predicate => assert.equal(predicate(), true) });
  vm.runInContext(source.slice(start, end), context);
  await context.close(win);
  assert.deepEqual(calls, ["close-1-without-test-flush", "close", "close-1-closed", "postclose-wait", "close-1-settled"]);
});

test("stored restore preference close does not collect the live window state for diagnostics", async () => {
  const calls = [], win = { closed: false, BrowserCommands: { tryToCloseWindow() { calls.push("close"); win.closed = true; } } };
  const start = source.indexOf("  async function close(win)"), end = source.indexOf("  async function closedNormal", start);
  const context = vm.createContext({ mode: "existing", closeNumber: 0,
    recordLifecycle(stage, liveWindow) { assert.ok(!liveWindow, "diagnostics must not collect live session state"); calls.push(stage); },
    wait: async () => calls.push("postclose-wait"), until: async predicate => assert.equal(predicate(), true) });
  vm.runInContext(source.slice(start, end), context);
  await context.close(win);
  assert.deepEqual(calls, ["close-1-without-test-flush", "close", "close-1-closed", "postclose-wait", "close-1-settled"]);
});

function checkpointFixture(mode) {
  const calls = [], evidence = { checks: [] }, urls = ["data:pinned", "data:first", "data:second"];
  const closed = { _shouldRestore: true }, disk = { windows: [{ urls: [...urls] }] };
  const context = vm.createContext({ mode, evidence, urls,
    SessionSaver: { run: async () => calls.push("save") },
    closedNormal: async () => { calls.push("closed-record"); return closed; },
    IOUtils: { readJSON: async () => { calls.push("read-disk"); return disk; } },
    PathUtils: { profileDir: "/isolated", join: (...parts) => parts.join("/") },
    stateURLs: state => state.urls, ensure: (ok, message) => { if (!ok) throw Error(message); } });
  const start = source.indexOf("  async function verifyFinalCheckpoint()"), end = source.indexOf("  async function run()", start);
  assert.ok(start >= 0 && end > start);
  vm.runInContext(source.slice(start, end), context);
  return { calls, evidence, closed, disk, run: () => context.verifyFinalCheckpoint() };
}

test("stored restore preference reaches normal quit without test-forced session saves or checkpoint reads", async () => {
  const f = checkpointFixture("existing");
  await f.run();
  assert.deepEqual(f.calls, []);
  assert.equal(f.evidence.checks[0].label, "zero-window-before-natural-quit");
  assert.equal(f.evidence.checks[0].testTriggeredSave, false);
});

test("fresh seed retains repeated checkpoint checks and rejects missing sessions or private persistence", async () => {
  const f = checkpointFixture("seed");
  await f.run();
  assert.deepEqual(f.calls, ["save", "save", "closed-record", "read-disk"]);
  assert.equal(f.evidence.checks[0].privateExcluded, true);
  const consumed = checkpointFixture("seed"); consumed.closed._shouldRestore = false;
  await assert.rejects(consumed.run(), /consumed the live undo-close record/);
  const missing = checkpointFixture("seed"); missing.disk.windows[0].urls.pop();
  await assert.rejects(missing.run(), /did not project the closed last window/);
  const leaked = checkpointFixture("seed"); leaked.disk.windows[0].urls.push("data:private-never-persist");
  await assert.rejects(leaked.run(), /private marker entered disk checkpoint/);
});

function verifierFixture() {
  const urls = ["data:pinned", "data:first", "data:second"], checks = [];
  const tabs = urls.map((url, index) => ({ entries: [{ url }], index: 1, pinned: index === 0,
    extData: { "fluxion-last-window-tab": index === 1 ? "retained" : index === 2 ? "second-workspace" : "" } }));
  const state = { tabs, selected: 3, extData: { "fluxion-last-window-fixture": "retained",
    "fluxion-last-window-workspaces": JSON.stringify({ first: "a", second: "b" }) } };
  const nativeTabs = urls.map((url, index) => ({ linkedBrowser: { currentURI: { spec: url } },
    workspace: index === 2 ? "b" : "a", extData: tabs[index].extData }));
  const win = { gBrowser: { tabs: nativeTabs, selectedBrowser: nativeTabs[2].linkedBrowser }, FluxionUI: { tabWorkspace: tab => tab.workspace } };
  const context = vm.createContext({ urls, privateURL: "data:private", externalURL: "data:external", evidence: { checks },
    stateOf: () => state, stateURLs: value => value.tabs.map(tab => tab.entries[0].url),
    SessionStore: { getCustomTabValue: (tab, key) => tab.extData[key] },
    ensure: (ok, message) => { if (!ok) throw Error(message); } });
  const start = source.indexOf("  function verifyTabs("), end = source.indexOf("  async function ready(", start);
  vm.runInContext(source.slice(start, end), context);
  return { state, nativeTabs, run: () => context.verifyTabs(win, "restored"), checks };
}

test("recovery gate accepts native lazy hidden tabs only with retained workspace/session identities", () => {
  const f = verifierFixture();
  f.nativeTabs[1].linkedBrowser.currentURI.spec = "about:blank";
  f.run(); assert.equal(f.checks.length, 1);
  f.nativeTabs[1].workspace = "b";
  assert.throws(f.run, /workspace tab mapping lost/);
});
test("recovery gate rejects lost workspace metadata and unexpected private data", () => {
  const lost = verifierFixture(); delete lost.state.extData["fluxion-last-window-workspaces"];
  assert.throws(lost.run, /workspace fixture metadata lost/);
  const privateData = verifierFixture(); privateData.state.tabs.push({ entries: [{ url: "data:private" }] });
  assert.throws(privateData.run, /private tab escaped/);
});
