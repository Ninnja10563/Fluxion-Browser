/* global globalThis */
(function exposeWorkspaceCore(scope) {
  "use strict";

  const DEFAULTS = Object.freeze([
    { id: "focus", name: "Focus", accent: "slate" },
    { id: "build", name: "Build", accent: "blue" },
    { id: "life", name: "Life", accent: "ochre" },
  ]);

  function sanitiseWorkspace(value, fallback) {
    if (!value || typeof value !== "object") return fallback;
    const id = String(value.id || "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 32);
    const name = String(value.name || "").trim().slice(0, 32);
    if (!id || !name) return fallback;
    const accent = ["slate", "blue", "ochre", "sage", "rose"].includes(value.accent)
      ? value.accent
      : "slate";
    return { id, name, accent };
  }

  function parseWorkspaces(serialised) {
    try {
      const parsed = JSON.parse(serialised);
      if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULTS.map(item => ({ ...item }));
      const seen = new Set();
      return parsed.slice(0, 12).map((item, index) => {
        const clean = sanitiseWorkspace(item, DEFAULTS[index] || null);
        if (!clean || seen.has(clean.id)) return null;
        seen.add(clean.id);
        return clean;
      }).filter(Boolean);
    } catch (_) {
      return DEFAULTS.map(item => ({ ...item }));
    }
  }

  function nextWorkspaceId(items, currentId, direction = 1) {
    if (!items.length) return null;
    const index = Math.max(0, items.findIndex(item => item.id === currentId));
    return items[(index + direction + items.length) % items.length].id;
  }

  const api = Object.freeze({ DEFAULTS, sanitiseWorkspace, parseWorkspaces, nextWorkspaceId });
  scope.FluxionWorkspaces = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis === "object" ? globalThis : this);
