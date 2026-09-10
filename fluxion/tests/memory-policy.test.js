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

test("excluded DNS names retain their boundary with a trailing root dot and Unicode spelling", () => {
  for (const url of ["https://example.com./article", "https://docs.EXAMPLE.com./guide",
    "https://www.example.com./", "https://example.com%2e/article"]) {
    assert.equal(policy.isExcludedUrl(url, ["https://www.example.com./"]), true, url);
    assert.equal(policy.canIndexPage({ url }, ["example.com"]), false, url);
  }
  assert.equal(policy.isExcludedUrl("https://docs.bücher.example./", ["bücher.example"]), true);
  assert.equal(policy.isExcludedUrl("https://notexample.com./", ["example.com"]), false);
  assert.equal(policy.isExcludedUrl("https://example.com.evil.invalid./", ["example.com"]), false);
});

test("sensitive path classification catches encoded letters, separators and nested decoding", () => {
  for (const path of ["/%61ccount", "/%42ILLING", "/guide%2Fcheckout/summary",
    "/guide%5cwallet", "/guide%252foauth/callback", "/%2561ccount",
    "/%252561ccount", "/%25252561ccount", "/guide%255Cpayment"]) {
    const url = `https://example.com${path}`;
    assert.equal(policy.isSensitiveUrl(url), true, path);
    assert.equal(policy.canIndexPage({ url, text: "Previously visible account evidence" }), false, path);
    assert.equal(new URL(url).href, url, "classification never rewrites the browsing URL");
  }
});

test("ambiguous decoding fails closed within fixed Memory-only safety limits", () => {
  for (const path of ["/unfinished%", "/bad%2", "/bad%GG", "/invalid%C3%28",
    "/invalid%FF", "/literal%25", "/%2525252567uide", `/${"a".repeat(8192)}`]) {
    assert.equal(policy.isSensitiveUrl(`https://example.com${path}`), true, path.slice(0, 70));
  }
  assert.equal(policy.isSensitiveUrl(`https://example.com/${"a".repeat(8191)}`), false);
});

test("ordinary encoded article paths remain eligible without broad substring exclusions", () => {
  for (const path of ["/caf%C3%A9", "/guide%20to%20web", "/docs%2Fapi",
    "/%2567uide", "/%25252567uide", "/accounting", "/wallet-guide",
    "/docs?redirect=%2Faccount", "/docs#billing"]) {
    assert.equal(policy.canIndexPage({ url: `https://example.com${path}` }), true, path);
  }
  assert.equal(policy.canIndexPage({ url: "https://example.com/guide", isPrivate: true }), false);
  assert.equal(policy.canIndexPage({ url: "https://example.com/guide", hasPasswordField: true }), false);
});
