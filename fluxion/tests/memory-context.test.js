"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Context = require("../chrome/core/memory-context.js");
const { mergeMemoryResults } = require("../chrome/core/memory-ranking.js");

test("saved snapshots survive renamed/deleted workspaces independently of current open context", () => {
  const row = { url: "https://example.org/", workspace: "school", savedWorkspaceName: "School",
    group: "Research", indexedAt: 123 };
  const annotated = Context.annotate(row, [{ workspaceId: "dev", workspaceName: "Development", groupName: "Current project" }]);
  assert.equal(annotated.workspace, "school");
  assert.deepEqual(annotated.savedContext, { workspaceId: "school", workspaceName: "School", groupName: "Research", indexedAt: 123 });
  assert.deepEqual(Context.labels(annotated), ["Saved in School", "Saved group: Research", "Open here in Development / Current project"]);
  assert.deepEqual(Context.labels(Context.annotate(row, [])), ["Saved in School", "Saved group: Research"]);
});

test("legacy records never invent their previous name from a live workspace name", () => {
  const row = Context.annotate({ workspace: "legacy", group: "Old group" }, [{ workspaceId: "legacy", workspaceName: "Renamed" }]);
  assert.deepEqual(Context.labels(row), ["Saved workspace name not recorded", "Saved group: Old group", "Open here in Renamed"]);
  assert.equal(row.savedContext.workspaceName, "");
});

test("multiple same-URL open tabs are deterministic and duplicate contexts do not inflate relevance", () => {
  const contexts = [{ workspaceId: "b", workspaceName: "B", groupName: "Two" },
    { workspaceId: "a", workspaceName: "A", groupName: "One" }];
  const row = { url: "https://example.org/", title: "Guide", workspace: "old", savedWorkspaceName: "Past" };
  const a = Context.annotate(row, contexts);
  const b = Context.annotate(row, [...contexts, ...contexts].reverse());
  assert.deepEqual(a, b);
  assert.equal(Context.relevance(a, "a"), 0.15);
  assert.equal(Context.relevance(a, "old"), 0.3);
  assert.equal(Context.relevance(Context.annotate(row, [{ workspaceId: "old" }]), "old"), 0.3);
});

test("native rows without saved context do not erase enriched context during result merge", () => {
  const saved = Context.annotate({ url: "https://example.org/", title: "Guide", workspace: "school", savedWorkspaceName: "School", group: "Research" }, []);
  const native = Context.annotate({ url: saved.url, title: "Guide", distance: 0.1 }, []);
  const result = mergeMemoryResults("guide", [saved], [native])[0];
  assert.equal(result.savedContext.workspaceName, "School");
  assert.equal(result.savedContext.groupName, "Research");
});
