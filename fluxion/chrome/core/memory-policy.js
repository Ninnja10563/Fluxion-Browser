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

  function hasSensitivePath(pathname) {
    // Classification only: servers may decode escaped separators or decode
    // more than once. Never change the URL used for navigation. Bound work and
    // exclude ambiguous/malformed paths rather than guessing server behavior.
    if (pathname.length > 8192) return true;
    let path = pathname;
    for (let pass = 0; pass <= 4; pass += 1) {
      const segments = path.toLowerCase().replace(/\\/g, "/").split("/");
      if (segments.some(segment => SENSITIVE_PATH_SEGMENTS.includes(segment))) return true;
      if (!path.includes("%")) return false;
      if (pass === 4) return true;
      try {
        path = decodeURIComponent(path);
      } catch (_) {
        return true;
      }
    }
    return true;
  }

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

  function matchesExcludedUrl(value, domains, prepared) {
    try {
      // DNS's optional root dot must not bypass the same domain exclusion.
      const hostname = new URL(value).hostname.toLocaleLowerCase().replace(/\.$/, "");
      return (prepared ? domains : parseExcludedDomains(domains)).some(domain => domainMatches(hostname, domain));
    } catch (_) {
      return true;
    }
  }

  function isExcludedUrl(value, domains) {
    return matchesExcludedUrl(value, domains, false);
  }

  function isSensitiveUrl(value) {
    try {
      const url = new URL(value);
      if (url.protocol !== "http:" && url.protocol !== "https:") return true;
      if (url.username || url.password) return true;
      const hostname = url.hostname.toLocaleLowerCase();
      if (SENSITIVE_HOST_PREFIXES.some(prefix => hostname.startsWith(prefix))) return true;
      return hasSensitivePath(url.pathname);
    } catch (_) {
      return true;
    }
  }

  function canIndexAgainstDomains(page, domains, prepared) {
    if (!page || page.isPrivate || page.hasPasswordField) return false;
    const url = String(page.url || "");
    return !isSensitiveUrl(url) && !matchesExcludedUrl(url, domains, prepared);
  }

  function canIndexPage(page, domains = []) {
    return canIndexAgainstDomains(page, domains, false);
  }

  function createPageFilter(domains = []) {
    // Snapshot one bounded operation's policy, never a live preferences cache.
    const prepared = Object.freeze(parseExcludedDomains(domains));
    return page => canIndexAgainstDomains(page, prepared, true);
  }

  const api = Object.freeze({
    canIndexPage,
    createPageFilter,
    isExcludedUrl,
    isSensitiveUrl,
    normaliseDomain,
    parseExcludedDomains,
  });
  scope.FluxionMemoryPolicy = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis === "object" ? globalThis : this);
