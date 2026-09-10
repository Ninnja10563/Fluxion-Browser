/* global globalThis */
(function exposeUrlCore(scope) {
  "use strict";

  const SAFE_SCHEME = /^(?:https?|ftp|file|about|view-source|moz-extension):/i;
  const DOMAIN = /^(?:localhost|(?:[\p{L}\d-]+\.)+[\p{L}]{2,})(?::\d+)?(?:[/?#]|$)/u;

  function localOrNumericAddress(value) {
    if (/\s/.test(value) || /^(?:javascript|data|vbscript|chrome|resource):/i.test(value)) return null;
    const authority = value.split(/[/?#]/, 1)[0];
    const ipv4 = authority.match(/^(\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?$/);
    const ipv6 = authority.startsWith("[");
    const localHost = /^(?:localhost|[a-z\d-]+(?:\.[a-z\d-]+)*\.(?:localhost|local))(?::\d+)?$/i.test(authority);
    const developmentHost = /^[a-z][a-z\d-]*:\d+$/i.test(authority);
    if (!ipv4 && !ipv6 && !localHost && !developmentHost) return null;
    if (ipv4 && ipv4[1].split(".").some(part => Number(part) > 255 || (part.length > 1 && part.startsWith("0")))) return null;
    let parsed;
    try { parsed = new URL(`http://${value}`); } catch (_) { return null; }
    if (parsed.username || parsed.password) return null;
    const host = parsed.hostname.toLowerCase();
    const octets = ipv4?.[1].split(".").map(Number);
    const localIPv4 = octets && (octets[0] === 10 || octets[0] === 127 ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168) ||
      (octets[0] === 169 && octets[1] === 254) || host === "0.0.0.0");
    const localIPv6 = ipv6 && (host === "[::1]" || host === "[::]" || /^\[(?:f[cd][\da-f]{2}:|fe[89ab][\da-f]:)/i.test(host));
    return `${localHost || developmentHost || localIPv4 || localIPv6 ? "http" : "https"}://${value}`;
  }

  function normaliseInput(raw) {
    return String(raw ?? "").trim();
  }

  function classifyNavigation(raw) {
    const value = normaliseInput(raw);
    if (!value) return Object.freeze({ kind: "empty", value: "about:newtab" });
    if (SAFE_SCHEME.test(value)) return Object.freeze({ kind: "address", value });
    const localAddress = localOrNumericAddress(value);
    if (localAddress) return Object.freeze({ kind: "address", value: localAddress });
    if (DOMAIN.test(value)) {
      try {
        new URL(`https://${value}`);
        return Object.freeze({ kind: "address", value: `https://${value}` });
      } catch (_) {}
    }
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
