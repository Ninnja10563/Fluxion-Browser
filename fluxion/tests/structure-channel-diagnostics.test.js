"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../chrome/fluxion-structure-verification.js"), "utf8");
const begin = source.indexOf("  function observeSetupChannels("), end = source.indexOf("  async function run()", begin);
assert.ok(begin >= 0 && end > begin);
function fixture() {
  const observers = new Map(), progress = new Set(), report = { setup: {} };
  const context = vm.createContext({ report, Ci: { nsIHttpChannel: {}, nsIWebProgressListener: { STATE_REDIRECTING: 2 } },
    Services: { obs: {
      addObserver(observer, topic) { observers.set(topic, observer); },
      removeObserver(observer, topic) { assert.equal(observers.get(topic), observer); observers.delete(topic); },
    } },
    gBrowser: { addTabsProgressListener: listener => progress.add(listener), removeTabsProgressListener: listener => progress.delete(listener) },
  });
  vm.runInContext(source.slice(begin, end), context);
  const stop = context.observeSetupChannels("http://127.0.0.1:4111");
  const channel = { URI: { spec: "http://127.0.0.1:4111/transfer" }, originalURI: { spec: "http://127.0.0.1:4111/transfer" },
    channelId: 7, loadInfo: { browsingContextID: 11, innerWindowID: 13, isTopLevelLoad: true, externalContentPolicyType: 6 },
    status: 0, responseStatus: 200, QueryInterface() { return this; },
    authorization: "secret", getRequestHeader() { throw Error("Diagnostic must never read headers"); } };
  return { observers, progress, report, channel, stop };
}

test("setup channel evidence records native identity/status but excludes nonfixture URLs and private fields", () => {
  const f = fixture(), observer = f.observers.get("http-on-modify-request");
  observer.observe(f.channel, "http-on-modify-request");
  const listener = [...f.progress][0];
  listener.onStateChange({ browsingContext: { id: 11 } }, { isTopLevel: true }, f.channel, 2, 0x804b0002);
  for (const spec of ["http://127.0.0.1:4222/transfer", "http://127.0.0.1:4111/state",
    "http://127.0.0.1:4111/transfer?secret=token", "https://private.invalid/transfer"]) {
    observer.observe({ ...f.channel, URI: { spec } }, "http-on-modify-request");
  }
  listener.onStateChange({}, { isTopLevel: false }, f.channel, 2, 0);
  const records = f.report.setup.channels.records;
  assert.equal(records.length, 2);
  assert.equal(records[0].channelId, 7);
  assert.equal(records[0].contextId, 11);
  assert.equal(records[0].innerWindowId, 13);
  assert.equal(records[1].status, 0x804b0002);
  assert.equal(records[1].browserContextId, 11);
  assert.equal(records[1].redirecting, true);
  assert.doesNotMatch(JSON.stringify(records), /secret|private|authorization|127\.0/);
  assert.equal(f.channel.URI.spec, "http://127.0.0.1:4111/transfer");
  assert.equal(f.channel.status, 0, "diagnostics never mutate channel state");
});

test("setup diagnostics cap records, tolerate unavailable response getters and detach on cleanup", () => {
  const f = fixture(), observer = f.observers.get("http-on-modify-request"), listener = [...f.progress][0];
  Object.defineProperty(f.channel, "responseStatus", { get() { throw Error("No response yet"); } });
  for (let index = 0; index < 131; index++) observer.observe(f.channel, "http-on-modify-request");
  assert.equal(f.report.setup.channels.records.length, 128);
  assert.equal(f.report.setup.channels.omitted, 3);
  assert.equal(f.report.setup.channels.records[0].responseStatus, null);
  observer.observe({ QueryInterface() { throw Error("Not HTTP"); } }, "http-on-modify-request");
  assert.equal(f.report.setup.channels.unreadable, 1);
  f.stop(); f.stop();
  assert.equal(f.observers.size, 0); assert.equal(f.progress.size, 0);
  observer.observe(f.channel, "http-on-modify-request");
  listener.onStateChange({}, { isTopLevel: true }, f.channel, 2, 0);
  assert.equal(f.report.setup.channels.omitted, 3, "stale callbacks after setup must remain inert");
});
