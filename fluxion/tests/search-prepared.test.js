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
  let workspaces = [{ id: "old", name: "Original workspace" }, { id: "research", name: "School" }];
  let workspaceReads = 0;
  const scope = vm.createContext({ tabSearchItems: new WeakMap(), mode: "tabs", splitSource: null,
    pendingSplitOrientation: "stacked", gBrowser: { tabs: [tab], selectedTab: tab },
    ui: { tabWorkspace: tab => tab.workspace, currentWorkspace: () => tab.workspace,
      workspaces: () => { workspaceReads++; return workspaces; },
      selectTab: tab => selected.push(tab), createSplitView: (...args) => splits.push(args) },
    window: { FluxionSplitViews: { canSplit: () => true } } });
  vm.runInContext(source.slice(start, end), scope);
  const original = scope.tabItems()[0];
  assert.equal(workspaceReads, 1);
  assert.deepEqual(search.rankSearchItems("old title", [original]), [original]);
  tab.label = "New heading"; tab.linkedBrowser.currentURI.displaySpec = "https://new.test";
  tab.workspace = "research"; tab.group.label = "Café team"; scope.gBrowser.selectedTab = null;
  const updated = scope.tabItems()[0];
  assert.equal(updated, original); assert.equal(updated.boost, 0);
  for (const query of ["new heading", "new.test", "research", "School", "cafe team"])
    assert.deepEqual(search.rankSearchItems(query, [updated]), [updated]);
  assert.equal(updated.detail, "https://new.test");
  assert.equal(updated.contextLabel, "School / Café team");
  workspaces = workspaces.map(workspace => workspace.id === "research" ? { ...workspace, name: "Development" } : workspace);
  const renamed = scope.tabItems()[0];
  assert.equal(renamed, original);
  assert.deepEqual(search.rankSearchItems("Development", [renamed]), [renamed]);
  assert.deepEqual(search.rankSearchItems("School", [renamed]), []);
  assert.deepEqual(search.rankSearchItems("research", [renamed]), [renamed]);
  assert.equal(renamed.contextLabel, "Development / Café team");
  workspaces = [];
  assert.equal(scope.tabItems()[0].contextLabel, "research / Café team");
  assert.deepEqual(search.rankSearchItems("research", [original]), [original]);
  assert.deepEqual(search.rankSearchItems("Development", [original]), []);
  assert.deepEqual(search.rankSearchItems("old title", [updated]), []);
  updated.run(); assert.deepEqual(selected, [tab]);
  scope.mode = "split"; scope.splitSource = {};
  const split = scope.tabItems()[0]; assert.notEqual(split, updated);
  split.run(); assert.equal(splits[0][0], scope.splitSource); assert.equal(splits[0][1], tab);
  const splitSource = scope.splitSource;
  const extract = (begin, finish) => source.slice(source.indexOf(begin), source.indexOf(finish, source.indexOf(begin)));
  Object.assign(scope, { activeIndex: 0, visibleItems: [split], layer: { hidden: false },
    placesTimer: 0, memoryRequest: 0, aiRequest: 0, askController: null,
    input: { value: "", removeAttribute() {} }, lastFocus: null, Cu: { reportError: error => { throw error; } } });
  scope.window.clearTimeout = () => {};
  scope.window.FluxionSplitViews.SIDE_BY_SIDE = "side-by-side";
  vm.runInContext(extract("  function choose(", "  function setActive(") +
    extract("  function close()", '  on(input, "input"'), scope);
  scope.choose();
  assert.equal(scope.layer.hidden, true); assert.equal(scope.splitSource, null);
  assert.equal(scope.pendingSplitOrientation, "side-by-side");
  assert.equal(splits[1][0], splitSource); assert.equal(splits[1][2].orientation, "stacked");
  scope.splitSource = splitSource; scope.pendingSplitOrientation = "side-by-side";
  const columns = scope.tabItems()[0]; assert.notEqual(columns, split);
  columns.run(); assert.equal(splits[2][2].orientation, "side-by-side");
  scope.gBrowser.tabs = Array.from({ length: 250 }, () => ({ ...tab }));
  const readsBefore = workspaceReads;
  assert.equal(scope.tabItems().length, 250);
  assert.equal(workspaceReads - readsBefore, 1, "Workspace metadata is mapped once, not once per tab");
  scope.gBrowser.tabs = []; assert.equal(scope.tabItems().length, 0);
});

test("shipped palette renders compact workspace/group context without changing exact URL fields", () => {
  const source = fs.readFileSync(require.resolve("../chrome/fluxion-palette.js"), "utf8");
  const start = source.indexOf("  function renderItems("), end = source.indexOf("  async function renderMemory()", start);
  function node(_tag, className) {
    return { className, children: [], setAttribute() {}, addEventListener() {},
      append(...children) { this.children.push(...children); },
      appendChild(child) { this.children.push(child); }, replaceChildren() { this.children = []; } };
  }
  const results = node();
  const scope = vm.createContext({ results, create: node, activeIndex: 0, visibleItems: [],
    input: { removeAttribute() {} }, setActive() {}, choose() {} });
  vm.runInContext(source.slice(start, end), scope);
  const tab = { label: "Guide", detail: "https://docs.example/guide", kind: "Tab", contextLabel: "Development / Research" };
  const command = { label: "New tab", detail: "Open a page", kind: "Command" };
  scope.renderItems([tab, command], "Nothing found");
  const detail = results.children[0].children[0].children[1];
  assert.equal(detail.textContent, "Development / Research · https://docs.example/guide");
  assert.equal(detail.title, detail.textContent);
  assert.equal(results.children[1].children[0].children[1].textContent, "Open a page");
  assert.equal(tab.detail, "https://docs.example/guide");
});
