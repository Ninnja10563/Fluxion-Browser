const test = require("node:test");
const assert = require("node:assert/strict");
const { embeddingText, normalisePage } = require("../chrome/core/memory-content.js");
const { canIndexPage } = require("../chrome/core/memory-policy.js");

test("page evidence is bounded, deduplicated, and free of layout whitespace", () => {
  const page = normalisePage({
    url: "https://example.com/guide",
    title: "  A   useful guide ",
    headings: ["Overview", "Overview", " Details\n here "],
    text: `Useful body ${"x".repeat(14000)}`,
  });
  assert.equal(page.title, "A useful guide");
  assert.equal(page.headings, "Overview · Details here");
  assert.equal(page.text.length, 12000);
  assert.ok(embeddingText(page).startsWith("A useful guide Overview"));
  assert.ok(embeddingText(page).length <= 12000);
});

test("private, password-bearing, sensitive, and excluded pages never index", () => {
  assert.equal(canIndexPage({ url: "https://example.com/article" }), true);
  assert.equal(canIndexPage({ url: "https://example.com/article", isPrivate: true }), false);
  assert.equal(canIndexPage({ url: "https://example.com/article", hasPasswordField: true }), false);
  assert.equal(canIndexPage({ url: "https://example.com/checkout" }), false);
  assert.equal(canIndexPage({ url: "https://notes.example.com/page" }, ["example.com"]), false);
});
