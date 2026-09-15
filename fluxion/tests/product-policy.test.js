"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const runtime = fs.readFileSync(path.join(__dirname, "../runtime/fluxion.cfg"), "utf8");
const start = runtime.indexOf("  function applyFluxionProductPolicy(prefs) {");
const end = runtime.indexOf("  applyFluxionProductPolicy(Services.prefs);", start);
assert.ok(start >= 0 && end > start, "execute the shipped early-startup policy");
const applyPolicy = vm.runInNewContext(`${runtime.slice(start, end)}; applyFluxionProductPolicy`);
const feature = "browser.ipProtection.enabled";

function preferences({ defaults = {}, user = {} } = {}) {
  const defaultValues = new Map(Object.entries(defaults));
  const userValues = new Map(Object.entries(user));
  const locked = new Set();
  return {
    defaultValues, userValues, locked,
    getDefaultBranch(prefix) {
      assert.equal(prefix, "");
      return { setBoolPref(key, value) { defaultValues.set(key, value); } };
    },
    setBoolPref(key, value) { userValues.set(key, value); },
    lockPref(key) { locked.add(key); },
    getBoolPref(key) {
      return locked.has(key) || !userValues.has(key) ? defaultValues.get(key) : userValues.get(key);
    },
  };
}

test("fresh profiles disable Firefox VPN before service and window initialization", () => {
  const prefs = preferences({ defaults: { [feature]: true } });
  applyPolicy(prefs);
  assert.equal(prefs.getBoolPref(feature), false);
  assert.deepEqual([...prefs.locked], [feature]);
  assert.ok(end < runtime.indexOf('const observer = {'), "policy precedes browser window injection");
});

test("an existing enabled profile cannot reintroduce the Firefox-only enrollment widget", () => {
  const prefs = preferences({ defaults: { [feature]: true }, user: { [feature]: true } });
  applyPolicy(prefs);
  assert.equal(prefs.defaultValues.get(feature), false);
  assert.equal(prefs.userValues.get(feature), false);
  // Gecko locked prefs read the default branch, including after a stale user
  // value is loaded or an experiment writes to the user branch later.
  prefs.setBoolPref(feature, true);
  assert.equal(prefs.getBoolPref(feature), false);
  applyPolicy(prefs);
  assert.equal(prefs.getBoolPref(feature), false);
});

test("the product gate leaves proxy, extensions, VPN session state and consent intact", () => {
  const preserved = {
    "network.proxy.type": 1,
    "network.proxy.http": "localhost",
    "extensions.enabledScopes": 15,
    "browser.ipProtection.optedOut": false,
    "browser.ipProtection.added": true,
    "browser.ipProtection.autoStartEnabled": true,
    "identity.fxaccounts.enabled": true,
    "browser.toolbars.bookmarks.visibility": "always",
    "browser.uiCustomization.state": '{"placements":{"nav-bar":["ipprotection-button","example-browser-action"]}}',
  };
  const prefs = preferences({ defaults: preserved, user: preserved });
  applyPolicy(prefs);
  for (const [key, value] of Object.entries(preserved)) {
    assert.equal(prefs.defaultValues.get(key), value, key);
    assert.equal(prefs.userValues.get(key), value, key);
    assert.equal(prefs.locked.has(key), false, key);
  }
  assert.deepEqual([...prefs.userValues.keys()].filter(key => !(key in preserved)), [feature]);
});
