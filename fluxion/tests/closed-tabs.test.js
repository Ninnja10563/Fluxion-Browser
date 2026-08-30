"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  activeEntry,
  projectClosedTabs,
  safeDisplayURL,
} = require("../chrome/core/closed-tabs.js");

function record(title, urls, index = urls.length, closedAt = 0) {
  return {
    title,
    closedAt,
    state: { index, entries: urls.map(url => ({ url })) },
  };
}

test("projects the active navigation entry without losing SessionStore indices", () => {
  const rows = projectClosedTabs([
    record("Documentation", ["https://example.com/old", "https://example.com/current"], 2, 12),
    record("Reference", ["https://example.org/"]),
  ]);
  assert.deepEqual(rows, [
    { sourceIndex: 0, title: "Documentation", url: "https://example.com/current", closedAt: 12 },
    { sourceIndex: 1, title: "Reference", url: "https://example.org/", closedAt: 0 },
  ]);
});

test("bounds menu data and normalises malformed state safely", () => {
  const records = Array.from({ length: 40 }, (_, index) => ({
    title: `  Closed   page ${index}  `,
    state: { entries: [{ url: `about:blank?${index}` }], index: 99 },
  }));
  const rows = projectClosedTabs(records, 8);
  assert.equal(rows.length, 8);
  assert.equal(rows[0].title, "Closed page 0");
  assert.equal(rows[7].sourceIndex, 7);
  assert.equal(activeEntry({ state: { entries: [] } }), null);
  assert.deepEqual(projectClosedTabs(null), []);
});

test("display URLs never retain embedded HTTP credentials", () => {
  assert.equal(
    safeDisplayURL("https://person:secret@example.com/private?q=1"),
    "https://example.com/private?q=1",
  );
});
