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

test("generated navigation fallbacks never displace a real matching action", () => {
  const items = [
    { label: "Search the web for zoom", keywords: ["zoom"], fallback: true },
    { label: "Zoom In", detail: "Increase page zoom" },
    { label: "Zoom Out", detail: "Reduce page zoom" },
  ];
  assert.deepEqual(
    rankSearchItems("zoom", items).map(item => item.label),
    ["Zoom In", "Zoom Out", "Search the web for zoom"],
  );
  assert.deepEqual(
    rankSearchItems("unmatched destination", [
      { label: "Search the web", keywords: ["unmatched destination"], fallback: true },
    ]).map(item => item.label),
    ["Search the web"],
  );
});

test("strong matches suppress unrelated subsequences without disabling typo search", () => {
  const items = [
    { label: "Reopen Example Domain" },
    { label: "Open downloads", detail: "View current and completed downloads" },
    { label: "Site permissions", detail: "Review saved decisions" },
    { label: "Search the web", keywords: ["reopen"], fallback: true },
  ];
  assert.deepEqual(
    rankSearchItems("reopen", items).map(item => item.label),
    ["Reopen Example Domain", "Search the web"],
  );
  assert.equal(
    rankSearchItems("opndwlds", [{ label: "Open downloads" }])[0].label,
    "Open downloads",
  );
});
