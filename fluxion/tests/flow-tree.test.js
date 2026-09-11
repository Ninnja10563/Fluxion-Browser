"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const FlowTree = require("../chrome/core/flow-tree.js");

function fixture({ atomic = true } = {}) {
  const document = { activeElement: null }, mutations = [];
  class Node {
    constructor(name) { this.name = name; this.childNodes = []; this.parentNode = null; this.ownerDocument = document; if (!atomic) this.moveBefore = undefined; }
    get isConnected() { return this === root || Boolean(this.parentNode?.isConnected); }
    contains(node) { return node === this || this.childNodes.some(child => child.contains(node)); }
    insertBefore(node, before) { this.place(node, before, false); }
    moveBefore(node, before) {
      assert.ok(this.isConnected && node.isConnected, "State-preserving move requires connected nodes");
      assert.equal(this.ownerDocument, node.ownerDocument);
      this.place(node, before, true);
    }
    place(node, before, atomicMove) {
      assert.ok(!node.contains(this), "DOM insertion must not introduce a cycle");
      assert.ok(before === null || before.parentNode === this);
      if (node === before) return;
      const from = node.parentNode;
      if (!atomicMove && node.contains(document.activeElement)) document.activeElement = null;
      if (from) from.childNodes.splice(from.childNodes.indexOf(node), 1);
      const index = before ? this.childNodes.indexOf(before) : this.childNodes.length;
      this.childNodes.splice(index, 0, node); node.parentNode = this;
      mutations.push({ kind: atomicMove ? "move" : "insert", node: node.name, parent: this.name, from: from?.name });
    }
    removeChild(node) {
      assert.equal(node.parentNode, this);
      this.childNodes.splice(this.childNodes.indexOf(node), 1); node.parentNode = null;
      if (node.contains(document.activeElement)) document.activeElement = null;
      mutations.push({ kind: "remove", node: node.name, parent: this.name });
    }
    focus() { document.activeElement = this; }
  }
  const root = new Node("root");
  const make = (name, parent = root) => { const node = new Node(name); if (parent) parent.insertBefore(node, null); return node; };
  return { root, make, mutations, document, reset: () => { mutations.length = 0; } };
}
const leaf = node => ({ node });
const branch = (node, children) => ({ node, children });

test("1,000 unchanged row/control subtrees survive inserts and minimal moves in both directions", () => {
  const h = fixture(), rows = Array.from({ length: 1000 }, (_, index) => h.make(`row-${index}`));
  const close = h.make("close", rows[500]); close.focus(); h.reset();
  const reconcile = order => FlowTree.reconcile([branch(h.root, order.map(leaf))]);
  reconcile(rows); assert.equal(h.mutations.length, 0);
  const added = h.make("added", null), withAdded = [...rows.slice(0, 100), added, ...rows.slice(100)];
  reconcile(withAdded); assert.deepEqual(h.mutations.map(item => item.kind), ["insert"]);
  for (const [from, to] of [[900, 10], [10, 900], [100, 101]]) {
    const order = [...h.root.childNodes], [node] = order.splice(from, 1); order.splice(to, 0, node); h.reset();
    reconcile(order); assert.equal(h.mutations.length, 1); assert.equal(h.mutations[0].kind, "move");
    assert.deepEqual(h.root.childNodes, order); assert.equal(h.document.activeElement, close);
    assert.deepEqual(rows[500].childNodes, [close]);
  }
});

test("new wrapper is connected before focused controls move inside; obsolete ancestor removed last", () => {
  const h = fixture(), old = h.make("old-group"), row = h.make("row", old), close = h.make("close", row);
  const group = h.make("new-group", null), split = h.make("new-split", null);
  close.focus(); h.reset();
  FlowTree.reconcile([branch(h.root, [branch(group, [branch(split, [leaf(row)])])])]);
  assert.deepEqual(h.mutations.map(item => [item.kind, item.node]), [["insert", "new-group"], ["insert", "new-split"], ["move", "row"], ["remove", "old-group"]]);
  assert.equal(row.parentNode, split); assert.equal(h.document.activeElement, close);
});

