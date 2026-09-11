"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../runtime/fluxion.cfg"), "utf8");
const start = source.indexOf("  const transferFixtureOrigin =");
const end = source.indexOf("  const pickerFixtureOrigin =", start);
assert.ok(start >= 0 && end > start, "Transfer actor registration markers missing");
function register(environment) {
  const calls = [];
  vm.runInNewContext(source.slice(start, end), {
    Services: { env: { get: name => environment[name] || "" } },
    ChromeUtils: { registerWindowActor: (name, options) => calls.push({ name, options }) },
  });
  return calls;
}
test("ordinary browsing cannot register the fixed fixture actor even with a loopback origin", () => {
  for (const extra of [{}, { FLUXION_STRUCTURE_TEST: "true" }, { FLUXION_TAB_TRANSFER_TEST: "0" }]) {
    assert.equal(register({ FLUXION_TAB_TRANSFER_ORIGIN: "http://127.0.0.1:4123", ...extra }).length, 0);
  }
});
test("both explicit verification modes retain exact loopback-origin registration gating", () => {
  for (const mode of ["FLUXION_STRUCTURE_TEST", "FLUXION_TAB_TRANSFER_TEST"]) {
    for (const origin of ["", "https://127.0.0.1:4123", "http://localhost:4123", "http://127.0.0.1:4123/", "http://example.org:4123"]) {
      assert.equal(register({ [mode]: "1", FLUXION_TAB_TRANSFER_ORIGIN: origin }).length, 0);
    }
    const calls = register({ [mode]: "1", FLUXION_TAB_TRANSFER_ORIGIN: "http://127.0.0.1:4123" });
    assert.equal(calls.length, 1); assert.equal(calls[0].name, "FluxionTabTransferVerification");
    assert.deepEqual(Array.from(calls[0].options.matches), ["http://127.0.0.1/*"]);
    assert.equal(calls[0].options.child.esModuleURI, "resource://fluxion/actors/FluxionTabTransferVerificationChild.sys.mjs");
  }
});
