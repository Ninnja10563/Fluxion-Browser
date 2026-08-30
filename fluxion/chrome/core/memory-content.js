/* global globalThis */
(function exposeMemoryContent(scope) {
  "use strict";

  const MAX_TITLE = 300;
  const MAX_HEADINGS = 1600;
  const MAX_TEXT = 12000;

  function clean(value, limit) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
  }

  function normalisePage(page) {
    const headings = Array.isArray(page?.headings)
      ? page.headings
      : String(page?.headings || "").split(" · ");
    return {
      url: clean(page?.url, 4096),
      title: clean(page?.title, MAX_TITLE),
      description: clean(page?.description, 1000),
      headings: clean([...new Set(headings.map(value => clean(value, 240)).filter(Boolean))].join(" · "), MAX_HEADINGS),
      text: clean(page?.text, MAX_TEXT),
      language: clean(page?.language, 32),
      hasPasswordField: page?.hasPasswordField === true,
      isPrivate: page?.isPrivate === true,
    };
  }

  function embeddingText(page) {
    const value = normalisePage(page);
    return clean([value.title, value.description, value.headings, value.text].filter(Boolean).join("\n"), MAX_TEXT);
  }

  const api = Object.freeze({ embeddingText, normalisePage });
  scope.FluxionMemoryContent = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis === "object" ? globalThis : this);
