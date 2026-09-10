"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { mergeMemoryResults } = require("../chrome/core/memory-ranking.js");

test("exact keyword evidence beats a weaker semantic neighbour", () => {
  const results = mergeMemoryResults(
    "godot timer",
    [{ url: "https://docs.godotengine.org/timer", title: "Godot Timer" }],
    [{ url: "https://example.com/game-loop", title: "Growing plants in a game", distance: 0.08 }],
  );
  assert.equal(results[0].url, "https://docs.godotengine.org/timer");
});

test("semantic-only results remain discoverable and duplicates merge", () => {
  const results = mergeMemoryResults(
    "small local language models",
    [{ url: "https://example.com/llm", title: "Edge inference", visitCount: 2 }],
    [
      { url: "https://example.com/llm", title: "Edge inference", distance: 0.12 },
      { url: "https://example.com/gpu", title: "Graphics cards", distance: 0.4 },
    ],
  );
  assert.equal(results.length, 2);
  assert.equal(results[0].url, "https://example.com/llm");
});

test("recency, frequency, and workspace relevance break close rankings", () => {
  const now = Date.UTC(2026, 7, 27);
  const results = mergeMemoryResults("article", [], [
    { url: "https://old.example/article", title: "An article", distance: 0.2, lastVisit: now - 120 * 86400000 },
    { url: "https://new.example/article", title: "An article", distance: 0.2, lastVisit: now - 86400000, visitCount: 8, workspace: "build" },
  ], { now, currentWorkspace: "build" });
  assert.equal(results[0].url, "https://new.example/article");
});

test("exact body and heading evidence outrank unrelated semantic results", () => {
  const results = mergeMemoryResults("websocket authentication", [{
    url: "https://docs.example/realtime",
    title: "Realtime guide",
    headings: "WebSocket authentication",
    content: "Authenticate a socket with a short-lived token.",
  }], [{
    url: "https://example.com/networking",
    title: "General networking",
    distance: 0.04,
  }]);
  assert.equal(results[0].url, "https://docs.example/realtime");
});

test("an exact title outranks a popular prefix duplicated across every retrieval source", () => {
  const now = Date.UTC(2026, 8, 11);
  const exact = { url: "https://exact.example/", title: "Godot timer", lastVisit: 1 };
  const prefix = { url: "https://prefix.example/", title: "Godot timer examples", lastVisit: now, visitCount: 100000, workspace: "dev" };
  const results = mergeMemoryResults("godot timer", [exact, prefix, prefix], [
    { ...prefix, distance: 0 }, { ...prefix, distance: 0 },
  ], { now, currentWorkspace: "dev" });
  assert.equal(results[0].url, exact.url);
  assert.equal(results.length, 2);
});

test("duplicate source counts and source order do not change scores or ranking", () => {
  const query = "websocket authentication", now = Date.UTC(2026, 8, 11);
  const lexical = [
    { url: "https://a.example/", title: "Websocket guide", content: "Authentication examples" },
    { url: "https://b.example/", title: "Network reference", headings: "Websocket authentication" },
  ];
  const semantic = [{ ...lexical[0], distance: 0.15 }, { ...lexical[1], distance: 0.4 }];
  const baseline = mergeMemoryResults(query, lexical, semantic, { now });
  assert.deepEqual(mergeMemoryResults(query, [...lexical, ...lexical, ...lexical].reverse(),
    [...semantic, ...semantic, ...semantic].reverse(), { now }), baseline);
});

test("multiple vector stores contribute their strongest finite similarity once", () => {
  const rows = [
    { url: "https://a.example/", title: "Edge inference", distance: 0.1 },
    { url: "https://a.example/", title: "Edge inference", distance: 0.6 },
  ];
  const strongest = mergeMemoryResults("small language models", [], [rows[0]]);
  assert.deepEqual(mergeMemoryResults("small language models", [], rows), strongest);
  assert.deepEqual(mergeMemoryResults("small language models", [], rows.toReversed()), strongest);
  for (const distance of [undefined, null, NaN, Infinity]) {
    const result = mergeMemoryResults("query", [], [{ url: "https://invalid.example/", title: "Other", distance }]);
    assert.equal(result[0].memoryScore, 0);
    assert.equal("distance" in result[0], false);
  }
  const bounded = mergeMemoryResults("query", [], [{ url: "https://bounded.example/", title: "Other", distance: -100 }]);
  assert.equal(bounded[0].memoryScore, 2.6);
});

test("lexical placeholder distances do not claim semantic evidence", () => {
  const results = mergeMemoryResults("websocket authentication", [
    { url: "https://docs.example/", title: "Websocket", content: "Authentication guide", distance: 0 },
  ], []);
  assert.equal("distance" in results[0], false);
});

test("equal evidence ties have stable URL order rather than source arrival order", () => {
  const a = { url: "https://a.example/", title: "Reference" };
  const b = { url: "https://b.example/", title: "Reference" };
  assert.deepEqual(mergeMemoryResults("reference", [b, a], []), mergeMemoryResults("reference", [a, b], []));
});
