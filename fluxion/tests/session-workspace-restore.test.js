"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const script = fs.readFileSync(path.join(__dirname, "../chrome/fluxion-session-recovery.js"), "utf8");
const start = script.indexOf("    const switchAndRestore = async");
const end = script.indexOf("    await switchAndRestore(primary", start);
assert.ok(start >= 0 && end > start, "native workspace restoration helper must exist");

function fixture({ wrongTab = false, complete = true } = {}) {
  const url = "https://example.com/?fluxion-session=focus-active";
  const tab = { parentNode: {}, linkedBrowser: { currentURI: { spec: url } } };
  let workspace = "build";
  const browserWindow = {
    gBrowser: { selectedTab: null },
    FluxionUI: {
      currentWorkspace: () => workspace,
      switchWorkspace(id) {
        workspace = id;
        tab.linkedBrowser.currentURI.spec = "about:blank";
        browserWindow.gBrowser.selectedTab = wrongTab
          ? { parentNode: {}, linkedBrowser: { currentURI: { spec: url } } }
          : tab;
      },
    },
  };
  let observations = 0;
  const context = {
    tabURL: candidate => candidate.linkedBrowser.currentURI.spec,
    async waitFor(check) {
      let result;
      for (let index = 0; index < 4; index += 1) {
        observations += 1;
        if (complete && index === 2) tab.linkedBrowser.currentURI.spec = url;
        result = await check();
        if (result.ok) return result;
      }
      return result;
    },
  };
  vm.runInNewContext(`${script.slice(start, end)}\nglobalThis.run = switchAndRestore;`, context);
  return { run: () => context.run(browserWindow, "focus", tab, url), observations: () => observations };
}

test("native workspace gate waits for a lazy browser while preserving immediate tab identity", async () => {
  const state = fixture();
  await state.run();
  assert.equal(state.observations(), 3);
});

test("native workspace gate rejects a wrong selected tab even when its URL matches", async () => {
  const state = fixture({ wrongTab: true });
  await assert.rejects(state.run(), /did not immediately select and retain its remembered native tab/);
  assert.equal(state.observations(), 0);
});

test("native workspace gate rejects a selected page that never finishes restoring", async () => {
  const state = fixture({ complete: false });
  await assert.rejects(state.run(), /selected the right tab but its page did not restore: about:blank/);
  assert.equal(state.observations(), 4);
});
