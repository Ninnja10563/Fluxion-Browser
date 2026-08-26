"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createWorkspace,
  DEFAULTS,
  makeWorkspaceId,
  moveWorkspace,
  nextWorkspaceId,
  parseWorkspaces,
  removeWorkspace,
  sanitiseWorkspace,
  updateWorkspace,
} = require("../chrome/core/workspaces.js");

test("falls back to independent default workspace records", () => {
  const first = parseWorkspaces("not json");
  const second = parseWorkspaces("[]");
  assert.deepEqual(first, DEFAULTS);
  assert.deepEqual(second, DEFAULTS);
  first[0].name = "Changed";
  assert.equal(second[0].name, "Focus");
});

test("sanitises persisted workspace data", () => {
  assert.deepEqual(
    sanitiseWorkspace({ id: " Dev!! ", name: "  Development  ", accent: "blue" }, null),
    { id: "dev", name: "Development", accent: "blue", icon: "circle" }
  );
  assert.deepEqual(
    sanitiseWorkspace({ id: "personal", name: "Personal", accent: "neon" }, null),
    { id: "personal", name: "Personal", accent: "slate", icon: "circle" }
  );
});

test("rejects duplicate persisted IDs and caps workspace count", () => {
  const records = Array.from({ length: 15 }, (_, index) => ({
    id: index === 1 ? "space0" : `space${index}`,
    name: `Space ${index}`,
    accent: "sage",
  }));
  const parsed = parseWorkspaces(JSON.stringify(records));
  assert.equal(parsed.length, 11);
  assert.equal(new Set(parsed.map(item => item.id)).size, parsed.length);
});

test("workspace cycling wraps in both directions", () => {
  const spaces = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.equal(nextWorkspaceId(spaces, "c", 1), "a");
  assert.equal(nextWorkspaceId(spaces, "a", -1), "c");
  assert.equal(nextWorkspaceId([], "a", 1), null);
});

test("creates stable unique IDs without changing them on rename", () => {
  assert.equal(makeWorkspaceId("Design Notes", ["design-notes"]), "design-notes-2");
  const created = createWorkspace(DEFAULTS, "  Design   Notes  ", {
    accent: "rose",
    icon: "grid",
  });
  assert.deepEqual(created.workspace, {
    id: "design-notes",
    name: "Design Notes",
    accent: "rose",
    icon: "grid",
  });
  const renamed = updateWorkspace(created.items, created.workspace.id, { name: "Research" });
  assert.equal(renamed.at(-1).id, "design-notes");
  assert.equal(renamed.at(-1).name, "Research");
});

test("updates only supported workspace appearance values", () => {
  const updated = updateWorkspace(DEFAULTS, "build", { accent: "sage", icon: "square" });
  assert.equal(updated[1].accent, "sage");
  assert.equal(updated[1].icon, "square");
  const ignored = updateWorkspace(updated, "build", { accent: "neon", icon: "emoji" });
  assert.equal(ignored[1].accent, "sage");
  assert.equal(ignored[1].icon, "square");
  assert.equal(updateWorkspace(DEFAULTS, "build", { name: "   " }), null);
});

test("reorders one position at a time without wrapping", () => {
  assert.deepEqual(
    moveWorkspace(DEFAULTS, "build", -1).map(item => item.id),
    ["build", "focus", "life"],
  );
  assert.deepEqual(
    moveWorkspace(DEFAULTS, "focus", -1).map(item => item.id),
    ["focus", "build", "life"],
  );
});

test("workspace deletion always retains an adjacent destination", () => {
  const removed = removeWorkspace(DEFAULTS, "build");
  assert.equal(removed.fallbackId, "life");
  assert.deepEqual(removed.items.map(item => item.id), ["focus", "life"]);
  assert.equal(removeWorkspace([DEFAULTS[0]], "focus"), null);
  assert.equal(removeWorkspace(DEFAULTS, "missing"), null);
});
