"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

function harness() {
  const source = fs.readFileSync(path.join(__dirname, "../chrome/fluxion-browsing-verification.js"), "utf8");
  const helper = source.slice(source.indexOf("  function nativeAuthPrompt("), source.indexOf("  async function verifyBasicAuth("));
  const observers = new Set(), timers = new Map(), listeners = new Map();
  const browser = {}, browsingContext = {}, calls = [];
  let nextTimer = 0;
  const window = { setTimeout(fn) { timers.set(++nextTimer, fn); return nextTimer; }, clearTimeout(id) { timers.delete(id); },
    addEventListener(type, fn) { listeners.set(type, fn); }, removeEventListener(type) { listeners.delete(type); } };
  const field = () => ({ value: "", getBoundingClientRect: () => ({ height: 20 }) });
  const ui = { loginTextbox: field(), password1Textbox: field(),
    button0: { disabled: false, getBoundingClientRect: () => ({ height: 20 }), click() { calls.push("accept"); } },
    button1: { disabled: false, getBoundingClientRect: () => ({ height: 20 }), click() { calls.push("cancel"); } } };
  const expectedURL = "http://127.0.0.1:1234/basic-accept/";
  const subject = { opener: window, browsingContext, Dialog: { ui,
    args: { modalType: 3, promptType: "promptUserAndPass", channel: { URI: { spec: expectedURL } } } } };
  const context = vm.createContext({ window,
    gBrowser: { getTabDialogBox(actual) { assert.equal(actual, browser); return {
      getTabDialogManager: () => ({ _dialogs: [{ _frame: { browsingContext } }] }),
    }; } },
    Services: { prompt: { MODAL_TYPE_TAB: 3 }, obs: { addObserver(observer) { observers.add(observer); }, removeObserver(observer) { observers.delete(observer); } } },
    waitFor: async predicate => { if (!predicate()) throw new Error("action unavailable"); },
    assert(condition, message) { assert.ok(condition, message); },
  });
  const create = vm.runInContext(`${helper}\nnativeAuthPrompt`, context);
  return { start: mode => create(browser, expectedURL, mode), subject, ui, calls, timers, listeners, observers,
    notify(value = subject) { for (const observer of [...observers]) observer.observe(value); } };
}

test("native auth helper operates only the expected browser dialog and cleans up after acceptance", async () => {
  const h = harness(), operation = h.start("accept");
  h.notify({ ...h.subject, opener: {} });
  h.notify({ ...h.subject, browsingContext: {} });
  assert.deepEqual(h.calls, []);
  h.notify();
  const result = await operation.promise;
  assert.equal(result.nativeTabDialog, true);
  assert.deepEqual(h.calls, ["accept"]);
  assert.equal(h.ui.loginTextbox.value, "fluxion");
  assert.equal(h.ui.password1Textbox.value, "fixture-only");
  assert.equal(h.observers.size + h.timers.size + h.listeners.size, 0);
});

test("cancel never supplies credentials and a wrong request path is rejected untouched", async () => {
  const canceled = harness(), operation = canceled.start("cancel");
  canceled.notify(); await operation.promise;
  assert.deepEqual(canceled.calls, ["cancel"]);
  assert.equal(canceled.ui.loginTextbox.value + canceled.ui.password1Textbox.value, "");
  const wrong = harness(), rejected = wrong.start("accept");
  wrong.subject.Dialog.args.channel.URI.spec = "http://127.0.0.1:1234/unrelated/";
  wrong.notify();
  await assert.rejects(rejected.promise, /unexpected native authentication prompt/);
  assert.deepEqual(wrong.calls, []);
  assert.equal(wrong.ui.loginTextbox.value + wrong.ui.password1Textbox.value, "");
  assert.equal(wrong.observers.size + wrong.timers.size + wrong.listeners.size, 0);
});

test("timeout and unload remove native observers without touching any prompt", async () => {
  for (const reason of ["timeout", "unload"]) {
    const h = harness(), operation = h.start("accept");
    if (reason === "timeout") [...h.timers.values()][0](); else h.listeners.get("unload")();
    await assert.rejects(operation.promise, /timed out|unloaded/);
    assert.equal(h.observers.size + h.timers.size + h.listeners.size, 0);
    assert.deepEqual(h.calls, []);
  }
});

test("native auth response verification requires the actual fixture body and performs a real-browser reload call", async () => {
  const source = fs.readFileSync(path.join(__dirname, "../chrome/fluxion-browsing-verification.js"), "utf8");
  const verify = source.slice(source.indexOf("  async function verifyBasicAuth("), source.indexOf("  async function run("));
  for (const valid of [true, false]) {
    let reloads = 0;
    const context = vm.createContext({ report: { checks: {} }, origin: "http://127.0.0.1:1234", window: {},
      tab: { linkedBrowser: { browsingContext: { currentWindowGlobal: {} }, reload() { reloads++; } } },
      Services: { obs: { addObserver() {}, removeObserver() {} } },
      nativeAuthPrompt(_browser, url, mode) { return { promise: Promise.resolve({ mode, url }), dispose() {} }; },
      async navigate(path, _expected, title) {
        assert.equal(title, path.includes("cancel") ? "Fluxion basic cancel challenge" : "Fluxion basic accept authenticated");
        return { text: path.includes("cancel") ? "HTTP Basic authentication required" :
          valid ? "HTTP Basic authentication verified" : "unrelated page" };
      },
      async pageAt(url, title) { assert.match(url, /basic-accept\/$/); assert.equal(title, "Fluxion basic accept authenticated"); },
      assert(condition, message) { assert.ok(condition, message); },
    });
    const run = vm.runInContext(`${verify}\nverifyBasicAuth`, context);
    if (valid) { await run(); assert.equal(reloads, 1); }
    else { await assert.rejects(run(), /real response content/); assert.equal(reloads, 0); }
  }
});
