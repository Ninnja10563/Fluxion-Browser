"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../chrome/fluxion-product-chrome-verification.js"), "utf8");
function block(start, end) {
  const first = source.indexOf(start), last = source.indexOf(end, first);
  assert.ok(first > 0 && last > first);
  return source.slice(first, last);
}

function promptFixture({ title = "New Folder", type = "prompt", foreign = false, visible = true } = {}) {
  let observer, removed = false, clicked = false;
  const window = { setTimeout() { return 1; }, clearTimeout() {} };
  const field = { value: "", visible }, button = { visible, disabled: false, click() { clicked = true; } };
  const sandbox = vm.createContext({ window, Services: { obs: {
    addObserver(value, topic) { assert.equal(topic, "common-dialog-loaded"); observer = value; },
    removeObserver(value, topic) { assert.equal(value, observer); assert.equal(topic, "common-dialog-loaded"); removed = true; },
  } }, painted: node => node?.visible,
  async wait(predicate, message) { if (!predicate()) throw Error(message); } });
  vm.runInContext(block("  function answerFolderPrompt(", "  function folderIdentityEvidence("), sandbox);
  const handler = sandbox.answerFolderPrompt("Research");
  const subject = { opener: foreign ? {} : window, Dialog: { args: { title, promptType: type },
    ui: { loginTextbox: field, button0: button } } };
  return { handler, field, notify() { observer.observe(subject); }, clicked: () => clicked, removed: () => removed };
}

test("native folder prompt gate completes only the owned visible naming prompt and removes observer", async () => {
  const h = promptFixture(); h.notify();
  const evidence = await h.handler.promise;
  assert.equal(h.field.value, "Research");
  assert.equal(h.clicked(), true);
  assert.equal(h.removed(), true);
  assert.equal(evidence.renderedPrompt, true);
});

test("native folder prompt gate refuses unrelated prompt types, titles, hidden fields and foreign windows", async () => {
  for (const options of [{ title: "Password" }, { type: "promptPassword" }, { visible: false }]) {
    const h = promptFixture(options); h.notify();
    await assert.rejects(h.handler.promise, /Unexpected|visible/);
    assert.equal(h.field.value, ""); assert.equal(h.clicked(), false); assert.equal(h.removed(), true);
  }
  const h = promptFixture({ foreign: true }); h.notify();
  assert.equal(h.field.value, ""); assert.equal(h.clicked(), false); assert.equal(h.removed(), false);
  h.handler.dispose(); await assert.rejects(h.handler.promise, /without confirmation/);
});

test("native folder identity gate rejects replacement tabs, browsers, browsing contexts and containers", () => {
  for (const change of [null, "tab", "browser", "context", "container", "key", "count"]) {
    const browser = { browsingContext: {}, permanentKey: {} };
    let container = "1";
    const tab = { linkedBrowser: browser, getAttribute: () => container };
    const gBrowser = { tabs: [tab] };
    const snapshot = { browser, context: browser.browsingContext, container,
      permanentKey: browser.permanentKey, tabCount: 1 };
    const sandbox = vm.createContext({ gBrowser, assert(value, message) { if (!value) throw Error(message); } });
    vm.runInContext(block("  function folderIdentityEvidence(", "  async function workspaceFolders("), sandbox);
    if (change === "tab") gBrowser.tabs = [{}];
    if (change === "browser") tab.linkedBrowser = { ...browser };
    if (change === "context") browser.browsingContext = {};
    if (change === "container") container = "2";
    if (change === "key") browser.permanentKey = {};
    if (change === "count") gBrowser.tabs.push({});
    if (change) assert.throws(() => sandbox.folderIdentityEvidence(tab, snapshot), /recreated|container/);
    else assert.equal(sandbox.folderIdentityEvidence(tab, snapshot).userContextId, "1");
  }
});

test("native product gate executes folder commands, checks real window serialization and runs before health success", () => {
  assert.match(source, /create\.doCommand\(\)/);
  assert.doesNotMatch(source, /submenu\.openPopup\(/);
  assert.match(source, /await key\("right"\)/);
  assert.match(source, /await key\("return"\)/);
  assert.match(source, /command === destination/);
  assert.match(source, /submenu\.state === "open" && tabMenu\.state === "open"/);
  assert.ok(source.indexOf('"Move to Folder command did not put the same tab in the folder projection"') <
    source.indexOf("submenu.hidePopup(); tabMenu.hidePopup();"), "do not dismiss asynchronous Gecko commands before they execute");
  assert.match(source, /SessionStore\.getWindowState\(window\)/);
  assert.match(source, /state\.windows\[0\]\.extData\?\.\[key\]/);
  assert.match(source, /emptyBox\.bottom <= dividerBox\.top/);
  assert.match(source, /await workspaceFolders\(\);/);
  assert.ok(source.indexOf("await workspaceFolders();") < source.indexOf('run().then(() => Services.prefs.setStringPref(`${prefix}.health`'));
});
