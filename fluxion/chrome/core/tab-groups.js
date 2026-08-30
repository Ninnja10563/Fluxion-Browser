/* global globalThis */
(function exposeTabGroupCore(scope) {
  "use strict";

  const GROUP_COLORS = Object.freeze([
    "blue",
    "purple",
    "cyan",
    "orange",
    "yellow",
    "pink",
    "green",
    "gray",
    "red",
  ]);

  function normaliseGroupName(value) {
    return String(value || "").trim().replace(/\s+/g, " ").slice(0, 40);
  }

  function projectTabRows(tabs, workspaceId, adapters = {}) {
    const workspaceOf = adapters.workspaceOf || (tab => tab.workspaceId);
    const groupOf = adapters.groupOf || (tab => tab.group || null);
    const rows = [];
    const groupRows = new Map();

    for (const tab of tabs || []) {
      if (workspaceOf(tab) !== workspaceId) continue;
      const group = groupOf(tab);
      if (!group || tab.pinned) {
        rows.push({ kind: "tab", tab });
        continue;
      }
      let row = groupRows.get(group.id);
      if (!row) {
        row = { kind: "group", group, tabs: [] };
        groupRows.set(group.id, row);
        rows.push(row);
      }
      row.tabs.push(tab);
    }
    return rows;
  }

  function collapsedGroupProjection(tabs, selectedTab, collapsed) {
    const members = Array.isArray(tabs) ? tabs.filter(Boolean) : [];
    if (!collapsed) {
      return Object.freeze({
        activeVisible: members.includes(selectedTab),
        hiddenCount: 0,
        visibleTabs: Object.freeze([...members]),
      });
    }
    const activeTab = members.includes(selectedTab) ? selectedTab : null;
    return Object.freeze({
      activeVisible: Boolean(activeTab),
      hiddenCount: members.length - (activeTab ? 1 : 0),
      visibleTabs: Object.freeze(activeTab ? [activeTab] : []),
    });
  }

  const api = Object.freeze({
    GROUP_COLORS,
    collapsedGroupProjection,
    normaliseGroupName,
    projectTabRows,
  });
  scope.FluxionTabGroups = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis === "object" ? globalThis : this);
