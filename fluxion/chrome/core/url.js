/* global globalThis */
(function exposeUrlCore(scope) {
  "use strict";

  const SCHEME = /^[a-z][a-z\d+.-]*:/i;
  const DOMAIN = /^(?:localhost|(?:[\p{L}\d-]+\.)+[\p{L}]{2,})(?::\d+)?(?:[/?#]|$)/u;

  function normaliseInput(raw) {
    return String(raw ?? "").trim();
  }

  function resolveNavigation(raw, searchBase = "https://duckduckgo.com/?q=") {
    const value = normaliseInput(raw);
    if (!value) return "about:newtab";
    if (DOMAIN.test(value)) return `https://${value}`;
    if (SCHEME.test(value)) return value;
    return `${searchBase}${encodeURIComponent(value)}`;
  }

  const api = Object.freeze({ normaliseInput, resolveNavigation });
  scope.FluxionUrl = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis === "object" ? globalThis : this);
