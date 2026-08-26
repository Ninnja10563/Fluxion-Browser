/* global globalThis */
(function exposeSplitViewCore(scope) {
  "use strict";

  function splitViewOf(tab) {
    return tab?.splitview || null;
  }

  function canSplit(primary, secondary, adapters = {}) {
    const splitOf = adapters.splitViewOf || splitViewOf;
    return Boolean(
      primary &&
      secondary &&
      primary !== secondary &&
      !primary.pinned &&
      !secondary.pinned &&
      !primary.closing &&
      !secondary.closing &&
      !splitOf(primary) &&
      !splitOf(secondary)
    );
  }

  function projectSplitRows(tabs, adapters = {}) {
    const splitOf = adapters.splitViewOf || splitViewOf;
    const rows = [];
    const seen = new Set();

    for (const tab of tabs || []) {
      const splitView = splitOf(tab);
      if (!splitView) {
        rows.push({ kind: "tab", tab });
        continue;
      }
      if (seen.has(splitView)) continue;
      seen.add(splitView);
      const members = (splitView.tabs || []).filter(candidate =>
        (tabs || []).includes(candidate)
      );
      if (members.length > 1) {
        rows.push({ kind: "split", splitView, tabs: members });
      } else {
        rows.push({ kind: "tab", tab });
      }
    }
    return rows;
  }

  function splitPosition(tab, splitView = splitViewOf(tab)) {
    if (!splitView?.tabs) return 0;
    const index = splitView.tabs.indexOf(tab);
    return index < 0 ? 0 : index + 1;
  }

  const api = Object.freeze({ canSplit, projectSplitRows, splitPosition });
  scope.FluxionSplitViews = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis === "object" ? globalThis : this);
