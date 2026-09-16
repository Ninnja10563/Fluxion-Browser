"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const recovery = fs.readFileSync(path.join(__dirname, "../chrome/fluxion-session-recovery.js"), "utf8");
const lastWindow = fs.readFileSync(path.join(__dirname, "../chrome/fluxion-last-window-verification.js"), "utf8");

test("last-window verifier reads Gecko155 structured window state without treating it as JSON text", () => {
  const line = lastWindow.match(/  const stateOf =[^\n]+/)[0];
  const win = {}, expected = { tabs: [{ entries: [{ url: "https://retained.example/" }] }] };
  const state = vm.runInNewContext(`${line}\nstateOf(win)`, {
    win, SessionStore: { getWindowState(actual) { assert.equal(actual, win); return { windows: [expected] }; } },
  });
  assert.equal(state, expected);
});

test("recovery fixture cannot adopt/checkpoint while either background Focus page remains blank or busy", () => {
  const code = recovery.slice(recovery.indexOf("    const seededPages = ["), recovery.indexOf("    if (!sourceReady.ok)"));
  const names = ["groupA", "groupB", "splitA", "splitB", "pinned", "companionBuild", "companionLife", "focusIdle", "focusActive"];
  const urls = Object.fromEntries(names.map(name => [name, `https://fixture.example/${name}`]));
  const tabs = Object.fromEntries(names.map(name => [name, { url: urls[name], busy: false, hasAttribute() { return this.busy; } }]));
  const context = {
    urls, groupTabs: [tabs.groupA, tabs.groupB], splitTabs: [tabs.splitA, tabs.splitB],
    pinned: tabs.pinned, companionBuild: tabs.companionBuild, companionLife: tabs.companionLife,
    focusTabs: [tabs.focusIdle, tabs.focusActive], tabURL: tab => tab.url,
    waitFor: check => check(),
  };
  const ready = () => vm.runInNewContext(code.replace("await waitFor", "waitFor") + "\nsourceReady.ok", { ...context });
  assert.equal(ready(), true);
  for (const name of names) {
    tabs[name].url = "about:blank";
    assert.equal(ready(), false, `${name} must finish navigating before checkpoint`);
    tabs[name].url = urls[name]; tabs[name].busy = true;
    assert.equal(ready(), false, `${name} must finish loading before adoption`);
    tabs[name].busy = false;
  }
  tabs.focusIdle.url = urls.focusActive;
  assert.equal(ready(), false, "another expected URL cannot substitute for this tab's own URL");
});
