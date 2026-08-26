/* global globalThis */
(function exposeWorkspaceCore(scope) {
  "use strict";

  const MAX_WORKSPACES = 12;
  const ACCENTS = Object.freeze(["slate", "blue", "ochre", "sage", "rose"]);
  const ICONS = Object.freeze(["circle", "diamond", "square", "arc", "grid"]);
  const DEFAULTS = Object.freeze([
    { id: "focus", name: "Focus", accent: "slate", icon: "circle" },
    { id: "build", name: "Build", accent: "blue", icon: "diamond" },
    { id: "life", name: "Life", accent: "ochre", icon: "arc" },
  ]);

  function sanitiseName(value) {
    return String(value || "").trim().replace(/\s+/g, " ").slice(0, 32);
  }

  function sanitiseWorkspace(value, fallback) {
    if (!value || typeof value !== "object") return fallback;
    const id = String(value.id || "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 32);
    const name = sanitiseName(value.name);
    if (!id || !name) return fallback;
    const accent = ACCENTS.includes(value.accent)
      ? value.accent
      : "slate";
    const inheritedIcon = DEFAULTS.find(item => item.id === id)?.icon;
    const icon = ICONS.includes(value.icon) ? value.icon : inheritedIcon || "circle";
    return { id, name, accent, icon };
  }

  function parseWorkspaces(serialised) {
    try {
      const parsed = JSON.parse(serialised);
      if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULTS.map(item => ({ ...item }));
      const seen = new Set();
      const clean = parsed.slice(0, MAX_WORKSPACES).map((item, index) => {
        const clean = sanitiseWorkspace(item, DEFAULTS[index] || null);
        if (!clean || seen.has(clean.id)) return null;
        seen.add(clean.id);
        return clean;
      }).filter(Boolean);
      return clean.length ? clean : DEFAULTS.map(item => ({ ...item }));
    } catch (_) {
      return DEFAULTS.map(item => ({ ...item }));
    }
  }

  function makeWorkspaceId(name, existingIds = []) {
    const used = new Set(existingIds);
    const stem = sanitiseName(name)
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 26) || "workspace";
    if (!used.has(stem)) return stem;
    for (let suffix = 2; suffix <= MAX_WORKSPACES + 1; suffix += 1) {
      const candidate = `${stem.slice(0, 29 - String(suffix).length)}-${suffix}`;
      if (!used.has(candidate)) return candidate;
    }
    return null;
  }

  function createWorkspace(items, name, options = {}) {
    if (!Array.isArray(items) || items.length >= MAX_WORKSPACES) return null;
    const cleanName = sanitiseName(name);
    if (!cleanName) return null;
    const id = makeWorkspaceId(cleanName, items.map(item => item.id));
    if (!id) return null;
    const workspace = {
      id,
      name: cleanName,
      accent: ACCENTS.includes(options.accent) ? options.accent : ACCENTS[items.length % ACCENTS.length],
      icon: ICONS.includes(options.icon) ? options.icon : ICONS[items.length % ICONS.length],
    };
    return { items: [...items.map(item => ({ ...item })), workspace], workspace };
  }

  function updateWorkspace(items, id, changes = {}) {
    if (!Array.isArray(items) || !items.some(item => item.id === id)) return null;
    const name = changes.name === undefined ? null : sanitiseName(changes.name);
    if (changes.name !== undefined && !name) return null;
    return items.map(item => {
      if (item.id !== id) return { ...item };
      return {
        ...item,
        ...(name ? { name } : {}),
        ...(ACCENTS.includes(changes.accent) ? { accent: changes.accent } : {}),
        ...(ICONS.includes(changes.icon) ? { icon: changes.icon } : {}),
      };
    });
  }

  function moveWorkspace(items, id, direction) {
    if (!Array.isArray(items) || !Number.isInteger(direction) || direction === 0) return null;
    const from = items.findIndex(item => item.id === id);
    const to = Math.max(0, Math.min(items.length - 1, from + Math.sign(direction)));
    if (from < 0) return null;
    const next = items.map(item => ({ ...item }));
    if (from !== to) next.splice(to, 0, next.splice(from, 1)[0]);
    return next;
  }

  function removeWorkspace(items, id) {
    if (!Array.isArray(items) || items.length <= 1) return null;
    const index = items.findIndex(item => item.id === id);
    if (index < 0) return null;
    const next = items.filter(item => item.id !== id).map(item => ({ ...item }));
    const fallback = next[Math.min(index, next.length - 1)];
    return { items: next, fallbackId: fallback.id, removed: { ...items[index] } };
  }

  function nextWorkspaceId(items, currentId, direction = 1) {
    if (!items.length) return null;
    const index = Math.max(0, items.findIndex(item => item.id === currentId));
    return items[(index + direction + items.length) % items.length].id;
  }

  const api = Object.freeze({
    ACCENTS,
    DEFAULTS,
    ICONS,
    MAX_WORKSPACES,
    createWorkspace,
    makeWorkspaceId,
    moveWorkspace,
    nextWorkspaceId,
    parseWorkspaces,
    removeWorkspace,
    sanitiseWorkspace,
    updateWorkspace,
  });
  scope.FluxionWorkspaces = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis === "object" ? globalThis : this);
