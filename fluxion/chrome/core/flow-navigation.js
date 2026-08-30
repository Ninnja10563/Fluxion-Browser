/* global globalThis */
(function exposeFlowNavigation(scope) {
  "use strict";

  function rovingIndex(length, current, key, orientation = "vertical") {
    const size = Math.max(0, Number(length) || 0);
    if (!size) return -1;
    const index = Math.max(0, Math.min(Number(current) || 0, size - 1));
    if (key === "Home") return 0;
    if (key === "End") return size - 1;
    const previous = orientation === "horizontal" ? "ArrowLeft" : "ArrowUp";
    const next = orientation === "horizontal" ? "ArrowRight" : "ArrowDown";
    if (key === previous) return (index - 1 + size) % size;
    if (key === next) return (index + 1) % size;
    return index;
  }

  function handlesRovingKey(key, orientation = "vertical") {
    return ["Home", "End", ...(orientation === "horizontal"
      ? ["ArrowLeft", "ArrowRight"] : ["ArrowUp", "ArrowDown"])]
      .includes(String(key));
  }

  function groupKeyAction(key, collapsed) {
    const value = String(key);
    if (value === "Enter" || value === " ") return "toggle";
    if (value === "ArrowRight") return collapsed ? "expand" : "first-child";
    if (value === "ArrowLeft") return collapsed ? null : "collapse";
    return null;
  }

  const api = Object.freeze({ groupKeyAction, handlesRovingKey, rovingIndex });
  scope.FluxionFlowNavigation = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis === "object" ? globalThis : this);
