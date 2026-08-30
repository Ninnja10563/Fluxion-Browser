"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { classifyNavigation, normaliseInput, resolveNavigation } = require("../chrome/core/url.js");

test("normalises whitespace without rewriting the user's text", () => {
  assert.equal(normaliseInput("  example search  "), "example search");
});

test("empty navigation opens a new tab", () => {
  assert.equal(resolveNavigation("   "), "about:newtab");
});

test("preserves explicit safe and browser schemes", () => {
  assert.equal(resolveNavigation("https://example.com/a"), "https://example.com/a");
  assert.equal(resolveNavigation("about:preferences"), "about:preferences");
  assert.equal(resolveNavigation("file:///tmp/example.pdf"), "file:///tmp/example.pdf");
});

test("does not open script-bearing schemes from privileged chrome", () => {
  assert.equal(resolveNavigation("javascript:alert(document.domain)"), null);
  assert.equal(resolveNavigation("data:text/html,<script>alert(1)</script>"), null);
});

test("adds HTTPS to domains and localhost", () => {
  assert.equal(resolveNavigation("example.com/docs"), "https://example.com/docs");
  assert.equal(resolveNavigation("localhost:8080/test"), "https://localhost:8080/test");
});

test("leaves non-address text for Gecko SearchService", () => {
  assert.equal(resolveNavigation("gecko vertical tabs"), null);
});

test("classifies addresses separately from engine-owned search text", () => {
  assert.deepEqual(classifyNavigation("example.com/docs"), {
    kind: "address", value: "https://example.com/docs",
  });
  assert.deepEqual(classifyNavigation("about:preferences"), {
    kind: "address", value: "about:preferences",
  });
  assert.deepEqual(classifyNavigation("javascript:alert(1)"), {
    kind: "search", value: "javascript:alert(1)",
  });
  assert.deepEqual(classifyNavigation("local gecko browser"), {
    kind: "search", value: "local gecko browser",
  });
});
