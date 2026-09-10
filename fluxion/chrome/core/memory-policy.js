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
    if (domains === null) return true;
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
    if (domains === null) return () => false;
    // Snapshot one bounded operation's policy, never a live preferences cache.
    const prepared = Object.freeze(parseExcludedDomains(domains));
    return page => canIndexAgainstDomains(page, prepared, true);
  }

  const POLICY_PREF = "fluxion.memory.exclusionPolicy";
  const LEGACY_PREF = "fluxion.memory.excludedDomains";
  function checkPolicySize(value) {
    if (value.length > 131072) throw new Error("Exclusion policy exceeds its 128 KiB storage limit.");
    let bytes = 0;
    for (const character of value) {
      const point = character.codePointAt(0);
      bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
      if (bytes > 131072) throw new Error("Exclusion policy exceeds its 128 KiB storage limit.");
    }
  }
  function validateDomains(values) {
    if (!Array.isArray(values)) throw new Error("Domains must be a list.");
    const result = [];
    for (const value of values) {
      if (typeof value !== "string" || value.length > 4096) throw new Error("Invalid domain entry.");
      const domain = normaliseDomain(value);
      if (!domain || domain.length > 253) throw new Error("Enter a valid domain of at most 253 characters.");
      if (!result.includes(domain)) result.push(domain);
    }
    return result;
  }
  function validatePolicy(value) {
    checkPolicySize(JSON.stringify(value) || "");
    if (!value || value.version !== 1 || !Array.isArray(value.lists) || value.lists.length > 20) {
      throw new Error("Unsupported exclusion policy or more than 20 lists.");
    }
    const directDomains = validateDomains(value.directDomains);
    const ids = new Set();
    const lists = value.lists.map(list => {
      if (!list || typeof list.id !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(list.id) || ids.has(list.id)) {
        throw new Error("Invalid or duplicate exclusion list identity.");
      }
      ids.add(list.id);
      if (typeof list.name !== "string" || !list.name.trim() || list.name.trim().length > 40 ||
          /[\u0000-\u001f\u007f]/.test(list.name) || typeof list.enabled !== "boolean") {
        throw new Error("List names must contain 1–40 characters and a valid enabled setting.");
      }
      return { id: list.id, name: list.name.trim(), enabled: list.enabled, domains: validateDomains(list.domains) };
    });
    if (directDomains.length + lists.reduce((count, list) => count + list.domains.length, 0) > 200) {
      throw new Error("Browser Memory supports up to 200 excluded domains across direct domains and all lists, including disabled lists.");
    }
    const policy = { version: 1, directDomains, lists };
    checkPolicySize(JSON.stringify(policy));
    return policy;
  }
  function readPolicy(prefs) {
    let legacyPolicy = false;
    try {
      const type = prefs.getPrefType(POLICY_PREF);
      if (type !== 0) {
        if (type !== 32) throw new Error("Exclusion policy preference must be a string.");
        const raw = prefs.getStringPref(POLICY_PREF);
        checkPolicySize(raw);
        return { valid: true, legacy: false, ...validatePolicy(JSON.parse(raw)) };
      }
      legacyPolicy = true;
      const legacy = prefs.getStringPref(LEGACY_PREF, "[]");
      checkPolicySize(legacy);
      let domains;
      try { domains = JSON.parse(legacy); } catch (_) { domains = legacy.split(/[\s,]+/).filter(Boolean); }
      return { valid: true, legacy: true, ...validatePolicy({ version: 1, directDomains: domains, lists: [] }) };
    } catch (error) {
      return { valid: false, legacy: legacyPolicy, version: 1, directDomains: [], lists: [], error: String(error.message || error) };
    }
  }
  function effectiveDomains(policy) {
    if (!policy.valid) return null;
    return [...new Set([...policy.directDomains, ...policy.lists.filter(list => list.enabled).flatMap(list => list.domains)])];
  }

  const api = Object.freeze({
    POLICY_PREF, LEGACY_PREF, validatePolicy, validateDomains, readPolicy, effectiveDomains,
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
