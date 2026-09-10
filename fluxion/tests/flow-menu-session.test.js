"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { create } = require("../chrome/core/flow-menu-session.js");

function fixture() {
  const scheduled = [], restored = [], hidden = [];
  let live = true;
  const root = {}, other = {}, a = {}, b = {};
  const controller = create({
    snapshot: value => value,
    validate: value => live && value.tabs.every(tab => tab !== null),
    schedule: callback => scheduled.push(callback),
    restore: (...args) => restored.push(args),
    cancelNative: popup => { hidden.push(popup); controller.afterHidden(popup); },
  });
  return { controller, root, other, a, b, restored, hidden,
    invalidate() { live = false; },
    flush() { while (scheduled.length) scheduled.shift()(); },
  };
}

test("opening snapshots array targets without freezing native nodes or observing later selection", () => {
  const f = fixture(), tabs = [f.a, f.b];
  const value = f.controller.begin(f.root, { tabs, workspace: "build" });
  tabs.pop();
  assert.deepEqual(value.tabs, [f.a, f.b]);
  assert.ok(Object.isFrozen(value)); assert.ok(Object.isFrozen(value.tabs));
  assert.equal(Object.isFrozen(f.a), false);
  assert.ok(f.controller.context(f.root) === value);
  assert.equal(f.controller.context(f.other), null);
});

test("native command before popuphidden claims once and never restores after action mutation", () => {
  const f = fixture(); f.controller.begin(f.root, { tabs: [f.a] });
  const claimed = f.controller.beforeCommand(f.root);
  assert.deepEqual(claimed.tabs, [f.a]);
  f.invalidate();
  assert.equal(f.controller.reconcile(), true);
  assert.ok(f.controller.context(f.root) === claimed);
  assert.equal(f.controller.beforeCommand(f.root), null);
  assert.equal(f.controller.afterHidden(f.root), true);
  f.flush(); assert.equal(f.restored.length, 0); assert.equal(f.hidden.length, 0);
  assert.equal(f.controller.context(f.root), null);
});

test("Escape closes immediately, rejects post-hidden commands and defers owned focus restoration", () => {
  const f = fixture(); f.controller.begin(f.root, { tabs: [f.a] });
  assert.equal(f.controller.afterHidden(f.other), false);
  assert.equal(f.controller.afterHidden(f.root), true);
  assert.equal(f.controller.beforeCommand(f.root), null);
  assert.equal(f.restored.length, 0);
  f.flush(); assert.equal(f.restored.length, 1);
  assert.equal(f.restored[0][2].reason, "cancel");
  f.controller.afterHidden(f.root); f.flush(); assert.equal(f.restored.length, 1);
});

test("lost target invalidates commands before synchronous native hidden and permits safe fallback restoration", () => {
  const f = fixture(); f.controller.begin(f.root, { tabs: [f.a] });
  f.invalidate();
  assert.equal(f.controller.beforeCommand(f.root), null);
  assert.deepEqual(f.hidden, [f.root]);
  assert.equal(f.controller.context(f.root), null);
  f.flush(); assert.equal(f.restored.length, 1);
  assert.equal(f.restored[0][2].reason, "invalidated");
});

test("new opening supersedes pending focus restoration and dismisses the previous native menu", () => {
  const f = fixture(); f.controller.begin(f.root, { tabs: [f.a] });
  f.controller.afterHidden(f.root);
  f.controller.begin(f.other, { tabs: [f.b] }); f.flush();
  assert.equal(f.restored.length, 0);
  f.controller.begin(f.root, { tabs: [f.a] });
  assert.deepEqual(f.hidden, [f.other]);
  assert.deepEqual(f.controller.context(f.root).tabs, [f.a]);
});

test("unload closes native menu, cancels queued focus and rejects future use", () => {
  const f = fixture(); f.controller.begin(f.root, { tabs: [f.a] });
  f.controller.afterHidden(f.root); f.controller.dispose(); f.flush();
  assert.equal(f.restored.length, 0);
  assert.equal(f.controller.begin(f.root, { tabs: [f.b] }), null);
  assert.equal(f.controller.beforeCommand(f.root), null);
  const active = fixture(); active.controller.begin(active.root, { tabs: [active.a] });
  active.controller.dispose(); active.controller.dispose();
  assert.deepEqual(active.hidden, [active.root]); active.flush();
  assert.equal(active.restored.length, 0);
});

test("invalid initial contexts and validation exceptions fail closed", () => {
  const f = fixture();
  assert.equal(f.controller.begin(f.root, { tabs: [null] }), null);
  assert.equal(f.controller.beforeCommand(f.root), null);
  const throwing = create({ validate: () => { throw new Error("dead window"); } });
  assert.equal(throwing.begin({}, { tabs: [] }), null);
});
