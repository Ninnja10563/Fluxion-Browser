"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../chrome/fluxion-last-window-verification.js"), "utf8");

test("native last-window gate closes immediately without a test-only preclose state flush or delay", async () => {
  const calls = [], win = { closed: false, BrowserCommands: { tryToCloseWindow() { calls.push("close"); win.closed = true; } } };
  const start = source.indexOf("  async function close(win,"), end = source.indexOf("  async function closedNormal", start);
  const context = vm.createContext({ mode: "seed", closeNumber: 0, recordLifecycle: stage => calls.push(stage),
    wait: async () => calls.push("postclose-wait"), until: async predicate => assert.equal(predicate(), true) });
  vm.runInContext(source.slice(start, end), context);
  await context.close(win);
  assert.deepEqual(calls, ["close-1-without-test-flush", "close", "close-1-closed", "postclose-wait", "close-1-settled"]);
});

test("stored restore preference close does not collect the live window state for diagnostics", async () => {
  const calls = [], win = { closed: false, BrowserCommands: { tryToCloseWindow() { calls.push("close"); win.closed = true; } } };
  const start = source.indexOf("  async function close(win,"), end = source.indexOf("  async function closedNormal", start);
  const context = vm.createContext({ mode: "existing", closeNumber: 0,
    recordLifecycle(stage, liveWindow) { assert.ok(!liveWindow, "diagnostics must not collect live session state"); calls.push(stage); },
    wait: async () => calls.push("postclose-wait"), until: async predicate => assert.equal(predicate(), true) });
  vm.runInContext(source.slice(start, end), context);
  await context.close(win);
  assert.deepEqual(calls, ["close-1-without-test-flush", "close", "close-1-closed", "postclose-wait", "close-1-settled"]);
});

test("native window-button close delegates only to its driver without a fallback tab/window command", async () => {
  const calls = [], win = { closed: false, BrowserCommands: { tryToCloseWindow() { throw Error("Fallback command bypassed native control"); } } };
  const start = source.indexOf("  async function close(win,"), end = source.indexOf("  async function closedNormal", start);
  const context = vm.createContext({ mode: "existing", closeNumber: 0, recordLifecycle: () => {},
    requestNativeClose: async (target, ordinal) => { assert.equal(target, win); assert.equal(ordinal, 1); calls.push("AXPress"); win.closed = true; },
    wait: async () => {}, until: async predicate => assert.equal(predicate(), true) });
  vm.runInContext(source.slice(start, end), context);
  await context.close(win, { nativeButton: true });
  assert.deepEqual(calls, ["AXPress"]);
});

test("native close driver request is scoped to one non-private normal window and records no test-forced save", async () => {
  const requests = [], evidence = { checks: [] }, win = { toolbar: { visible: true } };
  let current = [win], privateWindow = false;
  const context = vm.createContext({ mode: "existing", root: "/isolated", evidence,
    windows: () => current, PrivateBrowsingUtils: { isWindowPrivate: () => privateWindow },
    Services: { appinfo: { processID: 2468 } }, PathUtils: { join: (...parts) => parts.join("/") },
    IOUtils: { writeUTF8: async (...args) => requests.push(args), exists: async candidate => candidate === "/isolated/existing-close-4.sent" },
    ensure: (ok, message) => { if (!ok) throw Error(message); }, wait: async () => {} });
  const start = source.indexOf("  async function requestNativeClose("), end = source.indexOf("  async function close(win,", start);
  vm.runInContext(source.slice(start, end), context);
  await context.requestNativeClose(win, 4);
  assert.deepEqual(requests, [["/isolated/existing-close-4.ready", "2468"]]);
  assert.equal(evidence.checks[0].testTriggeredSave, false);
  current = [win, {}]; await assert.rejects(context.requestNativeClose(win, 4), /exactly one normal/);
  current = [win]; privateWindow = true; await assert.rejects(context.requestNativeClose(win, 4), /exactly one normal/);
  privateWindow = false; win.toolbar.visible = false; await assert.rejects(context.requestNativeClose(win, 4), /exactly one normal/);
  assert.equal(requests.length, 1);
});

