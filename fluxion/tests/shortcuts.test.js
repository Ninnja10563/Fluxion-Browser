"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

require(path.resolve(__dirname, "../chrome/core/shortcuts.js"));
const policy = globalThis.FluxionShortcutPolicy;

test("shortcut maps retain valid custom chords and repair invalid values", () => {
  const map = policy.normaliseMap({ palette: "Accel+Alt+KeyK", tabSearch: "nope" });
  assert.equal(map.palette, "Accel+Alt+KeyK");
  assert.equal(map.tabSearch, policy.ACTIONS.tabSearch.defaultChord);
});

test("shortcut capture maps the platform accelerator consistently", () => {
  const event = { code: "KeyK", metaKey: true, ctrlKey: false, altKey: false, shiftKey: true };
  assert.equal(policy.eventChord(event, true), "Accel+Shift+KeyK");
  assert.equal(policy.eventChord({ ...event, metaKey: false, ctrlKey: true }, false), "Accel+Shift+KeyK");
  assert.equal(policy.format("Accel+Alt+BracketRight", true), "⌘ ⌥ ]");
});

test("shortcut validation rejects browser-reserved and conflicting chords", () => {
  const current = policy.normaliseMap({});
  assert.equal(policy.validate("palette", "Accel+KeyQ", current).ok, false);
  const conflict = policy.validate("palette", current.tabSearch, current);
  assert.equal(conflict.ok, false);
  assert.match(conflict.reason, /Search open tabs/);
  assert.equal(policy.validate("palette", "Accel+Alt+KeyK", current).ok, true);
});
