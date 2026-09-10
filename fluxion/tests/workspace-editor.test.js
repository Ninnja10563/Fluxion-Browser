"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Editor = require("../chrome/core/workspace-editor.js");

function fixture({ atomic = true } = {}) {
  const document = { activeElement: null };
  class Element {
    constructor(tag) {
      this.localName = tag; this.ownerDocument = document; this.children = []; this.dataset = {};
      this.attributes = new Map(); this.listeners = new Map(); this.classList = { add() {} };
      this.value = ""; this.selectionStart = 0; this.selectionEnd = 0; this.selectionDirection = "none";
      this.selectionWrites = 0;
    }
    setAttribute(key, value) { this.attributes.set(key, value); }
    getAttribute(key) { return this.attributes.get(key); }
    addEventListener(type, callback) { this.listeners.set(type, callback); }
    emit(type) { this.listeners.get(type)?.({ target: this }); }
    contains(node) { return node === this || this.children.some(child => child.contains(node)); }
    detach({ preserve = false } = {}) {
      if (!this.parentNode) return;
      if (!preserve && this.contains(document.activeElement)) {
        const active = document.activeElement; document.activeElement = document.body;
        if (active.localName === "input") active.emit("change");
      }
      const siblings = this.parentNode.children;
      siblings.splice(siblings.indexOf(this), 1); this.parentNode = null;
    }
    insert(node, before, preserve) {
      node.detach({ preserve });
      const index = before ? this.children.indexOf(before) : this.children.length;
      assert(index >= 0); this.children.splice(index, 0, node); node.parentNode = this;
      return node;
    }
    insertBefore(node, before) { return this.insert(node, before, false); }
    moveBefore(node, before) { return this.insert(node, before, true); }
    append(...nodes) { nodes.forEach(node => this.insertBefore(node, null)); }
    remove() { this.detach(); }
    replaceWith(node) { const parent = this.parentNode; parent.insertBefore(node, this); this.remove(); }
    focus() { document.activeElement = this; }
    setSelectionRange(start, end, direction) {
      this.selectionWrites++; this.selectionStart = start; this.selectionEnd = end; this.selectionDirection = direction;
    }
    scrollIntoView() {}
  }
  document.body = new Element("body"); document.documentElement = document.body;
  const list = new Element("div"); document.body.append(list);
  if (!atomic) list.moveBefore = undefined;
  const create = (tag, className, text) => Object.assign(new Element(tag), { className, textContent: text });
  const select = (options, value, callback) => {
    const field = create("select"); field.value = value;
    field.addEventListener("change", () => callback(field.value)); return field;
  };
  let items = ["a", "b", "c"].map(id => ({ id, name: id.toUpperCase(), icon: "circle", accent: "slate" }));
  const calls = [], notes = [], main = { scrollTop: 123 };
  const sync = () => editor.sync(items, "a");
  const editor = Editor.attach(list, { create, select, mark: () => create("svg"), scrollContainer: main,
    update(id, change) {
      calls.push({ id, change });
      if (change.name !== undefined && !change.name.trim()) return null;
      const value = { ...change, ...(change.name !== undefined ? { name: change.name.trim() } : {}) };
      items = items.map(item => item.id === id ? { ...item, ...value } : item); sync();
      return items.find(item => item.id === id);
    },
    move(id, direction) {
      calls.push({ id, direction }); const index = items.findIndex(item => item.id === id);
      [items[index], items[index + direction]] = [items[index + direction], items[index]]; sync();
    },
    remove(id) { items = items.filter(item => item.id !== id); sync(); return true; },
    note: value => notes.push(value),
  });
  sync();
  const row = id => list.children.find(item => item.dataset.workspaceId === id);
  const fields = id => {
    const item = row(id), controls = item.children[1], actions = controls.children[2];
    return { item, name: item.children[0].children[1], symbol: controls.children[0], accent: controls.children[1],
      up: actions.children[0], down: actions.children[1], deletion: actions.children[2] };
  };
  return { document, list, main, editor, calls, notes, fields, create,
    models: () => items, external(next) { items = next; sync(); } };
}

test("external metadata and atomic reorder preserve draft, selection, controls and scroll", () => {
  const f = fixture(), b = f.fields("b");
  b.name.focus(); b.name.value = "Local draft"; b.name.emit("input"); b.name.setSelectionRange(2, 5, "backward");
  f.external(f.models().map(item => item.id === "b" ? { ...item, name: "Remote name", icon: "arc", accent: "rose" } : item).reverse());
  assert.equal(f.fields("b").name, b.name);
  assert.equal(f.fields("b").accent, b.accent);
  assert.equal(f.document.activeElement, b.name);
  assert.equal(b.name.value, "Local draft");
  assert.deepEqual([b.name.selectionStart, b.name.selectionEnd, b.name.selectionDirection], [2, 5, "backward"]);
  assert.equal(b.name.selectionWrites, 1, "atomic moves must not reset active IME/selection state");
  assert.equal(b.name.getAttribute("aria-label"), "Name for Remote name");
  assert.equal(b.symbol.value, "arc"); assert.equal(b.accent.value, "rose");
  assert.equal(f.main.scrollTop, 123); assert.deepEqual(f.calls, []);
  b.name.emit("change");
  assert.equal(f.models().find(item => item.id === "b").name, "Local draft");
  assert.equal(f.calls.length, 1);
});

test("older-engine moves restore owned focus without accidentally committing a draft", () => {
  const f = fixture({ atomic: false }), c = f.fields("c");
  c.name.focus(); c.name.value = "Pending"; c.name.emit("input"); c.name.setSelectionRange(1, 3, "forward");
  f.external([...f.models()].reverse());
  assert.equal(f.document.activeElement, c.name);
  assert.equal(c.name.value, "Pending"); assert.deepEqual(f.calls, []);
  assert.deepEqual([c.name.selectionStart, c.name.selectionEnd], [1, 3]);
});

test("reordering into a boundary chooses an enabled action and deletion chooses a safe neighbor", () => {
  const f = fixture(), b = f.fields("b");
  b.up.focus(); b.up.emit("click");
  assert.equal(f.list.children[0], b.item);
  assert.equal(f.document.activeElement, b.down);
  b.deletion.focus(); b.deletion.emit("click");
  assert.equal(f.document.activeElement, f.fields("a").name);
  const count = f.calls.length; b.up.emit("click"); assert.equal(f.calls.length, count, "removed controls are inert");
});

test("background changes never steal external focus; invalid names revert and teardown is inert", () => {
  const f = fixture(), external = f.create("input"); external.focus();
  f.external(f.models().filter(item => item.id !== "b"));
  assert.equal(f.document.activeElement, external);
  const a = f.fields("a"); a.name.focus(); a.name.value = "   "; a.name.emit("input"); a.name.emit("change");
  assert.equal(a.name.value, "A"); assert.match(f.notes.at(-1), /cannot be empty/);
  f.editor.destroy(); const count = f.calls.length;
  a.name.value = "After destruction"; a.name.emit("change"); a.down.emit("click");
  assert.equal(f.calls.length, count);
});
