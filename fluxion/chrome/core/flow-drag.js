(function exposeFlowDrag(scope) {
  "use strict";
  const attached = value => Boolean(value?.parentNode) && value.isConnected !== false && !value.closing;

  function validator({ allTabs, workspaceId, workspaceOf }) {
    if (!workspaceId || typeof workspaceOf !== "function") return null;
    const ordered = Array.from(allTabs || []), local = new Set(ordered);
    if (!ordered.length || ordered.length !== local.size) return null;
    const tab = value => local.has(value) && attached(value) && !value.pinned && workspaceOf(value) === workspaceId;
    const members = (wrapper, property) => {
      if (!attached(wrapper)) return null;
      const list = Array.from(wrapper.tabs || []);
      if (!list.length || new Set(list).size !== list.length ||
          !list.every(value => tab(value) && value[property] === wrapper)) return null;
      return list;
    };
    const split = wrapper => {
      const list = members(wrapper, "splitview");
      if (!list || list.length < 2 || list.some(value => value.group !== list[0].group)) return null;
      if ((wrapper.group || null) !== (list[0].group || null)) return null;
      return list;
    };
    const group = wrapper => {
      const list = members(wrapper, "group");
      if (!list) return null;
      const own = new Set(list);
      for (const value of list) {
        if (value.splitview) {
          const pair = split(value.splitview);
          if (!pair || !pair.every(member => own.has(member))) return null;
        }
      }
      return list;
    };
    return { ordered, local, tab, split, group };
  }

  function planGroupDrop(options = {}) {
    try {
      const check = validator(options);
      if (!check || !check.group(options.group)) return null;
      const requested = Array.from(options.tabs || []);
      if (!requested.length) return null;
      const units = new Set();
      for (const value of requested) {
        if (!check.tab(value)) return null;
        const unit = value.splitview || value;
        if (value.splitview && !check.split(unit)) return null;
        if (value.group !== options.group) units.add(unit);
      }
      if (!units.size) return null;
      const result = [];
      for (const value of check.ordered) {
        const unit = value.splitview || value;
        if (units.delete(unit)) result.push(unit);
      }
      return result;
    } catch (_) { return null; }
  }

  function planGroupMove(options = {}) {
    try {
      const check = validator(options), source = options.group;
      if (!check || !check.group(source)) return null;
      let target = options.target;
      if (check.local.has(target)) {
        if (!check.tab(target)) return null;
        target = target.group || target.splitview || target;
      } else if (check.split(target)) {
        target = target.group || target;
      }
      if (!target || target === source) return null;
      if (!check.local.has(target) && !check.group(target) && !check.split(target)) return null;
      return { group: source, target };
    } catch (_) { return null; }
  }

  const api = Object.freeze({ planGroupDrop, planGroupMove });
  scope.FluxionFlowDrag = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis === "object" ? globalThis : this);
