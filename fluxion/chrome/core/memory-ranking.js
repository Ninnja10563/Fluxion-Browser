/* global globalThis */
(function exposeMemoryRanking(scope) {
  "use strict";

  function normalise(value) {
    return String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase()
      .trim()
      .replace(/\s+/g, " ");
  }

  function lexicalStrength(query, row) {
    const needle = normalise(query);
    if (!needle) return 0;
    const title = normalise(row.title);
    const url = normalise(row.url);
    if (title === needle || url === needle) return 8;
    if (title.startsWith(needle) || url.includes(needle)) return 5;
    const tokens = needle.split(" ");
    if (tokens.every(token => title.includes(token) || url.includes(token))) return 3;
    return 0;
  }

  function mergeMemoryResults(query, keywordRows, semanticRows, options = {}) {
    const now = Number(options.now) || Date.now();
    const currentWorkspace = options.currentWorkspace || "";
    const records = new Map();
    const getRecord = row => {
      const key = String(row.url || "");
      if (!records.has(key)) records.set(key, { row: { ...row }, score: 0 });
      const record = records.get(key);
      record.row = { ...record.row, ...row };
      return record;
    };

    (keywordRows || []).forEach((row, index) => {
      const record = getRecord(row);
      record.score += 2.2 / (12 + index);
      record.score += lexicalStrength(query, row);
    });
    (semanticRows || []).forEach((row, index) => {
      const record = getRecord(row);
      const similarity = Math.max(0, 1 - Number(row.distance ?? 1));
      record.score += 1.5 / (12 + index) + similarity * 2.6;
    });

    for (const record of records.values()) {
      record.score += lexicalStrength(query, record.row);
      const lastVisit = Number(record.row.lastVisit || 0);
      if (lastVisit > 0) {
        const ageDays = Math.max(0, now - lastVisit) / 86400000;
        record.score += 0.65 / (1 + ageDays / 14);
      }
      record.score += Math.min(0.45, Math.log2(1 + Number(record.row.visitCount || 0)) * 0.08);
      if (currentWorkspace && record.row.workspace === currentWorkspace) record.score += 0.3;
    }

    return [...records.values()]
      .sort((left, right) => right.score - left.score ||
        Number(right.row.lastVisit || 0) - Number(left.row.lastVisit || 0))
      .slice(0, Math.max(0, Math.min(Number(options.limit) || 12, 100)))
      .map(record => ({ ...record.row, memoryScore: record.score }));
  }

  const api = Object.freeze({ lexicalStrength, mergeMemoryResults });
  scope.FluxionMemoryRanking = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis === "object" ? globalThis : this);
