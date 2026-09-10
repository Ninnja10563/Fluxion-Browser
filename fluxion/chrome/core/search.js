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
    return scoreNormalised(needle, haystack, needle.split(" "));
  }

  function scoreNormalised(needle, haystack, tokens) {
    if (!needle) return 1;
    if (!haystack) return Number.NEGATIVE_INFINITY;
    if (haystack === needle) return 1200;
    if (haystack.startsWith(needle)) return 900 - haystack.length * 0.05;

    const contiguous = haystack.indexOf(needle);
    if (contiguous !== -1) {
      return 700 - contiguous * 3 - (haystack.length - needle.length) * 0.03;
    }

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

  // Weak ownership avoids retaining closed tabs. Compare source fields on every
  // search so title/URL/group changes cannot leave a stale prepared document.
  const preparedItems = new WeakMap();
  function preparedFields(item) {
    const fields = [item.label, item.detail, ...(item.keywords || [])];
    const previous = preparedItems.get(item);
    if (previous && previous.fields.length === fields.length &&
        fields.every((field, index) => field === previous.fields[index] &&
          (field === null || typeof field !== "object"))) return previous.normalised;
    const normalised = fields.map(normaliseSearchText);
    preparedItems.set(item, { fields, normalised });
    return normalised;
  }

  function rankSearchItems(query, items, limit = 12) {
    const safeLimit = Math.floor(Math.max(0, Math.min(Number(limit) || 0, 100)));
    const needle = normaliseSearchText(query), tokens = needle.split(" ");
    let strongestRealMatch = Number.NEGATIVE_INFINITY;
    const records = items
      .map((item, index) => {
        let score = Number.NEGATIVE_INFINITY;
        for (const field of preparedFields(item)) score = Math.max(score, scoreNormalised(needle, field, tokens));
        const record = {
          item,
          index,
          fallback: item.fallback === true,
          score: score + Number(item.boost || 0),
        };
        if (!record.fallback && Number.isFinite(record.score)) strongestRealMatch = Math.max(strongestRealMatch, record.score);
        return record;
      })
      .filter(record => Number.isFinite(record.score));
    const confidenceFloor = strongestRealMatch >= 650 ? 400 : Number.NEGATIVE_INFINITY;
    const compare = (left, right) =>
        Number(left.fallback) - Number(right.fallback) ||
        right.score - left.score ||
        left.index - right.index;
    const best = [];
    for (const record of records) {
      if (!safeLimit || (!record.fallback && record.score < confidenceFloor)) continue;
      if (best.length === safeLimit && compare(record, best[best.length - 1]) >= 0) continue;
      let low = 0, high = best.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (compare(record, best[middle]) < 0) high = middle;
        else low = middle + 1;
      }
      best.splice(low, 0, record);
      if (best.length > safeLimit) best.pop();
    }
    return best.map(record => record.item);
  }

  const api = Object.freeze({ fuzzyScore, normaliseSearchText, rankSearchItems });
  scope.FluxionSearch = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis === "object" ? globalThis : this);
