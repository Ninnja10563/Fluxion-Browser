"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const policy = require("../chrome/core/memory-policy.js");
const base = () => ({ version: 1, directDomains: [], lists: [] });
const list = (id, domains, enabled = true) => ({ id, name: "Health", enabled, domains });
const read = values => policy.readPolicy({ getPrefType: key => !values.has(key) ? 0 : typeof values.get(key) === "string" ? 32 : 128,
  getStringPref: (key, fallback) => values.get(key) ?? fallback });

test("canonical policy is authoritative and invalid canonical data never falls back to legacy", () => {
  const values = new Map([[policy.LEGACY_PREF, '["legacy.example"]']]);
  assert.deepEqual(policy.effectiveDomains(read(values)), ["legacy.example"]);
  values.set(policy.POLICY_PREF, JSON.stringify({ ...base(), directDomains: ["direct.example"], lists: [list("one", ["health.example"]), list("two", ["disabled.example"], false)] }));
  assert.deepEqual(policy.effectiveDomains(read(values)), ["direct.example", "health.example"]);
  for (const raw of ["\u0000", true, "", "{", '{"version":2,"directDomains":[],"lists":[]}', '[]']) {
    values.set(policy.POLICY_PREF, raw);
    assert.equal(read(values).valid, false);
    assert.equal(policy.effectiveDomains(read(values)), null);
    assert.equal(policy.canIndexPage({ url: "https://safe.example" }, null), false);
    assert.equal(policy.createPageFilter(null)({ url: "https://safe.example" }), false);
    assert.equal(policy.isExcludedUrl("https://safe.example", null), true);
  }
});

test("list normalization preserves user names and exact domain boundaries without automatic classification", () => {
  const result = policy.validatePolicy({ ...base(), directDomains: ["https://www.Example.com./path"],
    lists: [list("one", ["EXAMPLE.com", "example.com", "bücher.example"])] });
  assert.deepEqual(result.directDomains, ["example.com"]);
  assert.deepEqual(result.lists[0].domains, ["example.com", "xn--bcher-kva.example"]);
  const filter = policy.createPageFilter(policy.effectiveDomains({ ...result, valid: true }));
  assert.equal(filter({ url: "https://docs.example.com./article" }), false);
  assert.equal(filter({ url: "https://notexample.com/article" }), true);
});

test("limits reject the whole policy including disabled membership, invalid IDs and oversized UTF8 data", () => {
  const domains = Array.from({ length: 200 }, (_, i) => `site${i}.example`);
  assert.equal(policy.validatePolicy({ ...base(), directDomains: [...domains, domains[0]] }).directDomains.length, 200);
  assert.throws(() => policy.validatePolicy({ ...base(), directDomains: domains, lists: [list("one", ["extra.example"], false)] }), /200/);
  assert.throws(() => policy.validatePolicy({ ...base(), lists: Array.from({ length: 21 }, (_, i) => list(`id${i}`, [])) }), /20/);
  assert.throws(() => policy.validatePolicy({ ...base(), lists: [list("one", []), list("one", [])] }), /identity/);
  assert.throws(() => policy.validatePolicy({ ...base(), lists: [{ ...list("one", []), name: "x".repeat(41) }] }), /1–40/);
  assert.throws(() => policy.validatePolicy({ ...base(), directDomains: [`${"a".repeat(254)}.example`] }), /253/);
  assert.throws(() => policy.validatePolicy({ ...base(), unused: "😀".repeat(32769) }), /128 KiB/);
  const values = new Map([[policy.LEGACY_PREF, JSON.stringify([...domains, "extra.example"])]]);
  assert.equal(read(values).valid, false, "legacy migration must never silently truncate an over-cap value");
});
