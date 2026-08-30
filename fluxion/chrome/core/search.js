/* global globalThis */
(function exposeSearchCore(scope) {
  "use strict";

  function normaliseSearchText(value) {
    return String(value ?? "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase()
      .trim()
      .replace(/\s+/g, " ");
  }

  function fuzzyScore(query, value) {
    const needle = normaliseSearchText(query);
    const haystack = normaliseSearchText(value);
    if (!needle) return 1;
    if (!haystack) return Number.NEGATIVE_INFINITY;
    if (haystack === needle) return 1200;
    if (haystack.startsWith(needle)) return 900 - haystack.length * 0.05;

    const contiguous = haystack.indexOf(needle);
    if (contiguous !== -1) {
      return 700 - contiguous * 3 - (haystack.length - needle.length) * 0.03;
    }

    const tokens = needle.split(" ");
    if (tokens.length > 1 && tokens.every(token => haystack.includes(token))) {
      return 520 - tokens.reduce((total, token) => total + haystack.indexOf(token), 0);
    }

    let cursor = 0;
    let gaps = 0;
    let previous = -1;
    for (const character of needle) {
      const found = haystack.indexOf(character, cursor);
      if (found === -1) return Number.NEGATIVE_INFINITY;
      if (previous !== -1) gaps += found - previous - 1;
      previous = found;
      cursor = found + 1;
    }
    return 280 - gaps * 4 - previous * 0.25;
  }

  function rankSearchItems(query, items, limit = 12) {
    const safeLimit = Math.max(0, Math.min(Number(limit) || 0, 100));
    const records = items
      .map((item, index) => {
        const fields = [item.label, item.detail, ...(item.keywords || [])];
        const score = Math.max(...fields.map(field => fuzzyScore(query, field)));
        return {
          item,
          index,
          fallback: item.fallback === true,
          score: score + Number(item.boost || 0),
        };
      })
      .filter(record => Number.isFinite(record.score));
    const strongestRealMatch = Math.max(
      Number.NEGATIVE_INFINITY,
      ...records.filter(record => !record.fallback).map(record => record.score),
    );
    const confidenceFloor = strongestRealMatch >= 650 ? 400 : Number.NEGATIVE_INFINITY;
    return records
      .filter(record => record.fallback || record.score >= confidenceFloor)
      .sort((left, right) =>
        Number(left.fallback) - Number(right.fallback) ||
        right.score - left.score ||
        left.index - right.index
      )
      .slice(0, safeLimit)
      .map(record => record.item);
  }

  const api = Object.freeze({ fuzzyScore, normaliseSearchText, rankSearchItems });
  scope.FluxionSearch = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis === "object" ? globalThis : this);
