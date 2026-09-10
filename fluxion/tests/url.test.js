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

test("adds HTTPS to ordinary domains and HTTP to local development hosts", () => {
  assert.equal(resolveNavigation("example.com/docs"), "https://example.com/docs");
  assert.equal(resolveNavigation("localhost:8080/test"), "http://localhost:8080/test");
});

test("local network and development addresses navigate without becoming search terms", () => {
  for (const address of ["127.0.0.1:3000/path?q=test#section", "192.168.1.1", "10.0.0.2:8080",
    "172.16.0.1", "172.31.255.255", "169.254.2.3", "0.0.0.0:8000", "[::1]:3000",
    "[fd12::1]:4000", "[fe80::1]", "localhost", "app.localhost:8080", "printer.local", "devbox:5000"]) {
    assert.equal(resolveNavigation(address), `http://${address}`, address);
  }
});

test("public numeric hosts keep HTTPS and explicit schemes always retain user intent", () => {
  for (const address of ["8.8.8.8", "172.32.0.1", "[2606:4700:4700::1111]", "example.com:8443"]) {
    assert.equal(resolveNavigation(address), `https://${address}`, address);
  }
  assert.equal(resolveNavigation("https://localhost:3000"), "https://localhost:3000");
});

test("malformed local addresses and executable schemes never become privileged navigation", () => {
  for (const value of ["999.1.1.1", "127.0.0.1:99999", "localhost:99999", "[::gg]:80", "[::1]@example.org", "127.00.0.1",
    "javascript:3000", "data:3000", "vbscript:3000", "dev box:3000"]) {
    assert.equal(resolveNavigation(value), null, value);
  }
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
