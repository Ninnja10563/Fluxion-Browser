"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Navigation = require("../chrome/core/library-navigation.js");

function fixture(size = 100) {
  const document = { activeElement: null };
  const handlers = new Map();
  const state = { enabled: true, canAct: true, menus: [] };
  const list = { ownerDocument: document, children: [], tabIndex: -1,
    addEventListener(type, callback) { handlers.set(type, callback); },
    removeEventListener(type, callback) { if (handlers.get(type) === callback) handlers.delete(type); },
    focus() { document.activeElement = this; },
  };
  function row(id) {
    const item = { _fluxionLibraryId: id, scrolls: [],
      scrollIntoView(options) { this.scrolls.push(options); },
      querySelector(selector) { return selector === ".fluxion-library-open" ? this.primary : this.more; },
    };
    const control = () => ({ tabIndex: 0, disabled: false, hidden: false,
      contains(node) { return this === node; },
      focus() { document.activeElement = this; handlers.get("focusin")?.({ target: this }); },
    });
    item.primary = control(); item.more = control();
    return item;
  }
  list.children = Array.from({ length: size }, (_, index) => row(`item-${index}`));
  const controller = Navigation.attach(list, { enabled: () => state.enabled, canAct: () => state.canAct,
    onMenu: (item, anchor) => state.menus.push({ item, anchor }) });
  controller.sync();
  const key = (key, modifiers = {}) => {
    const event = { key, target: document.activeElement, prevented: false, stopped: false,
      preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...modifiers };
    handlers.get("keydown")?.(event);
    return event;
  };
  return { list, document, state, controller, key, row,
    tabStops: () => list.children.flatMap(item => [item.primary, item.more]).filter(control => control.tabIndex === 0) };
}

test("100 Library rows have one entry point with clamped arrows and direct Home/End", () => {
  const f = fixture();
  assert.deepEqual(f.tabStops(), [f.list.children[0].primary]);
  f.list.children[0].primary.focus();
  assert.equal(f.key("ArrowUp").prevented, true);
  assert.equal(f.document.activeElement, f.list.children[0].primary);
  f.key("ArrowDown");
  assert.equal(f.document.activeElement, f.list.children[1].primary);
  f.key("End"); f.key("ArrowDown");
  assert.equal(f.document.activeElement, f.list.children[99].primary);
  assert.deepEqual(f.tabStops(), [f.list.children[99].primary]);
  assert.equal(f.list.children[99].scrolls.at(-1).block, "nearest");
  f.key("Home");
  assert.equal(f.document.activeElement, f.list.children[0].primary);
});

test("secondary actions are reachable without adding tab stops or intercepting native activation", () => {
  const f = fixture();
  const row = f.list.children[37];
  row.primary.focus(); f.key("ArrowRight");
  assert.equal(f.document.activeElement, row.more);
  assert.deepEqual(f.tabStops(), [row.primary]);
  for (const key of ["Tab", "Enter", " ", "Escape"]) assert.equal(f.key(key).prevented, false);
  f.key("ArrowLeft"); f.key("F10", { shiftKey: true });
  assert.deepEqual(f.state.menus, [{ item: row, anchor: row.primary }]);
  row.more.focus(); f.key("ContextMenu");
  assert.equal(f.state.menus[1].anchor, row.more);
  f.state.canAct = false;
  assert.equal(f.key("ContextMenu").prevented, true);
  assert.equal(f.state.menus.length, 2);
  f.key("ArrowDown"); // Pending data may be read, but not acted on.
  assert.equal(f.document.activeElement, f.list.children[38].primary);
});

test("refresh retains identity, restores owned focus, and selects a neighbor after removal", () => {
  const f = fixture(5);
  f.list.children[3].primary.focus();
  f.list.children = [f.row("item-4"), f.row("item-3"), f.row("item-2")];
  f.document.activeElement = null;
  f.controller.sync({ restoreFocus: true });
  assert.equal(f.document.activeElement, f.list.children[1].primary);
  f.list.children.splice(1, 1); f.document.activeElement = null;
  f.controller.sync({ restoreFocus: true });
  assert.equal(f.document.activeElement, f.list.children[1].primary);
  const search = {};
  f.document.activeElement = search;
  f.list.children = [f.row("new-result")];
  f.controller.sync();
  assert.equal(f.document.activeElement, search, "background refresh must not take focus from search");
  assert.deepEqual(f.tabStops(), [f.list.children[0].primary]);
});

test("empty pending lists keep a keyboard anchor and restore it only while still owned", () => {
  const f = fixture(1);
  f.list.children[0].primary.focus(); f.list.children = [];
  f.controller.sync({ restoreFocus: true });
  assert.equal(f.document.activeElement, f.list);
  f.list.children = [f.row("replacement")]; f.controller.sync();
  assert.equal(f.document.activeElement, f.list.children[0].primary);
});

test("downloads, modified shortcuts, prevented events, and destroyed controllers are untouched", () => {
  const f = fixture(2);
  f.list.children[0].primary.focus();
  for (const modifiers of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }, { defaultPrevented: true }]) {
    assert.equal(f.key("ArrowDown", modifiers).prevented, false);
    assert.equal(f.document.activeElement, f.list.children[0].primary);
  }
  f.state.enabled = false;
  f.list.children = [f.row("download-1"), f.row("download-2")];
  f.controller.sync();
  assert.equal(f.tabStops().length, 4, "downloads retain their existing action traversal");
  f.list.children[0].primary.focus(); assert.equal(f.key("ArrowDown").prevented, false);
  f.state.enabled = true; f.controller.destroy();
  assert.equal(f.key("ContextMenu").prevented, false);
  assert.equal(f.state.menus.length, 0);
});
