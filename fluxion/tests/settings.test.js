"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

require(path.resolve(__dirname, "../chrome/core/settings.js"));
const settings = globalThis.FluxionSettings;

test("settings constrain persisted appearance choices", () => {
  assert.equal(settings.normaliseSidebar("compact"), "compact");
  assert.equal(settings.normaliseSidebar("wide"), "expanded");
  assert.equal(settings.normaliseDensity("roomy"), "roomy");
  assert.equal(settings.normaliseDensity("tiny"), "standard");
});

test("settings accept only Gecko startup modes exposed by Fluxion", () => {
  assert.equal(settings.startupPage("3"), 3);
  assert.equal(settings.startupPage(0), 0);
  assert.equal(settings.startupPage("unexpected"), 1);
});

test("homepage and exclusion inputs are bounded and normalised", () => {
  assert.equal(settings.homepage("  https://example.com/  "), "https://example.com/");
  assert.equal(settings.homepage("\n"), "about:newtab");
  assert.deepEqual(
    settings.excludedDomains(" Example.com, docs.example\nexample.com "),
    ["example.com", "docs.example"],
  );
});
