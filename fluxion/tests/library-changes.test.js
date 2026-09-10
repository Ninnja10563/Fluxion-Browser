"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Changes = require("../chrome/core/library-changes.js");

test("native visits and title changes affect history without refreshing downloads", () => {
  assert.deepEqual(Changes.affected([{ type: "page-visited" }, { type: "page-title-changed" }]),
    { history: true, bookmarks: false, folders: false });
});

test("bookmark mutation batches invalidate folder hierarchy and bookmark results together", () => {
  for (const type of Changes.TYPES.filter(type => type.startsWith("bookmark-"))) {
    assert.deepEqual(Changes.affected([{ type }]), { history: false, bookmarks: true, folders: true }, type);
  }
});

test("history deletion and database cache purges invalidate their real consumers", () => {
  for (const type of ["page-removed", "history-cleared"]) {
    assert.equal(Changes.affected([{ type }]).history, true);
  }
  assert.deepEqual(Changes.affected([{ type: "purge-caches" }]), { history: true, bookmarks: true, folders: true });
});

test("unknown and empty events do not trigger library queries", () => {
  assert.deepEqual(Changes.affected([null, {}, { type: "favicon-changed" }, { type: "page-spoofed" }]),
    { history: false, bookmarks: false, folders: false });
  assert.deepEqual(Changes.affected([]), { history: false, bookmarks: false, folders: false });
});
