/* global globalThis */
(function exposeMemoryGrounding(scope) {
  "use strict";

  function normalise(value) {
    return String(value || "").toLocaleLowerCase().replace(/\s+/g, " ").trim();
  }

  function clean(value, limit = 220) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
  }

  function queryTokens(query) {
    return [...new Set(normalise(query).split(/[^\p{L}\p{N}]+/u).filter(token => token.length > 1))];
  }

  function excerpt(query, row, limit = 190) {
    const source = clean(row.content || row.description || row.headings || "", 12000);
    if (!source) return "";
    const lower = source.toLocaleLowerCase();
    const phrase = normalise(query);
    let index = phrase ? lower.indexOf(phrase) : -1;
    if (index < 0) {
      index = queryTokens(query).map(token => lower.indexOf(token))
        .filter(position => position >= 0).sort((a, b) => a - b)[0] ?? 0;
    }
    const start = Math.max(0, index - Math.floor(limit * 0.28));
    const value = source.slice(start, start + limit).trim();
    return `${start > 0 ? "…" : ""}${value}${start + limit < source.length ? "…" : ""}`;
  }

  function reasons(query, row) {
    const needle = normalise(query);
    const tokens = queryTokens(query);
    const fields = {
      title: normalise(row.title),
      address: normalise(row.url),
      heading: normalise(row.headings),
      page: normalise(`${row.description || ""} ${row.content || ""}`),
    };
    const matches = [];
    for (const [name, text] of Object.entries(fields)) {
      if (needle && text.includes(needle)) matches.push(`Exact ${name} match`);
      else if (tokens.length && tokens.every(token => text.includes(token))) matches.push(`${name[0].toUpperCase()}${name.slice(1)} words match`);
    }
    if (!matches.length && Number.isFinite(Number(row.distance))) matches.push("Similar page meaning");
    if (row.workspaceName || row.workspace) {
      matches.push(`Workspace: ${clean(row.workspaceName || row.workspace, 40)}`);
    }
    if (row.group) matches.push(`Group: ${clean(row.group, 50)}`);
    return matches.slice(0, 3);
  }

  function relativeVisit(timestamp, now = Date.now()) {
    const value = Number(timestamp || 0);
    if (!value) return "Visited previously";
    const days = Math.max(0, Math.floor((now - value) / 86400000));
    if (days === 0) return "Visited today";
    if (days === 1) return "Visited yesterday";
    if (days < 14) return `Visited ${days} days ago`;
    if (days < 60) return `Visited ${Math.floor(days / 7)} weeks ago`;
    return `Visited ${Math.floor(days / 30)} months ago`;
  }

  function domain(url) {
    try { return new URL(url).hostname.replace(/^www\./, ""); }
    catch (_) { return "Saved history"; }
  }

  function ground(query, rows, options = {}) {
    const evidence = (rows || []).filter(row => row?.url).slice(0, 5).map(row => ({
      ...row,
      excerpt: excerpt(query, row),
      reasons: reasons(query, row),
      visitLabel: relativeVisit(row.lastVisit, options.now),
      domain: domain(row.url),
    }));
    if (!evidence.length) {
      return {
        state: "none",
        text: "Nothing relevant was found in Browser Memory.",
        evidence: [],
      };
    }
    const best = evidence[0];
    const title = clean(best.title || best.domain || best.url, 140);
    return {
      state: "grounded",
      text: `Best match from your history: “${title}”.`,
      sourceURL: best.url,
      evidence,
    };
  }

  const api = Object.freeze({ excerpt, ground, reasons, relativeVisit });
  scope.FluxionMemoryGrounding = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis === "object" ? globalThis : this);
