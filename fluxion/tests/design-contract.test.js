"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const chrome = fs.readFileSync(path.join(root, "chrome/fluxion-chrome.js"), "utf8");
const palette = fs.readFileSync(path.join(root, "chrome/fluxion-palette.js"), "utf8");
const newTab = fs.readFileSync(path.join(root, "newtab/index.html"), "utf8");

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
