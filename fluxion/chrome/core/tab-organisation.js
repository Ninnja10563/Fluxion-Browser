/* global globalThis */
(function exposeTabOrganisation(scope) {
  "use strict";

  const STOP_WORDS = new Set([
    "about", "app", "best", "blog", "com", "docs", "documentation", "example",
    "guide", "home", "https", "learn", "login", "net", "new", "official",
    "org", "page", "reference", "search", "site", "the", "welcome", "www",
  ]);
  const DISPLAY_NAMES = Object.freeze({
    github: "GitHub", javascript: "JavaScript", mozilla: "Mozilla", npm: "npm",
    react: "React", typescript: "TypeScript", websocket: "WebSocket",
  });

  function clean(value, limit = 240) {
    return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, limit);
  }

  function tokensFor(record) {
    const source = `${clean(record?.title)} ${clean(record?.hostname)}`
      .normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    return new Set((source.match(/[a-z0-9][a-z0-9+#.-]{2,}/g) || [])
      .map(token => token.replace(/^[.-]+|[.-]+$/g, ""))
      .filter(token => token.length >= 3 && !STOP_WORDS.has(token) && !/^\d+$/.test(token)));
  }

  function displayName(token) {
    const value = clean(token, 48).toLowerCase();
    return DISPLAY_NAMES[value] || value.replace(/(^|[-_.])([a-z0-9])/g, (_, space, letter) =>
      `${space ? " " : ""}${letter.toUpperCase()}`
    ).trim();
  }

  function eligible(records) {
    return (records || []).filter(record =>
      record && !record.pinned && !record.grouped && !record.split &&
      /^https?:\/\//i.test(clean(record.url))
    );
  }

  function suggestGroup(records, { minimum = 3, maximum = 8 } = {}) {
    const candidates = eligible(records);
    if (candidates.length < minimum) return null;
    const buckets = [];
    const domains = new Map();
    const keywords = new Map();
    for (const record of candidates) {
      const hostname = clean(record.hostname, 160).toLowerCase().replace(/^www\./, "");
      if (hostname) {
        if (!domains.has(hostname)) domains.set(hostname, []);
        domains.get(hostname).push(record);
      }
      for (const token of tokensFor(record)) {
        if (!keywords.has(token)) keywords.set(token, []);
        keywords.get(token).push(record);
      }
    }
    for (const [hostname, members] of domains) {
      if (members.length >= minimum) {
        const label = hostname.split(".").filter(Boolean).at(-2) || hostname.split(".")[0];
        buckets.push({ members, name: displayName(label), reason: `${members.length} tabs share ${hostname}`, score: members.length * 100 + 30 });
      }
    }
    for (const [token, members] of keywords) {
      const unique = [...new Set(members)];
      if (unique.length >= minimum) {
        const domainCount = new Set(unique.map(item => item.hostname)).size;
        buckets.push({ members: unique, name: displayName(token), reason: `${unique.length} tabs share “${displayName(token)}”`, score: unique.length * 100 + Math.min(domainCount, 12) });
      }
    }
    buckets.sort((left, right) => right.score - left.score || left.name.localeCompare(right.name));
    const best = buckets[0];
    if (!best) return null;
    return Object.freeze({
      name: best.name,
      reason: best.reason,
      records: Object.freeze(best.members.slice(0, Math.max(minimum, maximum))),
    });
  }

  const api = Object.freeze({ clean, displayName, eligible, suggestGroup, tokensFor });
  scope.FluxionTabOrganisation = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis === "object" ? globalThis : this);
