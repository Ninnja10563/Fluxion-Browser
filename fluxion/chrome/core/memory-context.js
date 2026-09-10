/* global globalThis */
(function exposeMemoryContext(scope) {
  "use strict";
  const clean = value => String(value || "").replace(/\s+/g, " ").trim().slice(0, 120);
  function saved(row) {
    if (row.savedContext) return row.savedContext;
    if (!row.workspace && !row.group && !row.savedWorkspaceName) return null;
    return { workspaceId: row.workspace || "", workspaceName: clean(row.savedWorkspaceName),
      groupName: clean(row.group), indexedAt: Number(row.indexedAt || 0) };
  }
  function openContexts(contexts) {
    const unique = new Map();
    for (const item of contexts || []) {
      const context = { workspaceId: String(item.workspaceId || ""), workspaceName: clean(item.workspaceName), groupName: clean(item.groupName) };
      const key = JSON.stringify([context.workspaceId, context.workspaceName, context.groupName]);
      unique.set(key, context);
    }
    return [...unique.values()].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  function annotate(row, contexts) {
    const result = { ...row, openContexts: openContexts(contexts) };
    const context = saved(row);
    if (context) result.savedContext = context;
    return result;
  }
  function labels(row) {
    const result = [], context = saved(row);
    if (context?.workspaceName) result.push(`Saved in ${context.workspaceName}`);
    else if (context?.workspaceId) result.push("Saved workspace name not recorded");
    if (context?.groupName) result.push(`Saved group: ${context.groupName}`);
    const current = openContexts(row.openContexts);
    for (const item of current.slice(0, 3)) {
      result.push(`Open here in ${item.workspaceName || "unnamed workspace"}${item.groupName ? ` / ${item.groupName}` : ""}`);
    }
    if (current.length > 3) result.push(`Open here in ${current.length - 3} more contexts`);
    return result;
  }
  function relevance(row, currentWorkspace) {
    if (!currentWorkspace) return 0;
    if (saved(row)?.workspaceId === currentWorkspace) return 0.3;
    return (row.openContexts || []).some(item => item.workspaceId === currentWorkspace) ? 0.15 : 0;
  }
  const api = Object.freeze({ saved, openContexts, annotate, labels, relevance });
  scope.FluxionMemoryContext = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis === "object" ? globalThis : this);
