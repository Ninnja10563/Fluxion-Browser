/* global globalThis */
(function exposeSplitViewCore(scope) {
  "use strict";

  const SIDE_BY_SIDE = "side-by-side";
  const STACKED = "stacked";
  const ORIENTATIONS = Object.freeze([SIDE_BY_SIDE, STACKED]);

  function normaliseOrientation(value) {
    return ORIENTATIONS.includes(value) ? value : SIDE_BY_SIDE;
  }

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

  function orientationOf(splitView, read = tab =>
    tab?.getAttribute?.("fluxion-split-orientation") || tab?.splitOrientation
  ) {
    for (const tab of splitView?.tabs || []) {
      const value = read(tab);
      if (ORIENTATIONS.includes(value)) return value;
    }
    return SIDE_BY_SIDE;
  }

  function positionLabel(position, orientation = SIDE_BY_SIDE, size = 2) {
    const index = Number(position);
    const count = Number(size);
    if (count === 2 && index === 1) {
      return normaliseOrientation(orientation) === STACKED ? "top" : "left";
    }
    if (count === 2 && index === 2) {
      return normaliseOrientation(orientation) === STACKED ? "bottom" : "right";
    }
    return index > 0 ? `pane ${index} of ${Math.max(index, count || 0)}` : "split pane";
  }

  function parseOrientationMap(raw, limit = 256) {
    let parsed = raw;
    if (typeof raw === "string") {
      try { parsed = JSON.parse(raw); } catch (_) { parsed = {}; }
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return Object.freeze({});
    const entries = Object.entries(parsed)
      .filter(([id, orientation]) => /^\d+$/.test(id) && ORIENTATIONS.includes(orientation))
      .slice(-Math.max(1, Number(limit) || 256));
    return Object.freeze(Object.fromEntries(entries));
  }

  function rememberOrientation(map, splitViewId, orientation, limit = 256) {
    const id = String(splitViewId ?? "");
    if (!/^\d+$/.test(id)) return parseOrientationMap(map, limit);
    const next = { ...parseOrientationMap(map, limit), [id]: normaliseOrientation(orientation) };
    return parseOrientationMap(next, limit);
  }

  function forgetOrientation(map, splitViewId, limit = 256) {
    const next = { ...parseOrientationMap(map, limit) };
    delete next[String(splitViewId ?? "")];
    return parseOrientationMap(next, limit);
  }

  const api = Object.freeze({
    ORIENTATIONS, SIDE_BY_SIDE, STACKED, canSplit, normaliseOrientation,
    forgetOrientation, orientationOf, parseOrientationMap, positionLabel,
    projectSplitRows, rememberOrientation, splitPosition,
  });
  scope.FluxionSplitViews = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis === "object" ? globalThis : this);
