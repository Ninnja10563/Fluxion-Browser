"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const packageData = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const chrome = fs.readFileSync(path.join(root, "chrome/fluxion-chrome.js"), "utf8");
const settings = fs.readFileSync(path.join(root, "chrome/fluxion-settings.js"), "utf8");
const runtime = fs.readFileSync(path.join(root, "runtime/fluxion.cfg"), "utf8");

test("About Fluxion presents the current product version without remote scripts", () => {
  const productVersion = packageData.version.split("-")[0];
  assert.match(settings, new RegExp(`PRODUCT_VERSION = "${productVersion.replaceAll(".", "\\.")}"`));
  assert.match(settings, /!about\.textContent\.includes\("Firefox Browser"\)/);
  assert.match(settings, /Mozilla Gecko/);
  assert.match(settings, /about:license/);
  assert.match(runtime, /fluxion\.about\.url", "about:preferences\?fluxion=about"/);
  assert.doesNotMatch(runtime, /registerFactory|nsIAboutModule/);
});

test("the native Flow menu owns product commands while retaining Gecko execution", () => {
  assert.match(chrome, /id: "fluxion-native-menu", label: "Flow"/);
  assert.match(chrome, /Command Palette…/);
  assert.match(chrome, /Search Tabs…/);
  assert.match(chrome, /fluxion-native-sidebar-state/);
  assert.match(chrome, /fluxion-native-workspace/);
  assert.match(chrome, /FluxionLibrary\?\.open\("history"\)/);
  assert.match(chrome, /FluxionLibrary\?\.open\("bookmarks"\)/);
  assert.match(chrome, /FluxionLibrary\?\.open\("downloads"\)/);
  assert.match(chrome, /About Fluxion/);
  assert.match(chrome, /Fluxion Settings…/);
});
