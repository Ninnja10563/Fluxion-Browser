/* global globalThis */
(function exposeLibraryData(scope) {
  "use strict";

  const SECTIONS = Object.freeze(["history", "bookmarks", "downloads"]);

  function section(value) {
    return SECTIONS.includes(value) ? value : "history";
  }

  function clean(value, limit = 500) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
  }

  function normalise(record, kind) {
    const url = clean(record?.url, 4096);
    return Object.freeze({
      id: clean(record?.id ?? record?.guid ?? url, 4096),
      kind: section(kind),
      title: clean(record?.title || record?.filename || url || "Untitled", 300),
      url,
      detail: clean(record?.detail || record?.folder || record?.status, 500),
      timestamp: Number(record?.timestamp || 0) || 0,
      state: clean(record?.state, 40),
      raw: record?.raw,
    });
  }

  function tokens(value) {
    return clean(value, 500).toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  }

  function matches(item, query) {
    const terms = tokens(query);
    if (!terms.length) return true;
    const haystack = `${item.title} ${item.url} ${item.detail}`.toLocaleLowerCase();
    return terms.every(term => haystack.includes(term));
  }

  function filter(items, query, limit = 250) {
    return (items || []).filter(item => matches(item, query)).slice(0, Math.max(1, Math.min(500, limit)));
  }

  const api = Object.freeze({ SECTIONS, clean, filter, matches, normalise, section, tokens });
  scope.FluxionLibraryData = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis === "object" ? globalThis : this);
