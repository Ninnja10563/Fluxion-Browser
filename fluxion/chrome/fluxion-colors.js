/* global Services, FluxionColorsCore */
(function initialiseFluxionColors(window) {
  "use strict";
  if (!window.gBrowser || window.FluxionColors) return;

  const PREF = "fluxion.appearance.colors.v1";
  const root = window.document.documentElement;
  function current() {
    return FluxionColorsCore.decode(Services.prefs.getStringPref(PREF, ""));
  }
  function project() {
    const settings = current();
    const values = FluxionColorsCore.variables(settings);
    for (const token of FluxionColorsCore.TOKENS) {
      const name = `--fluxion-${token}`;
      if (values[name]) root.style.setProperty(name, values[name]);
      else root.style.removeProperty(name);
    }
    window.dispatchEvent(new window.CustomEvent("FluxionColorsChanged", { detail: settings }));
  }
  function save(settings) {
    Services.prefs.setStringPref(PREF, JSON.stringify(settings));
    Services.prefs.savePrefFile(null);
    return current();
  }
  function setEnabled(enabled) {
    if (typeof enabled !== "boolean") throw new TypeError("Color enablement must be a boolean.");
    return save({ ...current(), enabled });
  }
  function setPalette(mode, value) {
    if (!["light", "dark"].includes(mode)) throw new TypeError("Choose a light or dark palette.");
    const base = FluxionColorsCore.hex(value?.base), accent = FluxionColorsCore.hex(value?.accent);
    if (!base || !accent) throw new TypeError("Use six-digit hexadecimal colors, such as #1c1e20.");
    return save({ ...current(), [mode]: { base, accent } });
  }
  function reset() {
    return save(FluxionColorsCore.normalise(null));
  }
  const observer = { observe: project };
  Services.prefs.addObserver(PREF, observer);
  window.addEventListener("unload", () => {
    Services.prefs.removeObserver(PREF, observer);
  }, { once: true });
  window.FluxionColors = Object.freeze({ current, setEnabled, setPalette, reset });
  project();
})(window);
