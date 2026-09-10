"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("packaged shortcut fixture records privileged trust flags without confusing DOM construction with OS input", () => {
  const source = fs.readFileSync(path.join(__dirname, "../chrome/fluxion-shortcut-verification.js"), "utf8");
  const begin = source.indexOf("    const key = (target, code, extra = {}) => {");
  const end = source.indexOf('    stage("capture-conflicts");', begin);
  assert.ok(begin >= 0 && end > begin);
  for (const isTrusted of [false, true]) {
    const events = [], report = { keyboardEventTrustedFlags: [] };
    const context = vm.createContext({ report, window: { KeyboardEvent: class {
      constructor(type, options) { Object.assign(this, { type, ...options, isTrusted }); }
    } } });
    vm.runInContext(`${source.slice(begin, end)}\nglobalThis.dispatchKey = key;`, context);
    const event = context.dispatchKey({ dispatchEvent: value => events.push(value) }, "KeyK", { shiftKey: true });
    assert.equal(events.length, 1);
    assert.ok(events[0] === event);
    assert.equal(event.code, "KeyK");
    assert.equal(event.bubbles && event.cancelable && event.metaKey && event.shiftKey, true);
    assert.deepEqual(report.keyboardEventTrustedFlags, [isTrusted]);
  }
  assert.match(source, /eventSource: "synthetic-DOM-keyboard-events-in-packaged-Gecko", nativeOSKeyboardTest: false/);
});
