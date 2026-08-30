"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const packageData = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const about = fs.readFileSync(path.join(root, "about/index.html"), "utf8");
const chrome = fs.readFileSync(path.join(root, "chrome/fluxion-chrome.js"), "utf8");
const runtime = fs.readFileSync(path.join(root, "runtime/fluxion.cfg"), "utf8");

test("About Fluxion presents the current product version without remote scripts", () => {
  const productVersion = packageData.version.split("-")[0];
  assert.match(about, new RegExp(`data-fluxion-version>${productVersion.replaceAll(".", "\\.")}<`));
  assert.doesNotMatch(about, /<script|Firefox Browser|firefox\.com/i);
  assert.match(about, /Mozilla Gecko/);
  assert.match(about, /about:license/);
  assert.match(about, /resource:\/\/fluxion\/about\/about\.css/);
  assert.match(runtime, /protocol\/about;1\?what=fluxion/);
  assert.match(runtime, /URI_SAFE_FOR_UNTRUSTED_CONTENT/);
  assert.match(runtime, /URI_CAN_LOAD_IN_CHILD/);
  assert.match(runtime, /createContentPrincipal\(uri, \{\}\)/);
  assert.match(runtime, /aboutFluxionRegistered \? "about:fluxion"/);
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
