"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

require(path.resolve(__dirname, "../chrome/core/peek.js"));
const policy = globalThis.FluxionPeekPolicy;

test("Peek accepts ordinary web and local links but rejects privileged schemes", () => {
  assert.equal(policy.isSafeLink("https://example.com/path"), true);
  assert.equal(policy.isSafeLink("http://localhost:3000/"), true);
  assert.equal(policy.isSafeLink("file:///tmp/note.pdf"), true);
  assert.equal(policy.isSafeLink("javascript:alert(1)"), false);
  assert.equal(policy.isSafeLink("about:config"), false);
  assert.equal(policy.isSafeLink("data:text/html,test"), false);
});

test("Peek pairs only two live ordinary unsplit tabs", () => {
  const source = { parentNode: {}, pinned: false, splitview: null };
  const peek = { parentNode: {}, pinned: false, splitview: null };
  assert.equal(policy.canPair(source, peek), true);
  assert.equal(policy.canPair(source, source), false);
  assert.equal(policy.canPair({ ...source, pinned: true }, peek), false);
  assert.equal(policy.canPair(source, { ...peek, splitview: {} }), false);
  assert.equal(policy.canPair(source, { ...peek, parentNode: null }), false);
});
