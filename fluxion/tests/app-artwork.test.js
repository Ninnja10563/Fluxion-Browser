"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assets = path.join(__dirname, "../assets/app-icons");
test("application artwork is the owner's exact supplied PNG data at each declared size", () => {
  for (const [name, digest, size] of [
    ["app-icon-1024.png", "5600c94e5e6e93505add8cf0a1210bed1bd7b6e03e6f9b745eb51a2a739cde10", 1024],
    ["app-icon-512.png", "f2709be2433bd2e207f3222306e98e5d66d8d3471d6c55c7e13af77fbf290b16", 512],
    ["favicon.png", "f82cad26c3098094c8595cece5ddf95bd4e7cf1aab917e499f6d83258d9ed006", 32],
  ]) {
    const bytes = fs.readFileSync(path.join(assets, name));
    assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"), digest, name);
    assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.equal(bytes.readUInt32BE(16), size); assert.equal(bytes.readUInt32BE(20), size);
  }
});
test("About and blank new-tab branding point to the transparent derivative", () => {
  const settings = fs.readFileSync(path.join(__dirname, "../chrome/fluxion-settings.js"), "utf8");
  const newtab = fs.readFileSync(path.join(__dirname, "../newtab/index.html"), "utf8");
  assert.match(settings, /aboutLogo\.src = "resource:\/\/fluxion\/assets\/app-icons\/fluxion-mark\.png"/);
  assert.match(newtab, /rel="icon" type="image\/png" href="\.\.\/assets\/app-icons\/fluxion-mark\.png"/);
});
test("New Tab uses the transparent mark even with a restored tile favicon; websites retain their own icon", () => {
  const source = fs.readFileSync(path.join(__dirname, "../chrome/fluxion-chrome.js"), "utf8");
  const start = source.indexOf("  function iconFor(tab) {"), end = source.indexOf("  function askGroupName", start);
  assert.ok(start > 0 && end > start);
  const newTabURL = "file:///Applications/Fluxion.app/Contents/Resources/fluxion/newtab/index.html";
  const iconFor = require("node:vm").runInNewContext(`${source.slice(start, end)}; iconFor`, { NEW_TAB_URL: newTabURL });
  const tab = url => ({ linkedBrowser: { currentURI: { spec: url } }, getAttribute: () => "cached-site-icon.png", image: "native-icon.png" });
  for (const url of [newTabURL, "about:newtab"]) {
    assert.equal(iconFor(tab(url)), "resource://fluxion/assets/app-icons/fluxion-mark.png");
  }
  for (const url of ["https://example.org/", "about:blank", `${newTabURL}.other`]) {
    assert.equal(iconFor(tab(url)), "cached-site-icon.png");
  }
});
