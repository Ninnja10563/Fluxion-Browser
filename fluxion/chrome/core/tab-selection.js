/* exported FluxionTabSelection */
(function exposeFluxionTabSelection(scope) {
  "use strict";

  function contextTabs(contextTab, selectedTabs) {
    const selected = Array.isArray(selectedTabs) ? selectedTabs.filter(Boolean) : [];
    const basis = selected.includes(contextTab) && selected.length > 1 ? selected : [contextTab];
    const expanded = [];
    for (const tab of basis) {
      for (const candidate of tab?.splitview?.tabs || [tab]) {
        if (candidate && !expanded.includes(candidate)) expanded.push(candidate);
      }
    }
    return expanded;
  }

  function selectableRange(tabs, anchor, target) {
    const visible = tabs.filter(tab => tab?.visible !== false);
    const first = visible.indexOf(anchor);
    const last = visible.indexOf(target);
    if (first < 0 || last < 0) return target ? [target] : [];
    return visible.slice(Math.min(first, last), Math.max(first, last) + 1);
  }

  scope.FluxionTabSelection = Object.freeze({ contextTabs, selectableRange });
})(typeof globalThis === "object" ? globalThis : this);
