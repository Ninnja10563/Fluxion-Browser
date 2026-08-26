"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { normaliseInput, resolveNavigation } = require("../chrome/core/url.js");

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
  assert.equal(
    resolveNavigation("javascript:alert(document.domain)"),
    "https://duckduckgo.com/?q=javascript%3Aalert(document.domain)"
  );
  assert.equal(
    resolveNavigation("data:text/html,<script>alert(1)</script>"),
    "https://duckduckgo.com/?q=data%3Atext%2Fhtml%2C%3Cscript%3Ealert(1)%3C%2Fscript%3E"
  );
});

test("adds HTTPS to domains and localhost", () => {
  assert.equal(resolveNavigation("example.com/docs"), "https://example.com/docs");
  assert.equal(resolveNavigation("localhost:8080/test"), "https://localhost:8080/test");
});

test("uses encoded search terms for non-URLs", () => {
  assert.equal(
    resolveNavigation("gecko vertical tabs"),
    "https://duckduckgo.com/?q=gecko%20vertical%20tabs"
  );
});
