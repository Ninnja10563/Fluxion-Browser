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

test("prepared page filters preserve public policy across URL, privacy and domain variants", () => {
  const inputs = [[], ["example.com", "bücher.example"], '["www.example.com.","docs.example.org"]',
    "EXAMPLE.com, bücher.example", null, false, {}, ["not a host", "https://www.example.com./path"]];
  const urls = ["https://example.com./article", "https://docs.example.com/article", "https://notexample.com/",
    "https://example.com.evil.invalid/", "https://docs.bücher.example./article", "https://safe.example/%61ccount",
    "https://safe.example/docs%2Flogin", "https://safe.example/%2561ccount", "https://safe.example/caf%C3%A9",
    "https://safe.example/bad%GG", "https://safe.example/docs?redirect=%2Faccount", "https://login.safe.example/",
    "https://user:secret@safe.example/article", "file:///private.txt", "javascript:alert(1)", "not a URL", ""];
  for (const domains of inputs) {
    const prepared = policy.createPageFilter(domains);
    for (const url of urls) for (const flags of [{}, { isPrivate: true }, { hasPasswordField: true }]) {
      const page = { url, ...flags };
      assert.equal(prepared(page), policy.canIndexPage(page, domains), `${url} / ${JSON.stringify(domains)}`);
    }
    for (const page of [null, undefined, {}, false]) assert.equal(prepared(page), policy.canIndexPage(page, domains));
  }
});

test("prepared policy is an immutable normalization snapshot, not a live caller array", () => {
  let normalizations = 0;
  const domains = [{ toString() { normalizations++; return "https://www.Example.com./path"; } }];
  const prepared = policy.createPageFilter(domains);
  assert.equal(normalizations, 1);
  domains[0] = "safe.example"; domains.push("new.example");
  for (let index = 0; index < 256; index++) {
    assert.equal(prepared({ url: "https://docs.example.com/article" }), false);
    assert.equal(prepared({ url: "https://safe.example/article" }), true);
  }
  assert.equal(normalizations, 1, "per-page checks must not normalize excluded domains again");
  const fresh = policy.createPageFilter(domains);
  assert.equal(fresh({ url: "https://safe.example/article" }), false);
  assert.equal(fresh({ url: "https://docs.example.com/article" }), true);
});

test("prepared domains preserve normalization deduplication and the existing 200-domain boundary", () => {
  const domains = Array.from({ length: 201 }, (_, index) => `blocked-${index}.example`);
  const prepared = policy.createPageFilter(domains);
  assert.equal(prepared({ url: "https://blocked-199.example/article" }), false);
  assert.equal(prepared({ url: "https://blocked-200.example/article" }), true);
  assert.equal(prepared({ url: "https://[broken/article" }), false);
});
