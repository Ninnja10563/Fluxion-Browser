/* exported FluxionSettings */
(function exposeFluxionSettings(scope) {
  "use strict";

  const SIDEBAR_STATES = Object.freeze(["expanded", "compact", "focus"]);
  const DENSITIES = Object.freeze(["compact", "standard", "roomy"]);

  function choice(value, allowed, fallback) {
    return allowed.includes(value) ? value : fallback;
  }

  function homepage(value, fallback = "about:newtab") {
    const candidate = String(value || "").trim();
    if (!candidate || /[\r\n]/.test(candidate)) return fallback;
    return candidate.slice(0, 2048);
  }

  function startupPage(value) {
    const parsed = Number.parseInt(value, 10);
    return [0, 1, 3].includes(parsed) ? parsed : 1;
  }

  function excludedDomains(value) {
    const items = Array.isArray(value) ? value : String(value || "").split(/[\n,]+/);
    return [...new Set(items.map(item => String(item).trim().toLowerCase()).filter(Boolean))]
      .slice(0, 200);
  }

  scope.FluxionSettings = Object.freeze({
    DENSITIES,
    SIDEBAR_STATES,
    excludedDomains,
    homepage,
    normaliseDensity: value => choice(value, DENSITIES, "standard"),
    normaliseSidebar: value => choice(value, SIDEBAR_STATES, "expanded"),
    startupPage,
  });
})(typeof globalThis === "object" ? globalThis : this);
