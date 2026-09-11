"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../chrome/fluxion-structure-verification.js"), "utf8");
const start = source.indexOf("    function hierarchy() {");
const end = source.indexOf("    async function hierarchicalOperation(", start);
assert.ok(start >= 0 && end > start, "Shipped hierarchy verifier markers missing");
// Exercise the shipped native gate's hierarchy assertions, not a second
// implementation of its projection. This unit harness is not native DOM proof.
function fixture() {
  const group = { collapsed: false, tabs: [] }, collapsed = { collapsed: true, tabs: [] };
  const tab = (name, options = {}) => ({ name, pinned: false, workspace: "focus", ...options });
  const tabs = [tab("pinned", { pinned: true }), tab("ordinary"), tab("group-one", { group }),
    tab("split-left", { group }), tab("split-right", { group }), tab("hidden", { group: collapsed }),
    tab("active", { group: collapsed }), tab("other-workspace", { workspace: "other" })];
  group.tabs = tabs.slice(2, 5); collapsed.tabs = tabs.slice(5, 7);
  const split = { tabs: tabs.slice(3, 5) };
  for (const member of split.tabs) member.splitview = split;
  const row = nativeTab => ({ _fluxionTab: nativeTab, hidden: false, tabIndex: -1 });
  const rows = tabs.map(row); rows[5].hidden = true;
  const heading = id => ({ id: `heading-${id}`, tabIndex: -1,
    attrs: { "aria-controls": id, "aria-owns": id }, getAttribute(key) { return this.attrs[key]; } });
  const firstHeading = heading("expanded-children"), collapsedHeading = heading("collapsed-children");
  firstHeading.tabIndex = 0;
  const containers = new Map([
    ["expanded-children", { id: "expanded-children", rows: rows.slice(2, 5) }],
    ["collapsed-children", { id: "collapsed-children", rows: rows.slice(5, 7) }],
  ]);
  for (const container of containers.values()) container.querySelectorAll = selector => {
    assert.equal(selector, ".fluxion-tab"); return container.rows;
  };
  const tree = { rows: rows.slice(1, 7), stops: [firstHeading, ...rows.slice(1, 7), collapsedHeading],
    querySelectorAll(selector) { return selector === ".fluxion-tab" ? this.rows : this.stops; } };
  const pinned = { rows: [rows[0]], querySelectorAll(selector) { assert.equal(selector, ".fluxion-tab"); return this.rows; } };
  const groups = new Map([[group, firstHeading], [collapsed, collapsedHeading]]);
  const context = vm.createContext({ gBrowser: { tabs, selectedTab: tabs[6] },
    ui: { tabWorkspace: nativeTab => nativeTab.workspace }, workspace: "focus", tree, pinned,
    visible: node => node && !node.hidden, headings: () => groups,
    document: { getElementById: id => containers.get(id) },
    assert: (condition, message) => { if (!condition) throw new Error(message); },
  });
  vm.runInContext(source.slice(start, end), context);
  return { verify: () => context.hierarchy(), tabs, rows, tree, pinned, containers, firstHeading, collapsedHeading };
}

test("shipped hierarchy accepts mixed pins, groups, nested splits and a collapsed active page", () => {
  assert.doesNotThrow(fixture().verify);
});

test("wrong root order and duplicate ungrouped rows cannot pass despite stable group projections", () => {
  for (const mutate of [f => f.tree.rows.reverse(), f => f.tree.rows.push(f.rows[1])]) {
    const f = fixture(); mutate(f);
    assert.throws(f.verify, /Flattened hierarchical Flow order/);
  }
});

test("missing selected collapsed page or exposed inactive page fails the flattened projection", () => {
  for (const mutate of [f => { f.rows[6].hidden = true; }, f => { f.rows[5].hidden = false; }]) {
    const f = fixture(); mutate(f);
    assert.throws(f.verify, /Flattened hierarchical Flow order/);
  }
});

test("pinned and foreign-workspace rows cannot leak into the normal tree", () => {
  for (const added of [0, 7]) {
    const f = fixture(); f.tree.rows.push(f.rows[added]);
    assert.throws(f.verify, /Flattened hierarchical Flow order/);
  }
  const f = fixture(); f.pinned.rows = [];
  assert.throws(f.verify, /Flattened hierarchical Flow order/);
});

test("missing or mismatched group ARIA relationship is rejected", () => {
  const missing = fixture(); missing.containers.delete("expanded-children");
  assert.throws(missing.verify, /accessible child relationship/);
  const mismatched = fixture(); mismatched.firstHeading.attrs["aria-owns"] = "collapsed-children";
  assert.throws(mismatched.verify, /accessible child relationship/);
});

test("zero or multiple visible tree keyboard stops fail while hidden stops are ignored", () => {
  const none = fixture(); none.firstHeading.tabIndex = -1;
  assert.throws(none.verify, /single visible keyboard entry/);
  const multiple = fixture(); multiple.rows[1].tabIndex = 0;
  assert.throws(multiple.verify, /single visible keyboard entry/);
  const hidden = fixture(); hidden.rows[5].tabIndex = 0;
  assert.doesNotThrow(hidden.verify);
});

test("group children must match native order even when the overall root list is correct", () => {
  const f = fixture(); f.containers.get("expanded-children").rows.reverse();
  assert.throws(f.verify, /Group projection order/);
});
