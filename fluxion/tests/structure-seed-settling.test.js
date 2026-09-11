"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../chrome/fluxion-structure-verification.js"), "utf8");
const start = source.indexOf("    function livePageChromeReady(");
const end = source.indexOf("    const livePages =", start);
assert.ok(start >= 0 && end > start, "Shipped seed settling predicate missing");
function fixture() {
  const url = "http://127.0.0.1:4123/transfer?step=1";
  const tab = { busy: false, linkedBrowser: { currentURI: { spec: url } }, hasAttribute() { return this.busy; } };
  const row = { title: `Fluxion transfer fixture\n${url}` }, rows = new Map([[tab, row]]);
  const context = vm.createContext({ rows: () => rows });
  vm.runInContext(source.slice(start, end), context);
  return { tab, row, rows, run: () => context.livePageChromeReady(tab, { url }) };
}
test("seed settling requires native URL and exact naturally updated Flow tooltip", () => {
  const f = fixture(); assert.equal(f.run(), true);
  f.row.title = f.row.title.replace("?step=1", ""); assert.equal(f.run(), false);
  f.row.title += "?step=1-extra"; assert.equal(f.run(), false);
});
test("seed settling rejects busy, stale native URI, wrong page label and absent row", () => {
  for (const change of [f => { f.tab.busy = true; }, f => { f.tab.linkedBrowser.currentURI.spec = "about:blank"; },
    f => { f.row.title = f.row.title.replace("Fluxion transfer fixture", "Loading"); }, f => { f.rows.clear(); }]) {
    const f = fixture(); change(f); assert.ok(!f.run());
  }
});