function emptyWindowFixture({ closesWindow = false, duplicateReplacement = false, isPrivate = false } = {}) {
  const checks = [], inputs = [], loaded = [];
  const browser = { tabs: [], selectedTab: null, get selectedBrowser() { return this.selectedTab.linkedBrowser; } };
  const newTab = () => {
    const tab = { parentNode: {}, workspace: "focus", hasAttribute: () => false,
      linkedBrowser: { currentURI: { spec: "about:blank" }, loadURI(uri) { this.currentURI = uri; loaded.push(uri.spec); } } };
    browser.tabs.push(tab); browser.selectedTab = tab; return tab;
  };
  newTab();
  const win = { closed: false, gBrowser: browser, FluxionUI: {
    setSidebarState: () => {}, currentWorkspace: () => "focus", tabWorkspace: tab => tab.workspace, newTab,
  } };
  const remove = tabs => {
    if (closesWindow) { win.closed = true; return; }
    for (const tab of tabs) tab.parentNode = null;
    browser.tabs = browser.tabs.filter(tab => !tabs.includes(tab));
    newTab(); if (duplicateReplacement) newTab();
  };
  browser.removeTabs = tabs => { inputs.push("bulk"); remove(tabs); };
  const context = vm.createContext({ evidence: { checks }, marker: value => `data:${value}`,
    Services: { io: { newURI: spec => ({ spec }) }, scriptSecurityManager: { getSystemPrincipal: () => ({}) } },
    PrivateBrowsingUtils: { isWindowPrivate: () => isPrivate },
    closeTabWithInput: async (target, tab, input) => { assert.equal(target, win); inputs.push(input); remove([tab]); },
    until: async (predicate, message) => { if (!predicate()) throw Error(message); },
    ensure: (ok, message) => { if (!ok) throw Error(message); } });
  const start = source.indexOf("  async function verifyEmptyWindowTab("), end = source.indexOf("  async function verifyLastWorkspaceTab(", start);
  vm.runInContext(source.slice(start, end), context);
  return { checks, inputs, loaded, run: () => context.verifyEmptyWindowTab(win) };
}

test("final-tab native gate exercises both single-tab inputs and actual bulk removal with one replacement", async () => {
  for (const isPrivate of [false, true]) {
    const f = emptyWindowFixture({ isPrivate }); await f.run();
    assert.deepEqual(f.inputs, ["native-cmd-w-handler", "flow-widget-close-button", "bulk"]);
    assert.equal(f.checks.length, 3);
    assert.ok(f.checks.every(check => check.replacementTabCount === 1 && check.private === isPrivate));
    assert.equal(f.loaded.length, 3);
    assert.ok(f.loaded.every(url => url.includes("private-never-persist") === isPrivate));
  }
});

test("final-tab gate fails if the window closes or multiple replacements remain", async () => {
  await assert.rejects(emptyWindowFixture({ closesWindow: true }).run(), /final tab closed the normal browser window/);
  await assert.rejects(emptyWindowFixture({ duplicateReplacement: true }).run(), /empty replacement tab did not settle/);
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
  const start = source.indexOf("  async function verifyFinalCheckpoint()"), end = source.indexOf("  function verifyStartupChoice(", start);
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

function startupFixture(mode, userValue) {
  const calls = [], checks = [], defaultValue = 3;
  const prefs = {
    getIntPref: () => userValue ?? defaultValue,
    getDefaultBranch: () => ({ getIntPref: () => defaultValue }),
    prefHasUserValue: () => userValue !== undefined,
    setIntPref(name, value) { calls.push([name, value]); userValue = value === defaultValue ? undefined : value; },
  };
  const context = vm.createContext({ mode, Services: { prefs }, evidence: { checks },
    ensure: (ok, message) => { if (!ok) throw Error(message); } });
  const start = source.indexOf("  function verifyStartupChoice("), end = source.indexOf("  async function run()", start);
  vm.runInContext(source.slice(start, end), context);
  return { calls, checks, select: () => context.selectExplicitRestore(), verify: () => context.verifyStartupChoice("fixture") };
}

test("explicit restore fixture supports Gecko clearing a same-default user value without changing the default", () => {
  const f = startupFixture("existing");
  f.select();
  assert.deepEqual(f.calls, [["browser.startup.page", 1], ["browser.startup.page", 3]]);
  assert.equal(f.checks[0].startupValue, 3);
  assert.equal(f.checks[0].defaultValue, 3);
  assert.equal(f.checks[0].hasUserValue, false);
  startupFixture("existing-restore").verify();
  for (const value of [0, 1]) assert.throws(() => startupFixture("existing-restore", value).verify(), /startup choice changed/);
});

test("fresh-profile restore still requires an untouched default and relaunch verification never rewrites a choice", () => {
  for (const mode of ["seed", "restore"]) {
    const fresh = startupFixture(mode); fresh.verify(); assert.deepEqual(fresh.calls, []);
    assert.throws(() => startupFixture(mode, 3).verify(), /replaced by a user preference/);
  }
  const optedOut = startupFixture("existing-restore", 1);
  assert.throws(optedOut.verify, /startup choice changed/);
  assert.deepEqual(optedOut.calls, []);
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
