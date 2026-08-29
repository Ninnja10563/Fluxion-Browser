"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

require(path.resolve(__dirname, "../chrome/core/tab-selection.js"));
const selection = globalThis.FluxionTabSelection;

test("context actions use the native selection only when the clicked tab belongs to it", () => {
  const a = {}, b = {}, outside = {};
  assert.deepEqual(selection.contextTabs(a, [a, b]), [a, b]);
  assert.deepEqual(selection.contextTabs(outside, [a, b]), [outside]);
});

test("split pairs expand atomically and are deduplicated", () => {
  const a = {}, b = {};
  const split = { tabs: [a, b] };
  a.splitview = split;
  b.splitview = split;
  assert.deepEqual(selection.contextTabs(a, [a, b]), [a, b]);
});

test("range selection follows visible spatial order in either direction", () => {
  const tabs = [{}, {}, { visible: false }, {}, {}];
  assert.deepEqual(selection.selectableRange(tabs, tabs[0], tabs[3]), [tabs[0], tabs[1], tabs[3]]);
  assert.deepEqual(selection.selectableRange(tabs, tabs[4], tabs[1]), [tabs[1], tabs[3], tabs[4]]);
});
