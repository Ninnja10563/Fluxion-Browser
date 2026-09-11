"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../chrome/fluxion-structure-verification.js"), "utf8");
const start = source.indexOf("    async function dragFlow(");
const end = source.indexOf("    function hierarchy() {", start);
assert.ok(start >= 0 && end > start, "Shipped drag verifier markers missing");

// This exercises the verifier's event protocol and negative paths, not native
// drag handling: actual Gecko movement remains a separate macOS gate.
function fixture({ accept = true, failDrop = false, height = 120 } = {}) {
  const events = [];
  class DataTransfer {}
  class DragEvent {
    constructor(type, options) { this.type = type; Object.assign(this, options); this.defaultPrevented = false; }
    preventDefault() { this.defaultPrevented = true; }
  }
  const sourceNode = { isConnected: true, dispatchEvent(event) { events.push(event); } };
  const target = { isConnected: true, scrollIntoView() {}, dispatchEvent(event) {
    events.push(event);
    if (event.type === "dragover" && accept) event.preventDefault();
    if (event.type === "drop" && failDrop) throw new Error("drop fixture failure");
  } };
  target.getBoundingClientRect = () => ({ left: 10, width: 100, top: 20, bottom: 20 + height, height });
  const context = vm.createContext({ window: { DataTransfer, DragEvent }, settle: async () => {},
    assert: (condition, message) => { if (!condition) throw new Error(message); } });
  vm.runInContext(source.slice(start, end), context);
  return { events, sourceNode, run: after => context.dragFlow(sourceNode, target, after) };
}

test("shipped native drag verifier uses one transfer and the hovered row before/after geometry", async () => {
  for (const after of [false, true]) {
    const f = fixture(); await f.run(after);
    assert.deepEqual(f.events.map(event => event.type), ["dragstart", "dragover", "drop", "dragend"]);
    for (const event of f.events) {
      assert.equal(event.dataTransfer, f.events[0].dataTransfer);
      assert.equal(event.clientX, 60); assert.equal(event.clientY, after ? 139 : 21);
      assert.equal(event.bubbles, true); assert.equal(event.cancelable, true);
    }
  }
});

test("unaccepted drag cannot reach drop and still ends its actual drag session", async () => {
  const f = fixture({ accept: false });
  await assert.rejects(f.run(false), /did not accept/);
  assert.deepEqual(f.events.map(event => event.type), ["dragstart", "dragover", "dragend"]);
});

test("drop failure still ends the drag session and preserves the error", async () => {
  const f = fixture({ failDrop: true });
  await assert.rejects(f.run(false), /drop fixture failure/);
  assert.equal(f.events.at(-1).type, "dragend");
});

test("missing native source or layout geometry cannot produce a passing drag", async () => {
  const disconnected = fixture(); disconnected.sourceNode.isConnected = false;
  await assert.rejects(disconnected.run(false), /lost its source/);
  assert.equal(disconnected.events.length, 0);
  const noLayout = fixture({ height: 0 });
  await assert.rejects(noLayout.run(false), /no native layout geometry/);
  assert.equal(noLayout.events.length, 0);
});
