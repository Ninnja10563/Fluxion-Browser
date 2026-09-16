/* global globalThis */
(function exposeWorkspaceTabsCore(scope) {
  "use strict";

  const WINDOW_VALUE_KEY = "fluxion-active-workspace";

  function windowWorkspace(workspaces, restoredValue, profileFallback) {
    const ids = new Set((workspaces || []).map(workspace => String(workspace?.id || "")));
    const restored = String(restoredValue || "");
    const fallback = String(profileFallback || "");
    if (ids.has(restored)) return restored;
    if (ids.has(fallback)) return fallback;
    return String(workspaces?.[0]?.id || "");
  }

  function preferredTab(tabs, workspaceId, options = {}) {
    if (!Array.isArray(tabs) || !workspaceId) return null;
    const workspaceOf = options.workspaceOf || (tab => tab?.workspace);
    const isRemembered = options.isRemembered || (tab => Boolean(tab?.remembered));
    const candidates = tabs
      .map((tab, position) => ({ tab, position }))
      .filter(({ tab }) => tab && workspaceOf(tab) === workspaceId && !tab.closing);
    if (candidates.length < 2) return candidates[0]?.tab || null;
    const legacyChoice = () => candidates.sort((left, right) => {
      const remembered = Number(isRemembered(right.tab)) - Number(isRemembered(left.tab));
      if (remembered) return remembered;
      const recent = Number(right.tab.lastAccessed || 0) - Number(left.tab.lastAccessed || 0);
      return recent || left.position - right.position;
    })[0].tab;
    let best = null, bestRemembered = -Infinity, bestRecent = -Infinity;
    for (const { tab } of candidates) {
      let remembered, recent;
      try {
        remembered = Number(isRemembered(tab));
        recent = Number(tab.lastAccessed || 0);
      } catch (_) {
        return legacyChoice();
      }
      // Malformed/nonfinite values make the legacy comparator nontransitive.
      // Retain its exact ordering for those inputs rather than inventing a new
      // recovery policy. Normal Gecko timestamps and markers need only one read
      // per candidate, and equal scores keep the original tab-strip order.
      if (!Number.isFinite(remembered) || !Number.isFinite(recent)) return legacyChoice();
      if (!best || remembered > bestRemembered ||
          (remembered === bestRemembered && recent > bestRecent)) {
        best = tab; bestRemembered = remembered; bestRecent = recent;
      }
    }
    return best;
  }

  function markerPlan(tabs, workspaceId, selected, options = {}) {
    const workspaceOf = options.workspaceOf || (tab => tab?.workspace);
    if (!selected || workspaceOf(selected) !== workspaceId) return Object.freeze([]);
    return Object.freeze((tabs || [])
      .filter(tab => tab && workspaceOf(tab) === workspaceId)
      .map(tab => Object.freeze({ tab, remembered: tab === selected })));
  }

  const api = Object.freeze({ WINDOW_VALUE_KEY, markerPlan, preferredTab, windowWorkspace });
  scope.FluxionWorkspaceTabs = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis === "object" ? globalThis : this);
