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
