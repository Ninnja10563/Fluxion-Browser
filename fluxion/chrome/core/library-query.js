(function exposeLibraryQuery(scope) {
  "use strict";

  const PAGE_SIZE = 100;
  const ROOTS = Object.freeze({ toolbarGuid: "toolbar_____", menuGuid: "menu________",
    unfiledGuid: "unfiled_____", mobileGuid: "mobile______" });

  function size(value = PAGE_SIZE) {
    return Number.isSafeInteger(value) ? Math.max(1, Math.min(PAGE_SIZE, value)) : PAGE_SIZE;
  }

  function options(input, timestamp, id) {
    const params = { limit: size(input.pageSize) + 1 };
    const conditions = [];
    if (input.cursor != null) {
      const cursor = input.cursor;
      if (!Number.isSafeInteger(cursor.timestamp) || cursor.timestamp < 0 ||
          !Number.isSafeInteger(cursor.id) || cursor.id < 1) throw new TypeError("Invalid Library cursor");
      params.cursorTimestamp = cursor.timestamp;
      params.cursorId = cursor.id;
      conditions.push(`(${timestamp} < :cursorTimestamp OR (${timestamp} = :cursorTimestamp AND ${id} < :cursorId))`);
    }
    const search = String(input.search || "").slice(0, 500).trim().replace(/\s+/gu, " ");
    if (search) params.search = search;
    return { params, conditions, pageSize: size(input.pageSize), search };
  }

  function match(title, fallback, bookmarked, tags = "''") {
    // Firefox 155 SQLFunctions.h: eleven arguments, MATCH_ANYWHERE_UNMODIFIED
    // (4), BEHAVIOR_RESTRICT (256) with membership supplied by our WHERE.
    // Native Unicode matching treats tokens literally, not LIKE/FTS syntax;
    // upstream bounds URL/title/fallback matching to their first 255 bytes.
    return `autocomplete_match(:search, p.url, ${title}, ${tags}, 0, 0, ${bookmarked}, 0, 4, 256, ${fallback})`;
  }

  function history(input = {}) {
    const result = options(input, "p.last_visit_date", "p.id");
    const conditions = ["p.hidden = 0", "p.last_visit_date IS NOT NULL",
      "EXISTS (SELECT 1 FROM moz_historyvisits v WHERE v.place_id = p.id)", ...result.conditions];
    if (result.search) conditions.push(match("COALESCE(p.title, '')", "''", 0));
    return { sql: `SELECT p.id, p.url, COALESCE(NULLIF(p.title, ''), p.url) AS title,
        p.last_visit_date AS cursorTimestamp, p.last_visit_date / 1000 AS visited,
        (SELECT COUNT(*) FROM moz_historyvisits v WHERE v.place_id = p.id) AS visits
      FROM moz_places p WHERE ${conditions.join(" AND ")}
      ORDER BY p.last_visit_date DESC, p.id DESC LIMIT :limit`,
      params: result.params, pageSize: result.pageSize };
  }

  function bookmarks(input = {}) {
    const result = options(input, "b.dateAdded", "b.id");
    const roots = Object.fromEntries(Object.entries(ROOTS).map(([key, fallback]) =>
      [key, typeof input.roots?.[key] === "string" ? input.roots[key] : fallback]));
    const folder = `CASE parent.guid WHEN :toolbarGuid THEN 'Bookmarks Toolbar'
      WHEN :menuGuid THEN 'Bookmarks Menu' WHEN :unfiledGuid THEN 'Other Bookmarks'
      WHEN :mobileGuid THEN 'Mobile Bookmarks'
      ELSE COALESCE(NULLIF(parent.title, ''), 'Bookmarks') END`;
    const conditions = ["b.type = 1", ...result.conditions];
    if (input.folderGuid) {
      conditions.push("parent.guid = :folderGuid");
      result.params.folderGuid = String(input.folderGuid);
    }
    // The native tags field permits each token to match either the displayed
    // folder or page fields, retaining searches such as "research websocket".
    if (result.search) conditions.push(match("COALESCE(b.title, '')", "COALESCE(p.title, '')", 1, folder));
    return { sql: `SELECT b.id, b.guid, COALESCE(NULLIF(b.title, ''), p.url) AS title, p.url,
        b.dateAdded AS cursorTimestamp, b.dateAdded / 1000 AS added, parent.guid AS parentGuid,
        ${folder} AS folder
      FROM moz_bookmarks b JOIN moz_places p ON p.id = b.fk
      LEFT JOIN moz_bookmarks parent ON parent.id = b.parent
      WHERE ${conditions.join(" AND ")}
      ORDER BY b.dateAdded DESC, b.id DESC LIMIT :limit`,
      params: { ...roots, ...result.params }, pageSize: result.pageSize };
  }

  function pageFromRows(rows, pageSize = PAGE_SIZE) {
    const visible = rows.slice(0, size(pageSize));
    const hasMore = rows.length > visible.length;
    const last = visible.at(-1);
    const read = name => typeof last.getResultByName === "function" ? last.getResultByName(name) : last[name];
    return { rows: visible, hasMore,
      cursor: hasMore && last ? { timestamp: read("cursorTimestamp"), id: read("id") } : null };
  }

  const api = Object.freeze({ PAGE_SIZE, history, bookmarks, pageFromRows });
  scope.FluxionLibraryQuery = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis === "object" ? globalThis : this);
