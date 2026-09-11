"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../chrome/fluxion-structure-verification.js"), "utf8");
const start = source.indexOf("    async function verifyLiveDocuments(");
const end = source.indexOf("    fixtures[2].toggleMuteAudio();", start);
assert.ok(start >= 0 && end > start, "Live-state verifier boundaries missing");
function fixture(change = {}, loads = 4) {
  const tabs = [{}, {}, {}, {}];
  const state = { nonce: "document", draft: "unsaved", counter: 1, historyLength: 2, url: "http://127.0.0.1:1234/transfer?step=1" };
  const livePages = new Map(tabs.map((tab, index) => [tab, { ...state, nonce: `document-${index}` }]));
  const report = { liveDocuments: { checks: [] } };
  const context = vm.createContext({ livePages, report, baselineLoads: 4,
    assert: (ok, message) => assert.ok(ok, message),
    readLivePage: async tab => ({ ...livePages.get(tab), ...(tab === tabs[3] ? change : {}) }),
    documentLoads: async () => loads,
  });
  vm.runInContext(source.slice(start, end), context);
  return { report, run: () => context.verifyLiveDocuments("drag") };
}
test("native live-state check records evidence only after all four documents and load count match", async () => {
  const f = fixture(); await f.run();
  assert.equal(f.report.liveDocuments.checks.length, 1);
  assert.equal(f.report.liveDocuments.checks[0].pages, 4);
  assert.equal(f.report.liveDocuments.checks[0].loads, 4);
});
test("a last-page nonce, draft, counter, URL or history change cannot pass native drag evidence", async () => {
  for (const change of [{ nonce: "reloaded" }, { draft: "" }, { counter: 0 }, { historyLength: 1 }, { url: "about:blank" }]) {
    const f = fixture(change);
    await assert.rejects(f.run(), /lost a live document/);
    assert.equal(f.report.liveDocuments.checks.length, 0);
  }
  const f = fixture({}, 5);
  await assert.rejects(f.run(), /reloaded a live fixture/);
  assert.equal(f.report.liveDocuments.checks.length, 0);
});
