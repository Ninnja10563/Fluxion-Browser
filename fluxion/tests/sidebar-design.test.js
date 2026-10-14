"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const source = readFileSync(join(__dirname, "../chrome/fluxion-chrome.js"), "utf8");
const css = source.match(/style\.textContent = `([\s\S]*?)`;/)[1];

test("sidebar motion does not animate webpage width or expensive shadows", () => {
  const rail = css.match(/#fluxion-flow \{([^}]+)\}/)[1];
  assert.match(rail, /transition: none/);
  assert.match(css, /#fluxion-settings, #fluxion-library \{ transition: none; \}/);
  assert.doesNotMatch(css, /transition:[^;]*box-shadow/);
  assert.match(css, /transition: transform var\(--fluxion-fast\), opacity var\(--fluxion-fast\), visibility 0s linear 140ms/);
});

test("motion-off preference includes the palette and OS Reduce Motion includes folder disclosure", () => {
  const palette = readFileSync(join(__dirname, "../chrome/fluxion-palette.js"), "utf8");
  assert.match(palette, /:root\[data-fluxion-no-motion\] #fluxion-palette \{ animation: none !important; \}/);
  const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
  assert.match(reduced, /\.fluxion-group-disclosure \{ transition: none !important; \}/);
});

test("workspace context is outside the scrolling rows while New Tab remains after them", () => {
  assert.match(source, /tabScroll\.append\(tabsList, footer\)/);
  assert.match(source, /surface\.append\(\s*workspaceHeading, pinnedLabel, pinnedTabs, tabTree, workspaceBar/);
  assert.match(source, /tabTree\.append\(folderTabs, workspaceDivider, tabScroll\)/);
  assert.match(source, /workspaceDivider\.setAttribute\("aria-hidden", "true"\)/);
});

test("tabs and New Tab share row sizing, inset and corner tokens at every density", () => {
  for (const selector of [".fluxion-tab", ".fluxion-new-tab"]) {
    const start = css.indexOf(`    ${selector} {`);
    const block = css.slice(start, css.indexOf("}", start));
    assert.match(block, /height: var\(--fluxion-row-height\)/);
    assert.match(block, /border-radius: var\(--fluxion-row-radius\)/);
    assert.match(block, /padding: 0 8px/);
  }
  assert.match(css, /\.fluxion-tabs \{ padding: 1px var\(--fluxion-rail-gutter\)/);
  assert.match(css, /\.fluxion-footer \{[^}]*padding: 2px var\(--fluxion-rail-gutter\)/);
  assert.match(css, /data-fluxion-density="compact"\] \{ --fluxion-row-height: 28px/);
  assert.match(css, /data-fluxion-density="roomy"\] \{ --fluxion-row-height: 40px/);
});

test("New Tab hint and glyph are decorative while the button retains its accessible name", () => {
  assert.match(source, /newTabHint\.setAttribute\("aria-hidden", "true"\)/);
  assert.match(source, /newTabHint\.textContent = toolbarAccel\("⌘T", "Ctrl\+T"\)/);
  assert.match(source, /newTabButton\.append\(vectorGlyph/);
  assert.match(source, /newTabButton\.setAttribute\("aria-label", "New tab"\)/);
  assert.match(css, /\.fluxion-new-tab:is\(:hover, :focus-visible\) > \.fluxion-keyhint \{ opacity: 1/);
  assert.match(css, /:root\[data-fluxion-no-motion\] \.fluxion-keyhint,/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.fluxion-workspace-more, \.fluxion-workspace-heading, \.fluxion-new-tab, \.fluxion-keyhint \{ transition: none/);
});
