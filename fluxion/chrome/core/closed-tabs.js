/* global globalThis */
(function exposeClosedTabsCore(scope) {
  "use strict";

  function cleanText(value, fallback = "") {
    const text = String(value ?? "").replace(/\s+/g, " ").trim();
    return (text || fallback).slice(0, 160);
  }

  function activeEntry(record) {
    const entries = Array.isArray(record?.state?.entries) ? record.state.entries : [];
    if (!entries.length) return null;
    const requested = Number(record?.state?.index);
    const index = Number.isInteger(requested)
      ? Math.min(Math.max(requested - 1, 0), entries.length - 1)
      : entries.length - 1;
    return entries[index] || null;
  }

  function safeDisplayURL(value) {
    const raw = String(value ?? "").slice(0, 4096);
    try {
      const parsed = new URL(raw);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        parsed.username = "";
        parsed.password = "";
      }
      return parsed.href.slice(0, 2048);
    } catch {
      return raw.slice(0, 2048);
    }
  }

  function projectClosedTabs(records, limit = 12) {
    if (!Array.isArray(records)) return [];
    const cap = Math.max(0, Math.min(Number(limit) || 0, 25));
    const rows = [];
    for (let sourceIndex = 0; sourceIndex < records.length && rows.length < cap; sourceIndex += 1) {
      const record = records[sourceIndex];
      const entry = activeEntry(record);
      const url = safeDisplayURL(entry?.url);
      const title = cleanText(record?.title || entry?.title, url || "Closed tab");
      rows.push(Object.freeze({
        sourceIndex,
        title,
        url,
        closedAt: Number(record?.closedAt) || 0,
      }));
    }
    return rows;
  }

  const api = Object.freeze({ activeEntry, projectClosedTabs, safeDisplayURL });
  scope.FluxionClosedTabs = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis === "object" ? globalThis : this);
