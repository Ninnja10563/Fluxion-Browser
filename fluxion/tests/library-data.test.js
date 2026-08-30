"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Library = require("../chrome/core/library-data.js");

test("library sections reject unknown internal routes", () => {
  assert.equal(Library.section("bookmarks"), "bookmarks");
  assert.equal(Library.section("unknown"), "history");
});

test("library records are bounded and searchable across useful fields", () => {
  const item = Library.normalise({
    guid: "bookmark-guid", title: "Gecko Architecture", url: "https://example.com/docs",
    folder: "Development References", timestamp: 42,
  }, "bookmarks");
  assert.equal(item.id, "bookmark-guid");
  assert.equal(item.detail, "Development References");
  assert.equal(item.timestamp, 42);
  assert.equal(Library.matches(item, "gecko development"), true);
  assert.equal(Library.matches(item, "chromium"), false);
});

test("library filtering preserves source order and applies a hard cap", () => {
  const items = Array.from({ length: 600 }, (_, index) =>
    Library.normalise({ id: index, title: `Saved page ${index}` }, "history"));
  assert.equal(Library.filter(items, "saved", 900).length, 500);
  assert.deepEqual(Library.filter(items, "page 12", 10).map(item => item.title).slice(0, 2), [
    "Saved page 12", "Saved page 112",
  ]);
});

test("bookmark folder trees preserve roots, nesting, and orphan safety", () => {
  const folder = (id, title, parentGuid) => Library.normalise({ id, title, parentGuid }, "folders");
  const tree = Library.folderTree([
    folder("child", "Child", "root-a"),
    folder("root-b", "Other Root", "places-root"),
    folder("root-a", "Primary Root", "places-root"),
    folder("orphan", "Recovered", "missing"),
  ], ["root-a", "root-b"]);
  assert.deepEqual(tree.map(item => [item.id, item.depth]), [
    ["root-a", 0], ["child", 1], ["root-b", 0], ["orphan", 0],
  ]);
});

test("bookmark folder filters do not duplicate or mutate source records", () => {
  const records = [
    Library.normalise({ id: "one", title: "One", parentGuid: "folder-a" }, "bookmarks"),
    Library.normalise({ id: "two", title: "Two", parentGuid: "folder-b" }, "bookmarks"),
  ];
  assert.deepEqual(Library.bookmarksInFolder(records, "folder-a").map(item => item.id), ["one"]);
  assert.equal(Library.bookmarksInFolder(records, "all"), records);
});
