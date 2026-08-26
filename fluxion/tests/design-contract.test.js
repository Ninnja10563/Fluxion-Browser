"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const chrome = fs.readFileSync(path.join(root, "chrome/fluxion-chrome.js"), "utf8");
const palette = fs.readFileSync(path.join(root, "chrome/fluxion-palette.js"), "utf8");
const newTab = fs.readFileSync(path.join(root, "newtab/index.html"), "utf8");
const runtimeConfig = fs.readFileSync(
  path.join(root, "runtime/fluxion.cfg"),
  "utf8",
);
const macBuilder = fs.readFileSync(
  path.join(root, "scripts/prepare-macos-runtime.sh"),
  "utf8",
);
const macVerifier = fs.readFileSync(
  path.join(root, "scripts/verify-macos-app.sh"),
  "utf8",
);

test("browser chrome avoids prohibited decorative effects", () => {
  const productCss = `${chrome}\n${palette}`;
  assert.doesNotMatch(productCss, /(?:linear|radial)-gradient|backdrop-filter|filter:\s*blur/i);
});

test("new tab stays blank instead of duplicating the address field", () => {
  assert.doesNotMatch(newTab, /<form|<input|welcome|motivat/i);
  assert.match(newTab, /Blank new tab/);
});

test("compact Flow uses the researched 44px rail", () => {
  assert.match(chrome, /data-state="compact"[^}]*width:\s*44px/);
});

test("macOS package cannot inherit Firefox's asset-catalogue icon", () => {
  assert.match(macBuilder, /rm -f -- "\$resources\/Assets\.car"/);
  assert.match(macBuilder, /plutil -remove CFBundleIconName/);
  assert.match(macBuilder, /CFBundleIconFile -string fluxion\.icns/);
});

test("macOS visual gate waits for settled chrome", () => {
  assert.match(macVerifier, /fluxion\.palette\.health/);
  assert.match(macVerifier, /sleep 4/);
  assert.match(macVerifier, /screencapture -x/);
});

test("new profiles never show Firefox onboarding or upload Mozilla telemetry", () => {
  assert.match(
    runtimeConfig,
    /setBoolPref\("browser\.preonboarding\.enabled", false\)/,
  );
  assert.match(
    runtimeConfig,
    /setBoolPref\("browser\.aboutwelcome\.enabled", false\)/,
  );
  assert.match(
    runtimeConfig,
    /setBoolPref\("datareporting\.policy\.dataSubmissionEnabled", false\)/,
  );
  assert.doesNotMatch(runtimeConfig, /termsofuse\.accepted(?:Date|Version)/);
});
