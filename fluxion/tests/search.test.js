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

test("bounded ranking matches a full-sort reference across large corpora, limits, fallbacks and mutations", () => {
  function reference(query, items, limit) {
    const records = items.map((item, index) => ({ item, index, fallback: item.fallback === true,
      score: Math.max(...[item.label, item.detail, ...(item.keywords || [])].map(field => fuzzyScore(query, field))) + Number(item.boost || 0),
    })).filter(record => Number.isFinite(record.score));
    const strongest = Math.max(-Infinity, ...records.filter(record => !record.fallback).map(record => record.score));
    return records.filter(record => record.fallback || strongest < 650 || record.score >= 400)
      .sort((a, b) => Number(a.fallback) - Number(b.fallback) || b.score - a.score || a.index - b.index)
      .slice(0, Math.floor(Math.max(0, Math.min(Number(limit) || 0, 100)))).map(record => record.item);
  }
  const items = Array.from({ length: 1200 }, (_, index) => ({
    label: ["Résumé", "Research", "Read this", "Restore window", "New tab", "📚 reading"][index % 6],
    detail: `https://example.test/${index % 51}`, keywords: index % 9 ? [] : ["saved tabs"],
    boost: index % 19 === 0 ? Infinity : index % 37 - 18, fallback: index % 13 === 0,
  }));
  for (const query of ["re", "resume", "rdth", "saved tabs", "📚", "", "missing"]) {
    for (const limit of [0, 1, 12, 100, 101, -1, NaN, 3.8]) {
      assert.deepEqual(rankSearchItems(query, items, limit), reference(query, items, limit));
    }
  }
  items[3].label = "Changed title";
  items[3].keywords.push("modified");
  assert.deepEqual(rankSearchItems("modified", items), reference("modified", items, 12));
});

test("late strong matches leave fallback slots available after low-confidence real matches are removed", () => {
  const fallback = { label: "Search", keywords: ["rd"], fallback: true };
  const strong = { label: "rd" };
  const items = [fallback, ...Array.from({ length: 50 }, () => ({ label: "Read" })), strong];
  assert.deepEqual(rankSearchItems("rd", items, 12), [strong, fallback]);
});
