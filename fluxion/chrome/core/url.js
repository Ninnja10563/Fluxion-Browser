/* global globalThis */
(function exposeUrlCore(scope) {
  "use strict";

  const SAFE_SCHEME = /^(?:https?|ftp|file|about|view-source|moz-extension):/i;
  const DOMAIN = /^(?:localhost|(?:[\p{L}\d-]+\.)+[\p{L}]{2,})(?::\d+)?(?:[/?#]|$)/u;

  function normaliseInput(raw) {
    return String(raw ?? "").trim();
  }

  function classifyNavigation(raw) {
    const value = normaliseInput(raw);
    if (!value) return Object.freeze({ kind: "empty", value: "about:newtab" });
    if (DOMAIN.test(value)) return Object.freeze({ kind: "address", value: `https://${value}` });
    if (SAFE_SCHEME.test(value)) return Object.freeze({ kind: "address", value });
    return Object.freeze({ kind: "search", value });
  }

  function resolveNavigation(raw) {
    const route = classifyNavigation(raw);
    return route.kind === "search" ? null : route.value;
  }

  const api = Object.freeze({ classifyNavigation, normaliseInput, resolveNavigation });
  scope.FluxionUrl = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis === "object" ? globalThis : this);
