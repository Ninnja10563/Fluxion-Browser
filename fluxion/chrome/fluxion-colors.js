/* global Services, FluxionColorsCore */
(function initialiseFluxionColors(window) {
  "use strict";
  if (!window.gBrowser || window.FluxionColors) return;

  const PREF = "fluxion.appearance.colors.v1";
  const root = window.document.documentElement;
  let projected = null, lastSettings = "", lastEffective = "";
  function current() {
    return FluxionColorsCore.decode(Services.prefs.getStringPref(PREF, ""));
  }
  function project() {
    const settings = current();
    const workspace = window.FluxionUI?.workspaces().find(item => item.id === window.FluxionUI.currentWorkspace());
    const theme = workspace?.theme;
    const light = FluxionColorsCore.hex(theme?.light), dark = FluxionColorsCore.hex(theme?.dark);
    const base = settings.enabled ? settings : FluxionColorsCore.DEFAULTS;
    const effective = light && dark ? { enabled: true,
      light: { ...base.light, base: light }, dark: { ...base.dark, base: dark } } : settings;
    const settingsKey = JSON.stringify(settings);
    const effectiveKey = JSON.stringify(effective.enabled ? effective : { enabled: false });
    if (projected && effectiveKey === lastEffective && settingsKey === lastSettings) return;
    const values = effectiveKey === lastEffective && projected ? projected : FluxionColorsCore.variables(effective);
    for (const token of FluxionColorsCore.TOKENS) {
      const name = `--fluxion-${token}`;
      if (projected && values[name] === projected[name]) continue;
      if (values[name]) root.style.setProperty(name, values[name]);
      else root.style.removeProperty(name);
    }
    projected = values;
    lastSettings = settingsKey;
    lastEffective = effectiveKey;
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
  window.addEventListener("FluxionWorkspacesChanged", project);
  window.addEventListener("unload", () => {
    Services.prefs.removeObserver(PREF, observer);
    window.removeEventListener("FluxionWorkspacesChanged", project);
  }, { once: true });
  window.FluxionColors = Object.freeze({ current, setEnabled, setPalette, reset, project });
  project();
})(window);
