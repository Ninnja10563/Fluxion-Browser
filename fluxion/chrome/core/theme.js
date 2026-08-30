/* global globalThis */
(function exposeFluxionThemeCore(scope) {
  "use strict";

  const THEME_IDS = Object.freeze({
    system: "default-theme@mozilla.org",
    light: "firefox-compact-light@mozilla.org",
    dark: "firefox-compact-dark@mozilla.org",
  });
  const CHOICES = Object.freeze(Object.keys(THEME_IDS));

  function normaliseChoice(value) {
    return CHOICES.includes(value) ? value : "system";
  }

  function idForChoice(value) {
    return THEME_IDS[normaliseChoice(value)];
  }

  function choiceForId(value) {
    const match = CHOICES.find(choice => THEME_IDS[choice] === value);
    return match || "custom";
  }

  const api = Object.freeze({ CHOICES, THEME_IDS, choiceForId, idForChoice, normaliseChoice });
  scope.FluxionThemeCore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis === "object" ? globalThis : this);
