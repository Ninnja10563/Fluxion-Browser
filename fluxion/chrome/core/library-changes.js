(function exposeLibraryChanges(scope) {
  "use strict";

  // Names come from Gecko's PlacesEventType, not page-supplied events.
  const TYPES = Object.freeze([
    "page-visited", "page-title-changed", "history-cleared", "page-removed",
    "bookmark-added", "bookmark-removed", "bookmark-moved", "bookmark-guid-changed",
    "bookmark-keyword-changed", "bookmark-tags-changed", "bookmark-time-changed",
    "bookmark-title-changed", "bookmark-url-changed", "purge-caches",
  ]);
  const known = new Set(TYPES);

  function affected(events) {
    const result = { history: false, bookmarks: false, folders: false };
    for (const event of events || []) {
      const type = event?.type;
      if (!known.has(type)) continue;
      if (type === "purge-caches") return { history: true, bookmarks: true, folders: true };
      if (type.startsWith("bookmark-")) {
        result.bookmarks = true;
        // Parent titles, child counts, and hierarchy feed folder controls.
        result.folders = true;
      } else result.history = true;
    }
    return result;
  }

  const api = Object.freeze({ TYPES, affected });
  scope.FluxionLibraryChanges = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis === "object" ? globalThis : this);
