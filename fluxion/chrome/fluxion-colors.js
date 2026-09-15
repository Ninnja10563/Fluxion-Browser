/* global Services, FluxionColorsCore, FluxionWorkspaces */
(function initialiseFluxionColors(window) {
  "use strict";
  if (!window.gBrowser || window.FluxionColors) return;

  const PREF = "fluxion.appearance.colors.v1";
  const root = window.document.documentElement;
  let projected = null, lastSettings = "", lastEffective = "", lastWorkspace = null;
  let preview = null;
  const systemScheme = window.matchMedia?.("(prefers-color-scheme: dark)");
  function current() {
    return FluxionColorsCore.decode(Services.prefs.getStringPref(PREF, ""));
  }
  function project() {
    const settings = current();
    const workspaceId = window.FluxionUI?.currentWorkspace();
    const workspace = window.FluxionUI?.workspaces().find(item => item.id === workspaceId);
    if (preview && (preview.openedWorkspace !== workspaceId || !window.FluxionUI.workspaces().some(item => item.id === preview.id))) preview = null;
    const livePreview = preview?.active && preview.id === workspaceId ? preview : null;
    const theme = livePreview ? livePreview.theme : workspace?.theme;
    const light = FluxionColorsCore.hex(theme?.light), dark = FluxionColorsCore.hex(theme?.dark);
    const base = settings.enabled ? settings : FluxionColorsCore.DEFAULTS;
    const effective = light && dark ? { enabled: true,
      light: { base: light, accent: FluxionColorsCore.hex(theme?.lightAccent) || base.light.accent },
      dark: { base: dark, accent: FluxionColorsCore.hex(theme?.darkAccent) || base.dark.accent } } : settings;
    const scheme = livePreview?.mode || (light && dark && ["system", "light", "dark"].includes(theme?.mode) ? theme.mode : null);
    const resolvedScheme = scheme === "system" ? systemScheme?.matches ? "dark" : "light" : scheme;
    // Root color-scheme is owned by Gecko's global theme controller. Changing
    // it here would propagate workspace previews to embedded webpage media.
    // Only browser-chrome selectors consume this attribute; page frames don't.
    const schemeAttribute = "data-fluxion-workspace-appearance";
    if (root.getAttribute(schemeAttribute) !== resolvedScheme) {
      if (resolvedScheme) root.setAttribute(schemeAttribute, resolvedScheme);
      else root.removeAttribute(schemeAttribute);
    }
    const settingsKey = JSON.stringify(settings);
    const effectiveKey = JSON.stringify({ colors: effective.enabled ? effective : { enabled: false }, scheme: resolvedScheme });
    const workspaceChanged = workspaceId !== lastWorkspace;
    if (projected && effectiveKey === lastEffective && settingsKey === lastSettings && !workspaceChanged) return;
    const values = effectiveKey === lastEffective && projected ? projected : FluxionColorsCore.variables(effective, resolvedScheme);
    for (const token of FluxionColorsCore.TOKENS) {
      const name = `--fluxion-${token}`;
      if (projected && values[name] === projected[name]) continue;
      if (values[name]) root.style.setProperty(name, values[name]);
      else root.style.removeProperty(name);
    }
    projected = values;
    lastSettings = settingsKey;
    lastEffective = effectiveKey;
    lastWorkspace = workspaceId;
    window.dispatchEvent(new window.CustomEvent("FluxionColorsChanged", { detail: settings }));
  }
  function beginWorkspacePreview(id) {
    if (!window.FluxionUI?.workspaces().some(item => item.id === id)) throw new TypeError("Unknown workspace.");
    const token = { id, openedWorkspace: window.FluxionUI.currentWorkspace(), active: false, theme: null, mode: null };
    preview = token;
    return Object.freeze({
      update(theme, mode = null) {
        if (preview !== token) return false;
        const clean = theme === null ? null : FluxionWorkspaces.sanitiseTheme(theme);
        if (theme !== null && !clean || mode !== null && !["light", "dark"].includes(mode)) throw new TypeError("Invalid workspace appearance preview.");
        Object.assign(token, { theme: clean, mode, active: true });
        project();
        return preview === token;
      },
      clear() { if (preview === token) { preview = null; project(); } },
    });
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
  window.addEventListener("FluxionThemeChanged", project);
  systemScheme?.addEventListener("change", project);
  window.addEventListener("unload", () => {
    Services.prefs.removeObserver(PREF, observer);
    window.removeEventListener("FluxionWorkspacesChanged", project);
    window.removeEventListener("FluxionThemeChanged", project);
    systemScheme?.removeEventListener("change", project);
    preview = null;
  }, { once: true });
  window.FluxionColors = Object.freeze({ current, setEnabled, setPalette, reset, project, beginWorkspacePreview });
  project();
})(window);
