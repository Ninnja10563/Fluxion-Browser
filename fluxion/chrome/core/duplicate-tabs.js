(function exposeDuplicateTabs(scope) {
  "use strict";

  function validWebURL(value) {
    if (typeof value !== "string" || !/^https?:\/\/[^/?#]+(?:[/?#]|$)/i.test(value) ||
        /[\s\\\u0000-\u001f\u007f]/.test(value) || /%(?![0-9a-f]{2})/i.test(value)) return false;
    try {
      const parsed = new URL(value);
      return Boolean(parsed.hostname) && (parsed.protocol === "http:" || parsed.protocol === "https:");
    } catch (_) { return false; }
  }

  /**
   * Ordered snapshots require {url, containerId, workspaceId, protected}.
   * containerId is a nonnegative safe integer; workspaceId is a nonempty string;
   * protected must be an explicit boolean supplied from current browser state.
   * Other fields (including native tab references) are opaque and untouched.
   * The caller owns snapshot freshness, consent and native close/undo behavior.
   */
  function planDuplicateTabs(records) {
    if (!Array.isArray(records)) return [];
    const workspaces = new Map(), seen = new Set(), ordered = [];
    for (const record of records) {
      if (!record || typeof record !== "object" || Array.isArray(record) || seen.has(record)) continue;
      seen.add(record);
      const { url, containerId, workspaceId, protected: protectedTab } = record;
      if (!validWebURL(url) || !Number.isSafeInteger(containerId) || containerId < 0 ||
          typeof workspaceId !== "string" || !workspaceId.trim() || typeof protectedTab !== "boolean") continue;
      let containers = workspaces.get(workspaceId);
      if (!containers) workspaces.set(workspaceId, containers = new Map());
      let urls = containers.get(containerId);
      if (!urls) containers.set(containerId, urls = new Map());
      // Validate URLs above, but never serialize them. Query ordering, fragments,
      // credentials, explicit ports and escape spelling remain part of identity.
      let group = urls.get(url);
      if (!group) urls.set(url, group = { keeper: record });
      else if (protectedTab && !group.keeper.protected) group.keeper = record;
      ordered.push({ record, group });
    }
    const plan = [];
    for (const { record, group } of ordered) {
      if (!record.protected && record !== group.keeper) plan.push({ target: record, keeper: group.keeper });
    }
    return plan;
  }

  scope.FluxionDuplicateTabsCore = Object.freeze({ planDuplicateTabs });
  if (typeof module !== "undefined" && module.exports) module.exports = scope.FluxionDuplicateTabsCore;
})(typeof globalThis === "object" ? globalThis : this);
