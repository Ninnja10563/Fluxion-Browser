/* global globalThis */
(function exposeMemoryRanking(scope) {
  "use strict";

  const { fold: normalise } = typeof module !== "undefined" && module.exports
    ? require("./memory-search.js") : scope.FluxionMemorySearch;
  const Context = typeof module !== "undefined" && module.exports
    ? require("./memory-context.js") : scope.FluxionMemoryContext;

  function lexicalStrength(query, row) {
    const needle = normalise(query);
    if (!needle) return 0;
    const title = normalise(row.title);
    const url = normalise(row.url);
    const description = normalise(row.description);
    const headings = normalise(row.headings);
    const content = normalise(row.content);
    if (title === needle || url === needle) return 8;
    if (title.startsWith(needle) || url.includes(needle)) return 5;
    if (headings.includes(needle) || description.includes(needle)) return 4.5;
    if (content.includes(needle)) return 3.2;
    const tokens = needle.split(" ");
    const evidence = `${title} ${url} ${description} ${headings} ${content}`;
    if (tokens.every(token => evidence.includes(token))) return 2.4;
    return 0;
  }

  function mergeMemoryResults(query, keywordRows, semanticRows, options = {}) {
    const now = Number(options.now) || Date.now();
    const currentWorkspace = options.currentWorkspace || "";
    const records = new Map();
    const getRecord = row => {
      const key = String(row.url || "");
      if (!records.has(key)) records.set(key, { row: {}, score: 0, lexical: 0, similarity: 0, distance: null });
      const record = records.get(key);
      record.row = { ...record.row, ...row };
      record.lexical = Math.max(record.lexical, lexicalStrength(query, row));
      return record;
    };

    // Sources overlap: Places and enriched lexical queries can return the same
    // URL, as can both vector stores. Source availability must not multiply a
    // page's lexical evidence or let duplicate vectors overpower an exact hit.
    (keywordRows || []).forEach(getRecord);
    (semanticRows || []).forEach(row => {
      const record = getRecord(row);
      const distance = Number(row.distance);
      if (row.distance !== null && row.distance !== undefined && Number.isFinite(distance)) {
        record.similarity = Math.max(record.similarity, Math.max(0, Math.min(1, 1 - distance)));
        record.distance = record.distance === null ? distance : Math.min(record.distance, distance);
      }
    });

    for (const record of records.values()) {
      record.lexical = Math.max(record.lexical, lexicalStrength(query, record.row));
      record.score = record.lexical * 2 + record.similarity * 2.6;
      // A lexical SQL placeholder distance is not semantic provenance.
      if (record.distance === null) delete record.row.distance;
      else record.row.distance = record.distance;
      const lastVisit = Number(record.row.lastVisit || 0);
      if (lastVisit > 0) {
        const ageDays = Math.max(0, now - lastVisit) / 86400000;
        record.score += 0.65 / (1 + ageDays / 14);
      }
      record.score += Math.min(0.45, Math.log2(1 + Number(record.row.visitCount || 0)) * 0.08);
      record.score += Context.relevance(record.row, currentWorkspace);
    }

    return [...records.values()]
      .sort((left, right) => Number(right.lexical === 8) - Number(left.lexical === 8) ||
        right.score - left.score || Number(right.row.lastVisit || 0) - Number(left.row.lastVisit || 0) ||
        String(left.row.url).localeCompare(String(right.row.url)))
      .slice(0, Math.max(0, Math.min(Number(options.limit) || 12, 100)))
      .map(record => ({ ...record.row, memoryScore: record.score }));
  }

  const api = Object.freeze({ lexicalStrength, mergeMemoryResults });
  scope.FluxionMemoryRanking = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis === "object" ? globalThis : this);
