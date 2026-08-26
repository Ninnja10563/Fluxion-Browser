"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const policy = require("../chrome/core/memory-policy.js");

test("normalises and deduplicates excluded domains", () => {
  assert.deepEqual(
    policy.parseExcludedDomains('["https://www.Example.com/path", "example.com", "docs.example.org"]'),
    ["example.com", "docs.example.org"],
  );
});

test("domain exclusions include subdomains but not suffix lookalikes", () => {
  assert.equal(policy.isExcludedUrl("https://docs.example.com/guide", ["example.com"]), true);
  assert.equal(policy.isExcludedUrl("https://notexample.com/", ["example.com"]), false);
});

test("sensitive and non-web locations are rejected", () => {
  assert.equal(policy.isSensitiveUrl("https://accounts.example.com/profile"), true);
  assert.equal(policy.isSensitiveUrl("https://example.com/oauth/callback"), true);
  assert.equal(policy.isSensitiveUrl("file:///Users/person/secret.txt"), true);
  assert.equal(policy.isSensitiveUrl("https://developer.mozilla.org/en-US/docs/Web/API"), false);
});
