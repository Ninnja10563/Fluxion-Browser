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
