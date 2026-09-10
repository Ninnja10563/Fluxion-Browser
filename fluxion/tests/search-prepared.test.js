"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const search = require("../chrome/core/search.js");

function reference(query, items, limit) {
  const records = items.map((item, index) => ({ item, index, fallback: item.fallback === true,
    score: Math.max(...[item.label, item.detail, ...(item.keywords || [])].map(field => search.fuzzyScore(query, field))) + Number(item.boost || 0),
  })).filter(record => Number.isFinite(record.score));
  const strongest = Math.max(-Infinity, ...records.filter(record => !record.fallback).map(record => record.score));
  return records.filter(record => record.fallback || record.score >= (strongest >= 650 ? 400 : -Infinity))
    .sort((a, b) => Number(a.fallback) - Number(b.fallback) || b.score - a.score || a.index - b.index)
    .slice(0, Math.max(0, Math.min(Number(limit) || 0, 100))).map(record => record.item);
}

test("prepared top-K preserves full-sort ranking, confidence floor, ties, accents and limit semantics", () => {
  const words = ["École café", "websocket authentication", "Workspace", "a b", "", "文書", "Cafe\u0301", "Firefox", "fluxion"];
  const items = Array.from({ length: 1100 }, (_, i) => ({ label: words[i % words.length],
    detail: `https://example.test/${words[(i * 3) % words.length]}/${i % 17}`,
    keywords: [words[(i * 5) % words.length]], boost: i % 19 - 9, fallback: i % 37 === 0 }));
  for (const query of ["", "cafe", "  ÉCOLE  ", "ws auth", "websocket authentication", "fx", "文", "not found"])
    for (const limit of [0, 1, 12, 12.7, 100, 500, -1, NaN])
      assert.deepEqual(search.rankSearchItems(query, items, limit), reference(query, items, limit));
});

test("actual palette tab records are reused but title, URI, workspace, group, selection and split source remain live", () => {
  const source = fs.readFileSync(require.resolve("../chrome/fluxion-palette.js"), "utf8");
  const start = source.indexOf("  function tabItems() {"), end = source.indexOf("  function workspaceItems()", start);
  const tab = { label: "Old title", linkedBrowser: { currentURI: { displaySpec: "https://old.test" } }, workspace: "old", group: { label: "Old group" } };
  const selected = [], splits = [];
  const scope = vm.createContext({ tabSearchItems: new WeakMap(), mode: "tabs", splitSource: null,
    pendingSplitOrientation: "stacked", gBrowser: { tabs: [tab], selectedTab: tab },
    ui: { tabWorkspace: tab => tab.workspace, currentWorkspace: () => tab.workspace,
      selectTab: tab => selected.push(tab), createSplitView: (...args) => splits.push(args) },
    window: { FluxionSplitViews: { canSplit: () => true } } });
  vm.runInContext(source.slice(start, end), scope);
  const original = scope.tabItems()[0];
  assert.deepEqual(search.rankSearchItems("old title", [original]), [original]);
  tab.label = "New heading"; tab.linkedBrowser.currentURI.displaySpec = "https://new.test";
  tab.workspace = "research"; tab.group.label = "Café team"; scope.gBrowser.selectedTab = null;
  const updated = scope.tabItems()[0];
  assert.equal(updated, original); assert.equal(updated.boost, 0);
  for (const query of ["new heading", "new.test", "research", "cafe team"])
    assert.deepEqual(search.rankSearchItems(query, [updated]), [updated]);
  assert.deepEqual(search.rankSearchItems("old title", [updated]), []);
  updated.run(); assert.deepEqual(selected, [tab]);
  scope.mode = "split"; scope.splitSource = {};
  const split = scope.tabItems()[0]; assert.notEqual(split, updated);
  split.run(); assert.equal(splits[0][0], scope.splitSource); assert.equal(splits[0][1], tab);
  scope.gBrowser.tabs = []; assert.equal(scope.tabItems().length, 0);
});
