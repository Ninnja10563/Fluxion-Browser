"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Organisation = require("../chrome/core/tab-organisation.js");

function record(title, hostname, overrides = {}) {
  return { title, hostname, url: `https://${hostname}/page`, ...overrides };
}

test("suggests a cross-site topic only when at least three tabs support it", () => {
  const suggestion = Organisation.suggestGroup([
    record("React reference", "react.dev"),
    record("React source", "github.com"),
    record("React package", "npmjs.com"),
    record("Unrelated weather", "weather.example"),
  ]);
  assert.equal(suggestion.name, "React");
  assert.equal(suggestion.records.length, 3);
  assert.match(suggestion.reason, /3 tabs share/);
  assert.equal(Organisation.suggestGroup([
    record("React reference", "react.dev"), record("React source", "github.com"),
  ]), null);
});

test("same-domain evidence forms a restrained named suggestion", () => {
  const suggestion = Organisation.suggestGroup([
    record("Issue one", "github.com"), record("Issue two", "github.com"),
    record("Pull request", "github.com"),
  ]);
  assert.equal(suggestion.name, "GitHub");
  assert.equal(suggestion.records.length, 3);
});

test("never proposes pinned, grouped, split, or privileged tabs", () => {
  const records = [
    record("React pinned", "react.dev", { pinned: true }),
    record("React grouped", "github.com", { grouped: true }),
    record("React split", "npmjs.com", { split: true }),
    { title: "React settings", hostname: "", url: "about:preferences" },
  ];
  assert.deepEqual(Organisation.eligible(records), []);
  assert.equal(Organisation.suggestGroup(records), null);
});

test("caps a proposal so confirmation remains readable", () => {
  const records = Array.from({ length: 20 }, (_, index) =>
    record(`Rust crate ${index}`, `host${index}.example`, { url: `https://host${index}.example/rust` })
  );
  const suggestion = Organisation.suggestGroup(records);
  assert.equal(suggestion.records.length, 8);
});