test("cross-parent reparenting completes before either parent prunes and preserves leaf descendants", () => {
  const h = fixture(), a = h.make("A"), b = h.make("B"), one = h.make("one", a), two = h.make("two", b);
  const audio = h.make("audio", one); audio.focus(); h.reset();
  FlowTree.reconcile([branch(a, [leaf(two)]), branch(b, [leaf(one)])]);
  assert.equal(h.mutations.length, 2); assert.ok(h.mutations.every(item => item.kind === "move"));
  assert.equal(h.document.activeElement, audio); assert.deepEqual(one.childNodes, [audio]);
  assert.deepEqual(a.childNodes, [two]); assert.deepEqual(b.childNodes, [one]);
});

test("unwrapping and reversing existing ancestor ownership remains cycle-free", () => {
  const h = fixture(), outer = h.make("outer"), inner = h.make("inner", outer), row = h.make("row", inner);
  const close = h.make("close", row); close.focus(); h.reset();
  FlowTree.reconcile([branch(h.root, [branch(inner, [branch(outer, [leaf(row)])])])]);
  assert.equal(inner.parentNode, h.root); assert.equal(outer.parentNode, inner); assert.equal(row.parentNode, outer);
  assert.equal(h.document.activeElement, close);
  h.reset(); FlowTree.reconcile([branch(h.root, [leaf(row)])]);
  assert.equal(row.parentNode, h.root); assert.equal(h.document.activeElement, close);
  assert.deepEqual(h.mutations.map(item => item.kind), ["move", "remove"]);
});

test("insertBefore fallback retains node identity and exposes native focus loss for caller restoration", () => {
  const h = fixture({ atomic: false }), a = h.make("A"), b = h.make("B"), row = h.make("row", a), close = h.make("close", row);
  close.focus(); h.reset(); FlowTree.reconcile([branch(a, []), branch(b, [leaf(row)])]);
  assert.equal(row.parentNode, b); assert.deepEqual(row.childNodes, [close]);
  assert.equal(h.document.activeElement, null); assert.equal(h.mutations[0].kind, "insert");
});

test("different-document nodes never use moveBefore even when both are connected", () => {
  const h = fixture(), a = h.make("A"), b = h.make("B"), row = h.make("foreign-row", a);
  row.ownerDocument = { activeElement: null };
  h.reset(); FlowTree.reconcile([branch(a, []), branch(b, [leaf(row)])]);
  assert.equal(row.parentNode, b);
  assert.deepEqual(h.mutations.map(item => item.kind), ["insert"]);
});

test("duplicate nodes, plan cycles, invalid children and fixed-root cycles reject before any mutation", () => {
  const h = fixture(), a = h.make("A"), b = h.make("B", a);
  const fresh = h.make("would-insert", null);
  const cycle = branch(a, []); cycle.children.push(cycle);
  for (const plans of [[branch(h.root, [leaf(a), leaf(a)])], [cycle], [branch(h.root, [leaf(a)]), leaf(a)],
    [{ node: h.root, children: null }], [branch(b, [leaf(a)])], [branch(a, []), branch(b, [])],
    [branch(h.root, [leaf(fresh)]), leaf(fresh)]]) {
    h.reset(); assert.throws(() => FlowTree.reconcile(plans), /duplicate|cycle|children|fixed root/);
    assert.equal(h.mutations.length, 0);
  }
});

test("absent children preserves a leaf subtree whereas an explicit empty array prunes it", () => {
  const h = fixture(), row = h.make("row"), close = h.make("close", row); h.reset();
  FlowTree.reconcile([branch(h.root, [leaf(row)])]); assert.equal(h.mutations.length, 0);
  FlowTree.reconcile([branch(h.root, [branch(row, [])])]);
  assert.deepEqual(row.childNodes, []); assert.equal(close.parentNode, null);
  assert.deepEqual(h.mutations.map(item => item.kind), ["remove"]);
});
