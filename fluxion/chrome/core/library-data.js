/* global globalThis */
(function exposeLibraryData(scope) {
  "use strict";

  const SECTIONS = Object.freeze(["history", "bookmarks", "folders", "downloads"]);

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
      parentGuid: clean(record?.parentGuid, 64),
      childCount: Math.max(0, Number(record?.childCount || 0) || 0),
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

  function folderTree(items, rootOrder = []) {
    const folders = (items || []).filter(item => item.kind === "folders");
    const byParent = new Map();
    const byGuid = new Map(folders.map(item => [item.id, item]));
    for (const item of folders) {
      const key = item.parentGuid || "";
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key).push(item);
    }
    const ordered = [];
    const visited = new Set();
    const visit = (item, depth) => {
      if (!item || visited.has(item.id)) return;
      visited.add(item.id);
      ordered.push(Object.freeze({ ...item, depth: Math.min(depth, 8) }));
      const children = [...(byParent.get(item.id) || [])]
        .sort((a, b) => a.title.localeCompare(b.title));
      for (const child of children) visit(child, depth + 1);
    };
    for (const guid of rootOrder) visit(byGuid.get(guid), 0);
    for (const item of folders) {
      if (!byGuid.has(item.parentGuid)) visit(item, 0);
    }
    for (const item of folders) visit(item, 0);
    return ordered;
  }

  function bookmarksInFolder(items, folderGuid) {
    if (!folderGuid || folderGuid === "all") return items || [];
    return (items || []).filter(item => item.parentGuid === folderGuid);
  }

  const api = Object.freeze({
    SECTIONS, bookmarksInFolder, clean, filter, folderTree, matches, normalise, section, tokens,
  });
  scope.FluxionLibraryData = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis === "object" ? globalThis : this);
