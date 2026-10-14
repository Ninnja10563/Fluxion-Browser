"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const settingsWindow = require("./settings-window-fixture.js");
function fixture(browserImport) {
  const clipboard = [];
  const h = settingsWindow("about:preferences", [], { browserImport, clipboard });
  return { ...h, clipboard, get: id => h.document.getElementById(`fluxion-${id}`) };
}
test("Import data has explicit Zen/Firefox export guidance, Chrome wizard and no startup imports", async () => {
  const calls = [];
  const h = fixture({ run: async (...args) => { calls.push(args); return { state: "wizard" }; } });
  assert.deepEqual(h.errors, []); assert.deepEqual(calls, []);
  h.choose("Import data");
  assert.equal(h.section(), "import");
  assert.equal(h.get("import-browser").disabled, true);
  assert.match(h.get("import-source-help").textContent, /Zen.*HTML.*CSV/);
  const source = h.get("import-source"); source.value = "chrome"; await source.dispatchEvent({ type: "change" });
  assert.equal(h.get("import-browser").disabled, false);
  await h.get("import-browser").dispatchEvent({ type: "click" });
  assert.deepEqual(calls, [["browser", "chrome"]]);
  source.value = "firefox"; await source.dispatchEvent({ type: "change" });
  assert.equal(h.get("import-browser").disabled, true);
  await h.get("import-bookmarks").dispatchEvent({ type: "click" });
  assert.deepEqual(calls[1], ["bookmarks", "firefox"]);
});
test("import action prevents duplicate activation while awaiting a file and accepts pasted tab links", async () => {
  let resolve; const calls = [];
  const h = fixture({ run: () => new Promise(done => { resolve = done; }), tabs: async value => { calls.push(value); return { state: "done", kind: "tabs", added: 2 }; } });
  const pending = h.get("import-bookmarks").dispatchEvent({ type: "click" });
  assert.equal(h.get("import-passwords").disabled, true);
  await h.get("import-passwords").dispatchEvent({ type: "click" });
  resolve({ state: "cancelled" }); await pending;
  assert.equal(h.get("import-passwords").disabled, false);
  h.get("import-tab-links").value = "https://example.com\nhttps://other.example";
  await h.get("import-tabs").dispatchEvent({ type: "click" });
  assert.deepEqual(calls, ["https://example.com\nhttps://other.example"]);
});
test("startup diagnostic copy is explicit and excludes extra private fields", async () => {
  const h = fixture(); assert.deepEqual(h.clipboard, []);
  h.window.FluxionStartupDiagnostics = { completed: true, durationMs: 12.345, privateURL: "https://secret.example", scripts: [
    { module: "chrome/fluxion-chrome.js", durationMs: 4.567, completed: true, path: "/Users/secret/profile" },
    { module: "/Users/secret/profile", durationMs: 1, completed: true },
  ] };
  await h.get("copy-startup-diagnostics").dispatchEvent({ type: "click" });
  assert.equal(h.clipboard.length, 1);
  assert.doesNotMatch(h.clipboard[0], /secret|privateURL/);
  const report = JSON.parse(h.clipboard[0]); assert.equal(report.durationMs, 12.35); assert.equal(report.scripts.length, 1);
  assert.match(report.scope, /not page loading/);
});
