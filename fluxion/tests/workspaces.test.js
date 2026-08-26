"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DEFAULTS,
  nextWorkspaceId,
  parseWorkspaces,
  sanitiseWorkspace,
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
    { id: "dev", name: "Development", accent: "blue" }
  );
  assert.deepEqual(
    sanitiseWorkspace({ id: "personal", name: "Personal", accent: "neon" }, null),
    { id: "personal", name: "Personal", accent: "slate" }
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
