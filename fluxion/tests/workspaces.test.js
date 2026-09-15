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
  sanitiseTheme,
  updateWorkspace,
} = require("../chrome/core/workspaces.js");

const SAVED_WORKSPACES = Object.freeze([
  { id: "focus", name: "Focus", accent: "slate", icon: "circle" },
  { id: "build", name: "Build", accent: "blue", icon: "diamond" },
  { id: "life", name: "Life", accent: "ochre", icon: "arc" },
]);

test("falls back to independent default workspace records", () => {
  const first = parseWorkspaces("not json");
  const second = parseWorkspaces("[]");
  assert.deepEqual(first, DEFAULTS);
  assert.deepEqual(second, DEFAULTS);
  first[0].name = "Changed";
  assert.equal(second[0].name, "Focus");
});

test("new profiles start with exactly one workspace and keep it through persistence", () => {
  const initial = parseWorkspaces("");
  assert.deepEqual(initial, [{ id: "focus", name: "Focus", accent: "slate", icon: "circle" }]);
  assert.deepEqual(parseWorkspaces(JSON.stringify(initial)), initial);
  assert.equal(removeWorkspace(initial, "focus"), null);
  assert.equal(nextWorkspaceId(initial, "focus", 1), "focus");
  assert.equal(nextWorkspaceId(initial, "focus", -1), "focus");
});

test("a new default does not delete, reorder, rename, or remap existing workspaces", () => {
  const saved = [
    { id: "life", name: "Home", accent: "rose", icon: "grid" },
    { id: "build", name: "Client work", accent: "sage", icon: "square" },
    { id: "focus", name: "Research", accent: "blue", icon: "diamond" },
    { id: "reading", name: "Reading", accent: "slate", icon: "arc" },
  ];
  const restored = parseWorkspaces(JSON.stringify(saved));
  assert.deepEqual(restored, saved);
  assert.deepEqual(parseWorkspaces(JSON.stringify(restored)), saved);
  const savedTabWorkspaces = ["build", "life", "reading", "focus", "build"];
  assert.deepEqual(savedTabWorkspaces.filter(id => restored.some(item => item.id === id)), savedTabWorkspaces);
});

test("legacy records without icons retain their old symbols without recreating missing workspaces", () => {
  const legacy = SAVED_WORKSPACES.map(({ icon: _icon, ...workspace }) => workspace);
  assert.deepEqual(parseWorkspaces(JSON.stringify(legacy)), SAVED_WORKSPACES);
  assert.deepEqual(parseWorkspaces(JSON.stringify([legacy[1]])), [SAVED_WORKSPACES[1]]);
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
  const updated = updateWorkspace(SAVED_WORKSPACES, "build", { accent: "sage", icon: "square" });
  assert.equal(updated[1].accent, "sage");
  assert.equal(updated[1].icon, "square");
  const ignored = updateWorkspace(updated, "build", { accent: "neon", icon: "emoji" });
  assert.equal(ignored[1].accent, "sage");
  assert.equal(ignored[1].icon, "square");
  assert.equal(updateWorkspace(SAVED_WORKSPACES, "build", { name: "   " }), null);
});

test("reorders one position at a time without wrapping", () => {
  assert.deepEqual(
    moveWorkspace(SAVED_WORKSPACES, "build", -1).map(item => item.id),
    ["build", "focus", "life"],
  );
  assert.deepEqual(
    moveWorkspace(SAVED_WORKSPACES, "focus", -1).map(item => item.id),
    ["focus", "build", "life"],
  );
});

test("workspace deletion always retains an adjacent destination", () => {
  const removed = removeWorkspace(SAVED_WORKSPACES, "build");
  assert.equal(removed.fallbackId, "life");
  assert.deepEqual(removed.items.map(item => item.id), ["focus", "life"]);
  assert.equal(removeWorkspace([DEFAULTS[0]], "focus"), null);
  assert.equal(removeWorkspace(DEFAULTS, "missing"), null);
});

