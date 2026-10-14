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

  const FOLDERS_WINDOW_KEY = "fluxion-workspace-folders";
  const MAX_FOLDERS = 100;

  function normaliseFolders(value) {
    try { if (typeof value === "string") value = JSON.parse(value); } catch (_) { return []; }
    if (!Array.isArray(value)) return [];
    const ids = new Set();
    return value.slice(0, MAX_FOLDERS).flatMap(folder => {
      if (!folder || typeof folder.id !== "string" || !folder.id || folder.id.length > 128 ||
          typeof folder.workspaceId !== "string" || !folder.workspaceId || folder.workspaceId.length > 128 ||
          typeof folder.label !== "string" || !normaliseGroupName(folder.label) || ids.has(folder.id)) return [];
      ids.add(folder.id);
      return [{ id: folder.id, workspaceId: folder.workspaceId, label: normaliseGroupName(folder.label),
        collapsed: folder.collapsed === true,
        groupId: typeof folder.groupId === "string" ? folder.groupId.slice(0, 128) : "" }];
    });
  }

  function synchroniseFolders(records, groups, workspaceOf, makeId) {
    const folders = normaliseFolders(records);
    for (const group of groups) {
      const tabs = Array.from(group.tabs || []).filter(tab => !tab.closing);
      if (!tabs.length || !group.id) continue;
      const workspaceId = workspaceOf(tabs[0]);
      // A transient cross-workspace group must never pull another space's tabs in.
      if (!workspaceId || tabs.some(tab => workspaceOf(tab) !== workspaceId)) continue;
      let folder = folders.find(item => item.groupId === group.id);
      if (!folder) {
        if (folders.length >= MAX_FOLDERS) continue;
        folder = { id: makeId(), groupId: group.id };
        folders.push(folder);
      }
      Object.assign(folder, { workspaceId, label: normaliseGroupName(group.label) || "Folder",
        collapsed: Boolean(group.collapsed) });
    }
    // Reflect native group reordering while preserving the slots occupied by
    // empty folders (which deliberately have no native tab-group node).
    const nativeOrder = new Map(groups.map((group, index) => [group.id, index]));
    for (const workspaceId of new Set(folders.map(folder => folder.workspaceId))) {
      const ordered = folders.filter(folder => folder.workspaceId === workspaceId && nativeOrder.has(folder.groupId))
        .sort((a, b) => nativeOrder.get(a.groupId) - nativeOrder.get(b.groupId));
      let index = 0;
      for (let slot = 0; slot < folders.length; slot++) {
        if (folders[slot].workspaceId === workspaceId && nativeOrder.has(folders[slot].groupId)) folders[slot] = ordered[index++];
      }
    }
    return folders;
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
      let row = groupRows.get(group);
      if (!row) {
        row = { kind: "group", group, tabs: [] };
        groupRows.set(group, row);
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
    FOLDERS_WINDOW_KEY,
    MAX_FOLDERS,
    normaliseFolders,
    synchroniseFolders,
    collapsedGroupProjection,
    normaliseGroupName,
    projectTabRows,
  });
  scope.FluxionTabGroups = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis === "object" ? globalThis : this);
