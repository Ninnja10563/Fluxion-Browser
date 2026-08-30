"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { excerpt, ground, reasons, relativeVisit } = require("../chrome/core/memory-grounding.js");

test("grounded answers cite only supplied browser records", () => {
  const now = Date.UTC(2026, 7, 30, 12);
  const answer = ground("local vector database", [{
    url: "https://lancedb.github.io/docs",
    title: "LanceDB Documentation",
    content: "LanceDB is an open-source database for local vector search and multimodal data.",
    workspace: "build",
    workspaceName: "Development",
    lastVisit: now - 86400000,
  }], { now });
  assert.equal(answer.state, "grounded");
  assert.match(answer.text, /LanceDB Documentation/);
  assert.equal(answer.sourceURL, "https://lancedb.github.io/docs");
  assert.match(answer.evidence[0].excerpt, /local vector search/);
  assert.deepEqual(answer.evidence[0].reasons, ["Page words match", "Workspace: Development"]);
  assert.equal(answer.evidence[0].visitLabel, "Visited yesterday");
});

test("insufficient evidence produces no inferred answer", () => {
  const answer = ground("a page that never existed", []);
  assert.deepEqual(answer, {
    state: "none",
    text: "Nothing relevant was found in Browser Memory.",
    evidence: [],
  });
  assert.equal(Object.hasOwn(answer, "sourceURL"), false);
});

test("excerpts are bounded around remembered terms", () => {
  const text = `${"Earlier context. ".repeat(30)}WebSocket authentication uses a signed token.${" Later context.".repeat(30)}`;
  const value = excerpt("websocket authentication", { content: text });
  assert.ok(value.length <= 192);
  assert.match(value, /WebSocket authentication/);
  assert.match(value, /^…/);
  assert.match(value, /…$/);
});

test("evidence reasons distinguish exact fields and semantic-only matches", () => {
  assert.deepEqual(
    reasons("godot timer", { title: "Godot Timer", url: "https://docs.example/timer" }),
    ["Exact title match"],
  );
  assert.deepEqual(
    reasons("plants over time", { title: "Growth guide", distance: 0.12 }),
    ["Similar page meaning"],
  );
  assert.equal(relativeVisit(0), "Visited previously");
});