test("a settings-style edit sequence preserves identity and a deterministic migration target", () => {
  const created = createWorkspace(SAVED_WORKSPACES, "Reference Lab", { icon: "square", accent: "sage" });
  const renamed = updateWorkspace(created.items, created.workspace.id, { name: "Reference Desk" });
  const reordered = moveWorkspace(renamed, created.workspace.id, -1);
  const configured = reordered.find(item => item.id === created.workspace.id);
  assert.deepEqual(configured, {
    id: "reference-lab", name: "Reference Desk", icon: "square", accent: "sage",
  });
  const removed = removeWorkspace(reordered, configured.id);
  assert.equal(removed.fallbackId, "life");
  assert.deepEqual(removed.items, SAVED_WORKSPACES);
});

test("optional workspace themes persist only complete six-digit hex pairs with canonical lowercase", () => {
  const theme = { light: "#F8EEDD", dark: "#172A32" };
  const created = createWorkspace(DEFAULTS, "Studio", { theme });
  assert.deepEqual(created.workspace.theme, { light: "#f8eedd", dark: "#172a32" });
  const restored = parseWorkspaces(JSON.stringify(created.items));
  assert.deepEqual(restored, created.items);
  assert.equal(Object.hasOwn(restored[0], "theme"), false, "Existing unthemed workspaces must retain their exact schema");
  theme.light = "#000000";
  assert.equal(created.workspace.theme.light, "#f8eedd", "Caller-owned input must not alias stored theme data");
  assert.deepEqual(sanitiseTheme({ light: "#ABCDEF", dark: "#001122", extra: "ignored" }),
    { light: "#abcdef", dark: "#001122" });
});

test("malformed theme edits reject the entire transaction while corrupt optional persistence preserves workspace identity", () => {
  const saved = [{ ...SAVED_WORKSPACES[1], theme: { light: "#f1f2f3", dark: "#212223" } }];
  for (const theme of [undefined, false, "#123456", [], {}, { light: "#123456" },
    { light: "#fff", dark: "#000000" }, { light: "#123456ff", dark: "#000000" },
    { light: "red", dark: "#000000" }, { light: " #123456", dark: "#000000" },
    { light: "#123456", dark: "var(--page)" }, Object.create({ light: "#123456", dark: "#000000" })]) {
    const before = JSON.stringify(saved);
    assert.equal(updateWorkspace(saved, "build", { name: "Should not apply", theme }), null);
    assert.equal(createWorkspace(saved, "Should not create", { theme }), null);
    assert.equal(JSON.stringify(saved), before);
    const restored = parseWorkspaces(JSON.stringify([{ ...SAVED_WORKSPACES[1], theme }]));
    assert.deepEqual(restored, [SAVED_WORKSPACES[1]], "Invalid optional colors must not remove or rename a saved workspace");
  }
});

test("explicit null resets only that workspace theme; ordinary edits preserve it independently", () => {
  const created = createWorkspace(DEFAULTS, "Studio", { theme: { light: "#faf0e6", dark: "#20252a" } });
  const id = created.workspace.id;
  const updated = updateWorkspace(created.items, id, { name: "Design", icon: "grid", accent: "rose" });
  assert.deepEqual(updated[1].theme, created.workspace.theme);
  const moved = moveWorkspace(updated, id, -1);
  assert.deepEqual(moved[0].theme, created.workspace.theme);
  const removed = removeWorkspace(moved, "focus");
  assert.deepEqual(removed.items[0].theme, created.workspace.theme);
  removed.items[0].theme.dark = "#000000";
  assert.equal(moved[0].theme.dark, "#20252a");
  moved[0].theme.light = "#ffffff";
  assert.equal(updated[1].theme.light, "#faf0e6");
  updated[1].theme.light = "#000000";
  assert.equal(created.workspace.theme.light, "#faf0e6");
  const reset = updateWorkspace(created.items, id, { theme: null });
  assert.equal(Object.hasOwn(reset[1], "theme"), false);
  assert.deepEqual(reset[0], created.items[0]);
  assert.deepEqual(created.workspace.theme, { light: "#faf0e6", dark: "#20252a" });
  assert.equal(Object.hasOwn(createWorkspace(DEFAULTS, "Plain", { theme: null }).workspace, "theme"), false);
});
