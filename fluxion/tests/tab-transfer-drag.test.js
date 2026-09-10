"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Drag = require("../chrome/core/tab-transfer-drag.js");

function dataTransfer() {
  const items = [];
  return {
    get mozItemCount() { return items.length; },
    mozSetDataAt(type, value, index) { assert.equal(type, Drag.TYPE); items[index] = value; },
    mozGetDataAt(type, index) { assert.equal(type, Drag.TYPE); return items[index]; },
  };
}
test("typed tab payload retains object identity and selected order across windows", () => {
  const ownerGlobal = {}, tabs = [{ ownerGlobal }, { ownerGlobal }], transfer = dataTransfer();
  assert.ok(Drag.write(transfer, tabs));
  assert.equal(transfer.effectAllowed, "move");
  const restored = Drag.read(transfer, item => tabs.includes(item));
  assert.equal(restored[0], tabs[0]);
  assert.equal(restored[1], tabs[1]);
});
test("page text, duplicate objects, and mixed-window payloads cannot become tab transfers", () => {
  for (const tabs of [["tab"], [{ ownerGlobal: {} }, { ownerGlobal: {} }]]) {
    const transfer = dataTransfer(); Drag.write(transfer, tabs);
    assert.deepEqual(Drag.read(transfer, tab => typeof tab === "object"), []);
  }
  const tab = { ownerGlobal: {} }, transfer = dataTransfer();
  Drag.write(transfer, [tab, tab]);
  assert.deepEqual(Drag.read(transfer, item => item === tab), []);
});
test("stale or untrusted tab objects fail the caller's native ownership check", () => {
  const transfer = dataTransfer(), tab = { ownerGlobal: {} };
  Drag.write(transfer, [tab]);
  assert.deepEqual(Drag.read(transfer, () => false), []);
  assert.deepEqual(Drag.read({ mozItemCount: 1, mozGetDataAt() { throw Error("principal boundary"); } }, () => true), []);
});
test("unbounded and unavailable transfer data fail closed", () => {
  assert.deepEqual(Drag.read({ mozItemCount: Infinity }, () => true), []);
  assert.deepEqual(Drag.read({ mozItemCount: Drag.LIMIT + 1, mozGetDataAt() { throw Error("must not read"); } }, () => true), []);
  assert.equal(Drag.write({}, [{}]), false);
  assert.equal(Drag.write(dataTransfer(), []), false);
});
test("a serialization failure removes the partial selection instead of moving its prefix", () => {
  const items = [], source = {}, tabs = [{ ownerGlobal: source }, { ownerGlobal: source }];
  const transfer = {
    get mozItemCount() { return items.length; },
    mozSetDataAt(type, tab, index) { if (index === 1) throw Error("serialization failed"); items[index] = tab; },
    mozClearDataAt(type, index) { if (index < items.length) items.splice(index, 1); },
    mozGetDataAt(type, index) { return items[index]; },
  };
  assert.equal(Drag.write(transfer, tabs), false);
  assert.deepEqual(Drag.read(transfer, tab => tabs.includes(tab)), []);
});
const drop = {
  trusted: true, canceled: false, effect: "none", screenX: 1500, screenY: 200,
  windows: [{ left: 0, top: 0, width: 700, height: 500 }, { left: 720, top: 0, width: 600, height: 500 }],
};
test("a trusted uncanceled drag outside all browser windows can detach", () => {
  assert.equal(Drag.shouldDetach(drop), true);
});
test("Escape, accepted drops, and untrusted dragend events cannot detach", () => {
  for (const change of [{ canceled: true }, { canceled: undefined }, { effect: "move" }, { effect: "copy" }, { trusted: false }]) {
    assert.equal(Drag.shouldDetach({ ...drop, ...change }), false);
  }
});
test("a rejected drop in either the source or a private destination cannot create another window", () => {
  for (const screenX of [0, 350, 700, 720, 1000, 1320]) {
    assert.equal(Drag.shouldDetach({ ...drop, screenX }), false);
  }
});
test("missing window geometry and invalid pointer coordinates cannot detach", () => {
  for (const change of [{ windows: [] }, { screenX: NaN }, { screenY: Infinity }, { windows: [{ left: 0, top: 0, width: 0, height: 10 }] }]) {
    assert.equal(Drag.shouldDetach({ ...drop, ...change }), false);
  }
});
