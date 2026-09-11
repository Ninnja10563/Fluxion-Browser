(function exposeFlowTree(scope) {
  "use strict";

  function prepare(plans) {
    if (!Array.isArray(plans)) throw new TypeError("Flow tree plans must be an array");
    const seen = new Set();
    function visit(plan) {
      const node = plan?.node;
      if (!node || typeof node !== "object") throw new TypeError("Flow tree plan requires a DOM node");
      if (seen.has(node)) throw new Error("Flow tree plan contains a duplicate node or cycle");
      seen.add(node);
      if (!("children" in plan)) return { node };
      if (!Array.isArray(plan.children) || typeof node.insertBefore !== "function" || typeof node.removeChild !== "function") {
        throw new TypeError("Flow tree container requires children and DOM insertion support");
      }
      return { node, children: plan.children.map(visit) };
    }
    const prepared = plans.map(visit);
    // Roots are fixed anchors, not nodes this operation may move. A desired
    // descendant cannot currently contain an anchor: insertion would cycle.
    for (const root of prepared) {
      for (const node of seen) {
        if (node !== root.node && node.contains?.(root.node)) {
          throw new Error("Flow tree plan would move or remove a fixed root");
        }
      }
    }
    return prepared;
  }

  function stableIndices(container, children) {
    const positions = new Map(Array.from(container.childNodes || container.children, (node, index) => [node, index]));
    const tails = [], previous = [];
    for (let index = 0; index < children.length; index++) {
      const position = positions.get(children[index].node);
      if (position === undefined) continue;
      let low = 0, high = tails.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (positions.get(children[tails[middle]].node) < position) low = middle + 1;
        else high = middle;
      }
      previous[index] = low ? tails[low - 1] : -1;
      tails[low] = index;
    }
    const stable = new Set();
    for (let index = tails.at(-1); index !== undefined && index !== -1; index = previous[index]) stable.add(index);
    return stable;
  }

  function reconcile(plans) {
    const prepared = prepare(plans);
    const containers = [];
    function connect(plan) {
      if (!plan.children) return;
      const { node, children } = plan;
      containers.push(plan);
      const stable = stableIndices(node, children);
      for (let index = children.length - 1; index >= 0; index--) {
        if (stable.has(index)) continue;
        const child = children[index].node, before = children[index + 1]?.node || null;
        if (child.isConnected && node.isConnected && child.ownerDocument === node.ownerDocument &&
            typeof node.moveBefore === "function") node.moveBefore(child, before);
        else node.insertBefore(child, before);
      }
      // A newly created group/split must be connected before moving an existing
      // focused row into it, so native moveBefore can preserve its state.
      for (const child of children) connect(child);
    }
    for (const plan of prepared) connect(plan);
    // Obsolete wrappers may still hold desired descendants until another parent
    // is reconciled. Prune only after every planned reparenting has finished.
    for (const { node, children } of containers) {
      const wanted = new Set(children.map(child => child.node));
      for (const child of Array.from(node.childNodes || node.children)) {
        if (!wanted.has(child)) node.removeChild(child);
      }
    }
  }

  const api = Object.freeze({ reconcile });
  scope.FluxionFlowTree = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis === "object" ? globalThis : this);
