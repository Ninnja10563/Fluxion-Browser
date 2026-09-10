"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

// These are actor contract tests, not evidence of an operating-system picker.
function fixture() {
  const origin = "http://127.0.0.1:9876", listeners = new Map(), pending = [];
  let submits = 0;
  const input = { type: "file", files: [], scrollIntoView() {}, focus() { document.activeElement = input; },
    addEventListener(type, listener) { listeners.set(type, listener); } };
  const form = { action: `${origin}/file-picker-upload`, method: "post", enctype: "multipart/form-data",
    elements: { namedItem: name => name === "file" ? input : null }, requestSubmit() { submits++; } };
  const document = { documentURI: `${origin}/file-picker`, title: "Fluxion native file picker", activeElement: null,
    hasFocus: () => true, getElementById: id => id === "file-picker-form" ? form : null };
  const contentWindow = { location: { origin, pathname: "/file-picker" }, setTimeout: fn => pending.push(fn) };
  const context = vm.createContext({ JSWindowActorChild: class {} });
  const source = fs.readFileSync(require.resolve("../actors/FluxionFilePickerVerificationChild.sys.mjs"), "utf8");
  vm.runInContext(source.replace("export class", "globalThis.Actor = class"), context);
  const actor = new context.Actor();
  Object.assign(actor, { document, contentWindow });
  const command = (name, requestedOrigin = origin) => actor.receiveMessage({ name: `FluxionFilePicker:${name}`, data: { origin: requestedOrigin } });
  const event = (type, trusted = true, target = input) => listeners.get(type)({ target, isTrusted: trusted });
  return { command, event, input, form, document, contentWindow, pending, submits: () => submits };
}

test("picker actor confines commands to exact loopback origin, fixture document and form", () => {
  const f = fixture();
  assert.throws(() => f.command("Read", "https://example.com"), /origin mismatch/);
  assert.throws(() => f.command("Read", "http://127.0.0.1:9877"), /origin mismatch/);
  f.contentWindow.location.pathname = "/unrelated";
  assert.throws(() => f.command("Read"), /Unexpected native picker document/);
  f.contentWindow.location.pathname = "/file-picker";
  f.form.action = "https://example.com/upload";
  assert.throws(() => f.command("Focus"), /form contract/);
});

test("picker actor cannot inject a file or submit without the complete trusted sequence", () => {
  const f = fixture();
  assert.equal(f.command("Focus").focused, true);
  assert.throws(() => f.command("SetFile"), /Unsupported/);
  assert.throws(() => f.command("Submit"), /required trusted selection/);
  f.event("cancel");
  f.input.files = [{ name: "Fluxion café upload.txt", size: 86 }];
  f.event("change");
  assert.throws(() => f.command("Submit"), /required trusted selection/);
  f.event("input");
  const state = f.command("Submit");
  assert.deepEqual(JSON.parse(JSON.stringify(state.events)), { cancel: 1, change: 1, input: 1, untrusted: 0 });
  assert.equal(f.submits(), 0);
  f.pending.shift()();
  assert.equal(f.submits(), 1);
});

test("synthetic or wrong-target events cannot satisfy picker proof", () => {
  const f = fixture();
  f.command("Read");
  f.event("cancel", true, {});
  assert.equal(f.command("Read").events.cancel, 0);
  f.event("cancel"); f.event("input"); f.event("change");
  f.input.files = [{ name: "fixture.txt", size: 1 }];
  f.event("change", false);
  assert.equal(f.command("Read").events.untrusted, 1);
  assert.throws(() => f.command("Submit"), /required trusted selection/);
  assert.equal(f.pending.length, 0);
});

test("upload completion permits only read and no further picker actions", () => {
  const f = fixture();
  f.contentWindow.location.pathname = "/file-picker-upload";
  f.document.title = "Fluxion native picker upload complete";
  assert.equal(f.command("Read").title, f.document.title);
  for (const name of ["Focus", "Submit", "Evaluate"]) assert.throws(() => f.command(name), /Unexpected native picker document/);
});
