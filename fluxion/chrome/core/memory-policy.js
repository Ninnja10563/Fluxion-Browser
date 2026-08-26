/* global globalThis */
(function exposeMemoryPolicy(scope) {
  "use strict";

  const SENSITIVE_HOST_PREFIXES = Object.freeze([
    "accounts.",
    "auth.",
    "login.",
    "mail.",
    "webmail.",
  ]);
  const SENSITIVE_PATH_SEGMENTS = Object.freeze([
    "account",
    "auth",
    "billing",
    "checkout",
    "login",
    "oauth",
    "payment",
    "signin",
    "wallet",
  ]);

  function normaliseDomain(value) {
    const candidate = String(value || "").trim().toLocaleLowerCase();
    if (!candidate) return "";
    try {
      const url = candidate.includes("://")
        ? new URL(candidate)
        : new URL(`https://${candidate}`);
      return url.hostname.replace(/^www\./, "").replace(/\.$/, "");
    } catch (_) {
      return "";
    }
  }

  function parseExcludedDomains(value) {
    let values = value;
    if (typeof value === "string") {
      try {
        values = JSON.parse(value);
      } catch (_) {
        values = value.split(/[\s,]+/);
      }
    }
    if (!Array.isArray(values)) return [];
    return [...new Set(values.map(normaliseDomain).filter(Boolean))].slice(0, 200);
  }

  function domainMatches(hostname, domain) {
    return hostname === domain || hostname.endsWith(`.${domain}`);
  }

  function isExcludedUrl(value, domains) {
    try {
      const hostname = new URL(value).hostname.toLocaleLowerCase();
      return parseExcludedDomains(domains).some(domain => domainMatches(hostname, domain));
    } catch (_) {
      return true;
    }
  }

  function isSensitiveUrl(value) {
    try {
      const url = new URL(value);
      if (url.protocol !== "http:" && url.protocol !== "https:") return true;
      if (url.username || url.password) return true;
      const hostname = url.hostname.toLocaleLowerCase();
      if (SENSITIVE_HOST_PREFIXES.some(prefix => hostname.startsWith(prefix))) return true;
      const segments = url.pathname
        .toLocaleLowerCase()
        .split("/")
        .filter(Boolean);
      return segments.some(segment => SENSITIVE_PATH_SEGMENTS.includes(segment));
    } catch (_) {
      return true;
    }
  }

  const api = Object.freeze({
    isExcludedUrl,
    isSensitiveUrl,
    normaliseDomain,
    parseExcludedDomains,
  });
  scope.FluxionMemoryPolicy = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis === "object" ? globalThis : this);
