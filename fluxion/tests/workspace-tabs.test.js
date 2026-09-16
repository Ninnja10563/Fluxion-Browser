"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { WINDOW_VALUE_KEY, markerPlan, preferredTab, windowWorkspace } = require("../chrome/core/workspace-tabs.js");

const tab = (id, workspace, options = {}) => ({ id, workspace, ...options });

test("remembered workspace tabs beat native recency without mutating order", () => {
  const tabs = [
    tab("first", "build", { remembered: true, lastAccessed: 10 }),
    tab("recent", "build", { lastAccessed: 200 }),
    tab("other", "focus", { remembered: true, lastAccessed: 300 }),
  ];
  assert.equal(preferredTab(tabs, "build").id, "first");
  assert.deepEqual(tabs.map(item => item.id), ["first", "recent", "other"]);
});

test("native recency provides a deterministic fallback for unvisited workspaces", () => {
  const tabs = [
    tab("old", "focus", { lastAccessed: 20 }),
    tab("new", "focus", { lastAccessed: 90 }),
    tab("closing", "focus", { remembered: true, closing: true, lastAccessed: 100 }),
  ];
  assert.equal(preferredTab(tabs, "focus").id, "new");
  assert.equal(preferredTab(tabs, "missing"), null);
});

// Frozen pre-0.71 behavior: differential cases include the comparator's unusual
// ordering for malformed recency rather than normalizing away that behavior.
function legacyPreferred(tabs, workspaceId, options = {}) {
  if (!Array.isArray(tabs) || !workspaceId) return null;
  const workspaceOf = options.workspaceOf || (tab => tab?.workspace);
  const isRemembered = options.isRemembered || (tab => Boolean(tab?.remembered));
  return tabs.map((tab, position) => ({ tab, position }))
    .filter(({ tab }) => tab && workspaceOf(tab) === workspaceId && !tab.closing)
    .sort((left, right) => {
      const remembered = Number(isRemembered(right.tab)) - Number(isRemembered(left.tab));
      if (remembered) return remembered;
      const recent = Number(right.tab.lastAccessed || 0) - Number(left.tab.lastAccessed || 0);
      return recent || left.position - right.position;
    })[0]?.tab || null;
}

test("preferred selection reads each eligible native marker once and does not retain state across calls", () => {
  const tabs = Array.from({ length: 3000 }, (_, id) => tab(id, id % 5 ? "focus" : "other",
    { closing: id % 17 === 0, remembered: false, lastAccessed: id }));
  const reads = new Map(); let workspaceReads = 0;
  const options = { workspaceOf: item => { workspaceReads++; return item.workspace; },
    isRemembered: item => { reads.set(item, (reads.get(item) || 0) + 1); return item.remembered; } };
  assert.equal(preferredTab(tabs, "focus", options), legacyPreferred(tabs, "focus"));
  assert.equal(workspaceReads, tabs.length);
  for (const item of tabs) assert.equal(reads.get(item) || 0, item.workspace === "focus" && !item.closing ? 1 : 0);
  const changed = tabs[1]; changed.remembered = true; changed.lastAccessed = 0;
  assert.equal(preferredTab(tabs, "focus", options), changed, "a later native marker change must be authoritative");
  changed.closing = true;
  assert.notEqual(preferredTab(tabs, "focus", options), changed, "closing tabs cannot win a cached selection");
});

test("empty and singleton selection preserves lazy callbacks and deterministic original-order ties", () => {
  const single = tab("only", "focus", { lastAccessed: Symbol("unread") });
  const fail = () => { throw Error("An unneeded marker was read"); };
  for (const invalid of [null, {}, "tabs"]) assert.equal(preferredTab(invalid, "focus"), null);
  assert.equal(preferredTab([single], "", { isRemembered: fail }), null);
  assert.equal(preferredTab([], "focus", { isRemembered: fail }), null);
  assert.equal(preferredTab([null, single], "focus", { isRemembered: fail }), single);
  const same = [tab(1, "focus", { lastAccessed: 42 }), tab(2, "focus", { lastAccessed: 42 })];
  assert.equal(preferredTab(same, "focus"), same[0]);
  assert.deepEqual(same.map(item => item.id), [1, 2]);
});

test("seeded valid and malformed recency/marker values exactly match the frozen comparator", () => {
  let seed = 0x51a7e;
  const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
  const values = [undefined, null, false, 0, -0, 1, 42, -7, NaN, Infinity, -Infinity, "unknown", "12", "", Number.MAX_VALUE, -Number.MAX_VALUE];
  for (let sample = 0; sample < 1200; sample++) {
    const tabs = Array.from({ length: 2 + next() % 90 }, (_, id) => next() % 19 === 0 ? null :
      tab(id, next() % 5 ? "focus" : "other", { closing: next() % 17 === 0,
        remembered: values[next() % values.length], lastAccessed: values[next() % values.length] }));
    const original = tabs.slice();
    for (const options of [{}, { isRemembered: item => item.remembered }]) {
      assert.equal(preferredTab(tabs, "focus", options), legacyPreferred(tabs, "focus", options), `corpus ${sample}`);
    }
    assert.deepEqual(tabs, original);
  }
  const nontransitive = [100, "unknown", 200].map((lastAccessed, id) => tab(id, "focus", { lastAccessed }));
  assert.equal(preferredTab(nontransitive, "focus"), nontransitive[0], "corruption must not silently change the established winner");
});

test("fallback retains native conversion failure semantics without reading irrelevant singleton metadata", () => {
  const a = tab(1, "focus", { remembered: true, lastAccessed: Symbol("bad") });
  const b = tab(2, "focus", { remembered: false, lastAccessed: 1 });
  assert.equal(preferredTab([a, b], "focus"), a, "distinct markers need no recency comparison in the legacy path");
  b.remembered = true;
  assert.throws(() => preferredTab([a, b], "focus"), TypeError);
  assert.throws(() => legacyPreferred([a, b], "focus"), TypeError);
});

test("marker plans leave exactly one active page in the selected workspace", () => {
  const first = tab("first", "build", { remembered: true });
  const second = tab("second", "build");
  const other = tab("other", "focus", { remembered: true });
  assert.deepEqual(markerPlan([first, second, other], "build", second), [
    { tab: first, remembered: false },
    { tab: second, remembered: true },
  ]);
  assert.deepEqual(markerPlan([first], "focus", first), []);
});

test("restored windows own their active workspace independently", () => {
  const workspaces = [{ id: "focus" }, { id: "build" }, { id: "life" }];
  assert.equal(WINDOW_VALUE_KEY, "fluxion-active-workspace");
  assert.equal(windowWorkspace(workspaces, "build", "life"), "build");
  assert.equal(windowWorkspace(workspaces, "missing", "life"), "life");
  assert.equal(windowWorkspace(workspaces, "missing", "missing"), "focus");
  assert.equal(windowWorkspace([], "build", "life"), "");
});
