/* global Services, FluxionShortcutPolicy */
(function initialiseFluxionShortcuts(window) {
  "use strict";

  if (window.FluxionShortcuts) return;
  const PREF = "fluxion.shortcuts";
  const isMac = window.navigator.platform.includes("Mac");
  let shortcuts;
  let captureControl = null;
  function reload() {
    try {
      shortcuts = FluxionShortcutPolicy.normaliseMap(JSON.parse(Services.prefs.getStringPref(PREF, "{}")));
    } catch (_) {
      shortcuts = FluxionShortcutPolicy.normaliseMap({});
    }
    window.dispatchEvent(new window.CustomEvent("FluxionShortcutsChanged"));
  }
  reload();
  const preferenceObserver = {
    observe(_subject, _topic, name) { if (name === PREF) reload(); },
  };
  Services.prefs.addObserver(PREF, preferenceObserver);
  window.addEventListener("unload", () => {
    captureControl = null;
    Services.prefs.removeObserver(PREF, preferenceObserver);
  }, { once: true });

  function save() {
    Services.prefs.setStringPref(PREF, JSON.stringify(shortcuts));
    Services.prefs.savePrefFile(null);
  }

  function set(id, chord) {
    const result = FluxionShortcutPolicy.validate(id, chord, shortcuts);
    if (!result.ok) return result;
    shortcuts = { ...shortcuts, [id]: result.chord };
    save();
    return result;
  }

  function reset(id) {
    if (id && FluxionShortcutPolicy.ACTIONS[id]) {
      const next = { ...shortcuts, [id]: FluxionShortcutPolicy.ACTIONS[id].defaultChord };
      const conflict = Object.entries(next).find(([other, value]) => other !== id && value === next[id]);
      if (conflict) next[conflict[0]] = FluxionShortcutPolicy.ACTIONS[conflict[0]].defaultChord;
      shortcuts = FluxionShortcutPolicy.normaliseMap(next);
    } else {
      shortcuts = FluxionShortcutPolicy.normaliseMap({});
    }
    save();
  }

  window.FluxionShortcuts = Object.freeze({
    actions: () => Object.entries(FluxionShortcutPolicy.ACTIONS).map(([id, action]) => ({ id, ...action })),
    capture: event => FluxionShortcutPolicy.eventChord(event, isMac),
    format: id => FluxionShortcutPolicy.format(shortcuts[id], isMac),
    get: id => shortcuts[id],
    beginCapture(control) {
      if (control?.ownerDocument !== window.document || control.localName !== "button" ||
          !window.document.getElementById("fluxion-settings")?.contains(control)) return false;
      captureControl = control;
      return true;
    },
    endCapture(control) { if (captureControl === control) captureControl = null; },
    matches(event, id) {
      if (captureControl?.isConnected && captureControl.ownerDocument === window.document &&
          captureControl.dataset.capturing === "true" &&
          (event.composedPath?.().includes(captureControl) || captureControl.contains(event.target))) return false;
      const chord = FluxionShortcutPolicy.eventChord(event, isMac);
      return Boolean(chord && chord === shortcuts[id]);
    },
    reset,
    set,
  });
  Services.prefs.setStringPref("fluxion.shortcuts.health", "editable-shortcut-registry-loaded");
  Services.prefs.savePrefFile(null);
})(window);
