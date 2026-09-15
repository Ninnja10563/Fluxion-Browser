(function exposeBrowserPreferences(scope) {
  "use strict";
  const DEFINITIONS = Object.freeze([
    { id: "smooth-scrolling", section: "general", pref: "general.smoothScroll", title: "Smooth scrolling",
      description: "Animate webpage scrolling using Gecko’s native scrolling behavior." },
    { id: "hardware-acceleration", section: "general", pref: "layers.acceleration.disabled", inverse: true,
      title: "Hardware acceleration", description: "Use graphics hardware when available. Restart Fluxion after changing this setting; Gecko still applies its device safety checks.", restart: true },
    { id: "ask-download-location", section: "general", pref: "browser.download.useDownloadDir", inverse: true,
      title: "Ask where to save downloads", description: "Choose a location for each download instead of using your default download folder." },
    { id: "save-passwords", section: "privacy", pref: "signon.rememberSignons", title: "Offer to save passwords",
      description: "Let Gecko offer to save logins. Turning this off does not delete existing saved passwords." },
    { id: "block-popups", section: "privacy", pref: "dom.disable_open_during_load", title: "Block pop-up windows",
      description: "Block unsolicited pop-up windows. Existing site exceptions still apply." },
    { id: "https-only", section: "privacy", pref: "dom.security.https_only_mode", title: "HTTPS-Only Mode",
      description: "Prefer secure connections in all windows and ask before loading a site that only supports HTTP." },
  ].map(Object.freeze));
  function create(prefs) {
    const definition = id => {
      const item = DEFINITIONS.find(item => item.id === id);
      if (!item) throw new TypeError("Unknown browser preference.");
      return item;
    };
    function read(id) {
      const item = definition(id);
      let value;
      try { value = prefs.getBoolPref(item.pref); } catch (_) {}
      const available = typeof value === "boolean";
      return { available, checked: available && (item.inverse ? !value : value),
        locked: !available || Boolean(prefs.prefIsLocked?.(item.pref)),
        modified: Boolean(prefs.prefHasUserValue?.(item.pref)) };
    }
    function write(id, checked) {
      if (typeof checked !== "boolean") throw new TypeError("Browser preference values must be boolean.");
      const item = definition(id);
      if (read(id).locked) return false;
      prefs.setBoolPref(item.pref, item.inverse ? !checked : checked);
      prefs.savePrefFile(null);
      return true;
    }
    function reset(id) {
      const item = definition(id), state = read(id);
      if (state.locked) return false;
      if (state.modified) { prefs.clearUserPref(item.pref); prefs.savePrefFile(null); }
      return true;
    }
    function subscribe(listener) {
      let active = true;
      const observer = { observe() { if (active) listener(); } };
      for (const item of DEFINITIONS) prefs.addObserver(item.pref, observer);
      return () => {
        if (!active) return;
        active = false;
        for (const item of DEFINITIONS) prefs.removeObserver(item.pref, observer);
      };
    }
    return Object.freeze({ read, write, reset, subscribe });
  }
  const api = Object.freeze({ DEFINITIONS, create });
  scope.FluxionBrowserPreferences = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis === "object" ? globalThis : this);
