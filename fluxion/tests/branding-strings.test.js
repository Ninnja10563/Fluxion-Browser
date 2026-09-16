"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "../branding/strings.json"), "utf8"));
const native = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/gecko-branding-155.json"), "utf8"));
const lock = JSON.parse(fs.readFileSync(path.join(__dirname, "../runtime/gecko-lock.json"), "utf8"));
const browser = "browser/omni.ja";
function patched(archive, resource) {
  let text = native.archives[archive][resource];
  for (const { before, after } of manifest.archives[archive][resource].replacements) text = text.replace(before, after);
  return text;
}

test("branding manifest is pinned to exact native resources and every replacement matches once", () => {
  assert.equal(manifest.version, lock.version);
  assert.deepEqual(Object.keys(manifest.archives).sort(), ["browser/omni.ja", "omni.ja"]);
  for (const [archive, resources] of Object.entries(manifest.archives)) {
    for (const [resource, rule] of Object.entries(resources)) {
      assert.match(resource, /^(?:chrome|localization)\/.*\.(?:ftl|properties)$/);
      assert.ok(!resource.includes(".."));
      const source = native.archives[archive][resource];
      assert.equal(typeof source, "string", `Missing audited native fixture: ${resource}`);
      assert.equal(crypto.createHash("sha256").update(source).digest("hex"), rule.sha256, resource);
      assert.ok(rule.replacements.length > 0 && rule.replacements.length <= 32);
      const targets = new Set();
      for (const replacement of rule.replacements) {
        assert.deepEqual(Object.keys(replacement).sort(), ["after", "before"]);
        const { before, after } = replacement;
        assert.equal(typeof before, "string"); assert.equal(typeof after, "string");
        assert.ok(before.length > 0 && before !== after && !before.includes("\n") && !after.includes("\n"));
        assert.equal(source.split(before).length - 1, 1, `Ambiguous/missing native replacement: ${resource}`);
        assert.equal(targets.has(before), false); targets.add(before);
        assert.equal(before.split("=")[0], after.split("=")[0], "Native localization identifiers must not change");
      }
    }
  }
});

test("canonical Fluent and legacy branding resolve actual native quit-dialog product references", () => {
  const terms = patched(browser, "localization/en-US/branding/brand.ftl");
  for (const name of ["shorter", "short", "shortcut", "full", "product"]) {
    assert.match(terms, new RegExp(`^-brand-${name}-name = Fluxion$`, "m"));
  }
  const legacy = patched(browser, "chrome/en-US/locale/branding/brand.properties");
  for (const key of ["brandShorterName", "brandShortName", "brandFullName"]) assert.match(legacy, new RegExp(`^${key}=Fluxion$`, "m"));
  const dialogs = native.archives[browser]["localization/en-US/browser/tabbrowser.ftl"];
  assert.equal(manifest.archives[browser]["localization/en-US/browser/tabbrowser.ftl"], undefined,
    "Quit behavior and dialog strings need no patch when canonical brand terms are corrected");
  const shortName = terms.match(/^-brand-short-name = (.+)$/m)[1];
  for (const [id, expected] of [
    ["tabbrowser-confirm-close-tabs-with-key-title", "Close window and quit Fluxion?"],
    ["tabbrowser-confirm-close-tabs-with-key-button", "Quit Fluxion"],
    ["tabbrowser-confirm-close-warn-shortcut-title", "Quit Fluxion or close current tab?"],
  ]) {
    const pattern = dialogs.match(new RegExp(`^${id} = (.+)$`, "m"))[1];
    assert.equal(pattern.replace("{ -brand-short-name }", shortName), expected);
  }
});

test("branding leaves formatting arguments, Fluent references, native markup, and links unchanged", () => {
  const tokens = /\{[^{}]*\}|%[\d$]*[A-Za-z]|<[^>]+>|https?:\/\/[^\s<"']+/g;
  for (const [archive, resources] of Object.entries(manifest.archives)) {
    for (const [resource, rule] of Object.entries(resources)) {
      for (const { before, after } of rule.replacements) {
        assert.deepEqual(after.match(tokens) || [], before.match(tokens) || [], resource);
      }
      const original = native.archives[archive][resource];
      const result = patched(archive, resource);
      assert.equal(result.split("\n").length, original.split("\n").length, resource);
    }
  }
});

test("local product errors change identity while Mozilla services, mobile products and legal notices remain accurate", () => {
  for (const [archive, resource] of [["omni.ja", "chrome/en-US/locale/en-US/global/appstrings.properties"],
    [browser, "chrome/en-US/locale/browser/appstrings.properties"]]) {
    assert.doesNotMatch(patched(archive, resource), /Firefox/);
    assert.match(patched(archive, resource), /networkProtocolError=Fluxion/);
  }
  const brand = patched(browser, "localization/en-US/branding/brand.ftl");
  assert.match(brand, /^-vendor-short-name = Mozilla$/m);
  assert.match(brand, /^trademarkInfo = Firefox and the Firefox logos are trademarks of the Mozilla Foundation\.$/m);
  const features = patched("omni.ja", "localization/en-US/toolkit/branding/brandings.ftl");
  for (const service of ["Firefox Monitor", "Firefox Send", "Firefox Profiler", "Firefox Relay", "Mozilla VPN", "MDN Web Docs"]) {
    assert.ok(features.includes(` = ${service}\n`), service);
  }
  for (const label of ["Fluxion Screenshots", "Fluxion Translations", "Address Suggestions", "Fluxion Home", "Browsing Overview", "Experimental Features"]) {
    assert.ok(features.includes(` = ${label}\n`), label);
  }
  const remote = patched(browser, "localization/en-US/devtools/client/aboutdebugging.ftl");
  assert.match(remote, /This version of Fluxion cannot debug Firefox for Android \(68\)/);
  assert.match(remote, /installing Firefox for Android Nightly/);
  assert.match(remote, /Please update Fluxion\./);
  for (const resource of ["localization/en-US/browser/migrationWizard.ftl", "localization/en-US/browser/appExtensionFields.ftl",
    "chrome/en-US/locale/en-US/devtools/client/jsonview.properties"]) {
    assert.equal(manifest.archives[browser][resource], undefined, "Do not rename other products, real themes or Profiler links");
  }
});
