"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  fuzzyScore,
  normaliseSearchText,
  rankSearchItems,
} = require("../chrome/core/search.js");

test("normalises case, accents, and repeated whitespace", () => {
  assert.equal(normaliseSearchText("  Résumé   Tabs "), "resume tabs");
});

test("exact and prefix matches outrank loose fuzzy matches", () => {
  assert.ok(fuzzyScore("new tab", "new tab") > fuzzyScore("new tab", "new tab in workspace"));
  assert.ok(fuzzyScore("new tab", "new tab in workspace") > fuzzyScore("nwtb", "new tab"));
});

test("rejects values that do not contain the fuzzy sequence", () => {
  assert.equal(fuzzyScore("downloads", "workspace settings"), Number.NEGATIVE_INFINITY);
});

test("ranks stable items and respects boosts and limits", () => {
  const items = [
    { label: "Open downloads", boost: 0 },
    { label: "Downloads", boost: 20 },
    { label: "Download settings", boost: 0 },
  ];
  assert.deepEqual(
    rankSearchItems("downloads", items, 2).map(item => item.label),
    ["Downloads", "Open downloads"]
  );
});

test("searches detail and keyword fields", () => {
  const items = [
    { label: "Preferences", detail: "Privacy controls", keywords: ["clear browsing data"] },
    { label: "Personal", detail: "Workspace" },
  ];
  assert.equal(rankSearchItems("clear data", items)[0].label, "Preferences");
});
