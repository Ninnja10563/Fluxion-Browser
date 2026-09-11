"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../chrome/fluxion-structure-verification.js"), "utf8");
const start = source.indexOf("    async function establishHierarchyBaseline(");
const end = source.indexOf("    async function hierarchicalOperation(", start);
assert.ok(start >= 0 && end > start, "Shipped hierarchy baseline markers missing");
function fixture({ selects = false, fail = "" } = {}) {
  const fixtures = [{}, {}, {}], report = {}, document = { activeElement: null };
  const gBrowser = { selectedTab: fixtures[2] }, events = [], rows = new Map();
  for (const tab of fixtures) {
    const close = { isConnected: true, focus() { if (fail !== "focus") document.activeElement = close; } };
    const row = { isConnected: fail !== "disconnected", tabIndex: -1,
      focus() { document.activeElement = row; }, querySelector() { return close; },
      dispatchEvent(event) {
        events.push(event);
        if (fail !== "selection") gBrowser.selectedTab = tab;
        if (fail !== "roving") row.tabIndex = 0;
      } };
    rows.set(tab, row);
  }
  const context = vm.createContext({ fixtures, report, document, gBrowser, rows: () => rows,
    settle: async () => {}, window: { KeyboardEvent: class { constructor(type, options) { this.type = type; Object.assign(this, options); } } },
    assert: (condition, message) => { if (!condition) throw new Error(message); } });
  vm.runInContext(source.slice(start, end), context);
  return { report, events, run: () => context.establishHierarchyBaseline("collapse", selects) };
}
test("hierarchy baseline activates the intended owner through Flow Enter before measuring", async () => {
  for (const selects of [false, true]) {
    const f = fixture({ selects }); await f.run();
    const baseline = f.report.hierarchicalBaselines[0];
    assert.equal(baseline.owner, selects ? 2 : 1); assert.equal(baseline.selected, baseline.owner);
    assert.equal(baseline.focused, true); assert.equal(baseline.tabIndex, 0);
    assert.equal(f.events[0].type, "keydown"); assert.equal(f.events[0].key, "Enter"); assert.equal(f.events[0].bubbles, true);
  }
});
test("missing row, native selection, roving ownership or exact close focus cannot pass baseline", async () => {
  for (const fail of ["disconnected", "selection", "roving", "focus"]) {
    const f = fixture({ fail }); await assert.rejects(f.run(), /Hierarchy baseline/);
  }
});
