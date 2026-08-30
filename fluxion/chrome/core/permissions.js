/* global globalThis */
(function exposePermissionPolicy(scope) {
  "use strict";

  const TYPE_LABELS = Object.freeze({
    camera: "Camera",
    microphone: "Microphone",
    geo: "Location",
    "desktop-notification": "Notifications",
    "autoplay-media": "Autoplay",
    popup: "Pop-up windows",
    cookie: "Cookies",
    image: "Images",
    install: "Extension installation",
    "persistent-storage": "Persistent storage",
    "storage-access": "Cross-site storage access",
    "screen-share": "Screen sharing",
    "midi-sysex": "MIDI devices",
    speaker: "Audio output devices",
    "clipboard-read": "Clipboard reading",
    "clipboard-write": "Clipboard writing",
    "local-network": "Local network",
    "local-device": "Local devices",
    xr: "Immersive reality",
  });

  const ACTIONS = Object.freeze({
    0: ["Use default", "default"],
    1: ["Allow", "allow"],
    2: ["Block", "block"],
    3: ["Always ask", "ask"],
    8: ["Allow for session", "ask"],
  });

  const EXPIRY = Object.freeze({
    0: "Permanent",
    1: "Until Fluxion closes",
    3: "Managed by policy",
    4: "Until tab closes",
  });

  function clean(value, limit = 500) {
    return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
  }

  function safeOrigin(value) {
    try {
      const parsed = new URL(clean(value, 4096));
      if (!["http:", "https:"].includes(parsed.protocol)) return "";
      return parsed.origin;
    } catch (_) {
      return "";
    }
  }

  function typeLabel(type) {
    const value = clean(type, 120);
    if (TYPE_LABELS[value]) return TYPE_LABELS[value];
    return value
      .replace(/[._^-]+/g, " ")
      .replace(/\b\w/g, letter => letter.toLocaleUpperCase()) || "Site permission";
  }

  function action(capability) {
    const number = Number(capability);
    const [label, tone] = ACTIONS[number] || [`Custom decision (${number})`, "ask"];
    return Object.freeze({ label, tone });
  }

  function expiry(expireType, expireTime, browserId = 0, now = Date.now()) {
    const type = Number(expireType);
    if (Number(browserId) > 0) return "This tab";
    if (type === 2) {
      const date = new Date(Number(expireTime));
      if (!Number.isFinite(date.getTime())) return "Timed decision";
      if (date.getTime() <= now) return "Expired";
      return `Until ${new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium", timeStyle: "short",
      }).format(date)}`;
    }
    return EXPIRY[type] || "Custom duration";
  }

  function contextLabel(originAttributes, browserId = 0) {
    const attributes = clean(originAttributes, 300);
    const parts = [];
    if (/(?:^|&)privateBrowsingId=[1-9]/.test(attributes)) parts.push("Private session");
    const container = attributes.match(/(?:^|&)userContextId=(\d+)/);
    if (container && container[1] !== "0") parts.push(`Container ${container[1]}`);
    if (Number(browserId) > 0) parts.push("Tab-specific");
    return parts.join(" · ") || "Standard profile";
  }

  function normalise(record, now = Date.now()) {
    const origin = safeOrigin(record?.origin);
    const type = clean(record?.type, 120);
    if (!origin || !type) return null;
    const parsed = new URL(origin);
    const originAttributes = clean(record?.originAttributes, 300).replace(/^\^/, "");
    const browserId = Math.max(0, Number(record?.browserId || 0) || 0);
    const decision = action(record?.capability);
    const key = `${origin}\n${originAttributes}`;
    return Object.freeze({
      id: `${key}\n${type}\n${browserId}`,
      siteKey: key,
      origin,
      site: parsed.host,
      scheme: parsed.protocol.slice(0, -1),
      context: contextLabel(originAttributes, browserId),
      originAttributes,
      browserId,
      type,
      typeLabel: typeLabel(type),
      capability: Number(record?.capability || 0) || 0,
      state: decision.label,
      tone: decision.tone,
      expiry: expiry(record?.expireType, record?.expireTime, browserId, now),
      modificationTime: Math.max(0, Number(record?.modificationTime || 0) || 0),
    });
  }

  function tokens(value) {
    return clean(value, 500).toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  }

  function matches(record, query) {
    const terms = tokens(query);
    if (!terms.length) return true;
    const haystack = `${record.site} ${record.origin} ${record.type} ${record.typeLabel} ${record.state} ${record.context}`.toLocaleLowerCase();
    return terms.every(term => haystack.includes(term));
  }

  function group(records, query = "") {
    const sites = new Map();
    for (const record of records || []) {
      if (!record || !matches(record, query)) continue;
      if (!sites.has(record.siteKey)) sites.set(record.siteKey, []);
      sites.get(record.siteKey).push(record);
    }
    return [...sites.entries()]
      .map(([siteKey, permissions]) => Object.freeze({
        siteKey,
        origin: permissions[0].origin,
        site: permissions[0].site,
        context: permissions[0].context,
        permissions: Object.freeze(permissions.sort((a, b) => a.typeLabel.localeCompare(b.typeLabel))),
      }))
      .sort((a, b) => a.site.localeCompare(b.site) || a.origin.localeCompare(b.origin));
  }

  const api = Object.freeze({
    ACTIONS, EXPIRY, TYPE_LABELS, action, clean, contextLabel, expiry, group,
    matches, normalise, safeOrigin, tokens, typeLabel,
  });
  scope.FluxionPermissionPolicy = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis === "object" ? globalThis : this);
