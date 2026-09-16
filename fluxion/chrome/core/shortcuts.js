/* exported FluxionShortcutPolicy */
(function exposeFluxionShortcutPolicy(scope) {
  "use strict";

  const ACTIONS = Object.freeze({
    palette: Object.freeze({ label: "Command palette", defaultChord: "Accel+KeyK" }),
    tabSearch: Object.freeze({ label: "Search open tabs", defaultChord: "Accel+Shift+KeyA" }),
    sidebar: Object.freeze({ label: "Toggle Flow sidebar", defaultChord: "Accel+Shift+Backslash" }),
    workspaceNext: Object.freeze({ label: "Next workspace", defaultChord: "Accel+Alt+BracketRight" }),
    workspacePrevious: Object.freeze({ label: "Previous workspace", defaultChord: "Accel+Alt+BracketLeft" }),
  });
  // Preserve Gecko browsing/editing commands across supported platforms.
  // Fluxion intentionally owns only its five documented default chords.
  // https://support.mozilla.org/kb/keyboard-shortcuts-perform-firefox-tasks-quickly
  const RESERVED = new Set([
    "Accel+KeyQ", "Accel+KeyW", "Accel+KeyN", "Accel+KeyT", "Accel+KeyL",
    "Accel+KeyR", "Accel+KeyF", "Accel+KeyP", "Accel+Comma",
    "Accel+KeyA", "Accel+KeyC", "Accel+KeyV", "Accel+KeyX", "Accel+KeyZ",
    "Accel+KeyY", "Accel+KeyD", "Accel+KeyB", "Accel+KeyH", "Accel+KeyI",
    "Accel+KeyJ", "Accel+KeyO", "Accel+KeyS", "Accel+KeyU", "Accel+KeyG",
    "Accel+KeyE", "Accel+Minus", "Accel+Equal", "Accel+Digit0",
    "Accel+BracketLeft", "Accel+BracketRight",
    "Accel+Shift+KeyT", "Accel+Shift+KeyN", "Accel+Shift+KeyW", "Accel+Shift+KeyP",
    "Accel+Shift+KeyB", "Accel+Shift+KeyD", "Accel+Shift+KeyH", "Accel+Shift+KeyO",
    "Accel+Shift+KeyJ", "Accel+Shift+KeyY", "Accel+Shift+KeyR", "Accel+Shift+KeyG",
    "Accel+Shift+KeyV", "Accel+Shift+KeyZ", "Accel+Shift+KeyS",
    "Accel+Shift+KeyC", "Accel+Shift+KeyI", "Accel+Shift+KeyK", "Accel+Shift+KeyM",
    "Accel+Alt+KeyI", "Accel+Alt+KeyK", "Accel+Alt+KeyC", "Accel+Alt+KeyM",
    "Accel+Alt+KeyR", "Accel+Alt+KeyU", "Accel+Alt+KeyJ",
    "Accel+KeyM", "Accel+Period", "Accel+Backquote", "Accel+Shift+Backquote",
    "Accel+Shift+Equal", "Accel+Shift+KeyQ", "Accel+Shift+KeyX", "Accel+Alt+KeyF",
    "Accel+Alt+KeyH", "Accel+F4", "Accel+F5",
    ...Array.from({ length: 9 }, (_, index) => `Accel+Digit${index + 1}`),
  ]);
  const MAC_RESERVED = new Set(["Accel+Ctrl+KeyQ", "Accel+Ctrl+KeyF", "Accel+Ctrl+KeyD",
    ...Array.from({ length: 7 }, (_, index) => `Ctrl+F${index + 2}`)]);
  const MODIFIERS = new Set(["Accel", "Ctrl", "Alt", "Shift"]);

  function parse(chord) {
    const parts = String(chord || "").split("+").filter(Boolean);
    const code = parts.at(-1) || "";
    const modifiers = new Set(parts.slice(0, -1));
    if (!code || !/^(?:Key[A-Z]|Digit[0-9]|F(?:[1-9]|1[0-2])|Bracket(?:Left|Right)|Backslash|Comma|Period|Slash|Semicolon|Quote|Minus|Equal|Backquote)$/.test(code)) return null;
    if ([...modifiers].some(value => !MODIFIERS.has(value))) return null;
    if (!modifiers.has("Accel") && !modifiers.has("Ctrl")) return null;
    return { accel: modifiers.has("Accel"), ctrl: modifiers.has("Ctrl"), alt: modifiers.has("Alt"), shift: modifiers.has("Shift"), code };
  }

  function serialise(value) {
    if (!value?.code) return "";
    return [value.accel && "Accel", value.ctrl && "Ctrl", value.alt && "Alt", value.shift && "Shift", value.code]
      .filter(Boolean).join("+");
  }

  function eventChord(event, isMac) {
    if (!event?.code || /^(?:Meta|Control|Alt|Shift)/.test(event.code)) return "";
    // Cocoa marks Option as both Alt and AltGraph (nsCocoaUtils::ModifiersForEvent).
    // An explicit Command or Control chord is a shortcut exception; bare
    // Option text and Windows/Linux AltGr remain excluded.
    const macShortcutOption = isMac && (event.metaKey || event.ctrlKey) && event.altKey;
    if (event.isComposing || (event.getModifierState?.("AltGraph") && !macShortcutOption) ||
        (!isMac && event.metaKey)) return "";
    return serialise({
      accel: isMac ? event.metaKey : event.ctrlKey,
      ctrl: isMac && event.ctrlKey,
      alt: event.altKey,
      shift: event.shiftKey,
      code: event.code,
    });
  }

  function normaliseMap(value, isMac = false) {
    const source = value && typeof value === "object" ? value : {};
    const result = {};
    for (const [id, action] of Object.entries(ACTIONS)) {
      const candidate = parse(source[id]) ? serialise(parse(source[id])) : "";
      const platformValid = candidate && (isMac || !parse(candidate).ctrl);
      result[id] = platformValid && !RESERVED.has(candidate) && !(isMac && MAC_RESERVED.has(candidate)) ? candidate : action.defaultChord;
    }
    // Validate the complete mapping: distinct user-defined cycles are valid.
    // Repair conflicting components together; a default displaced by a repaired
    // binding can require another pass, but each action resets at most once.
    for (let pass = 0; pass < Object.keys(ACTIONS).length; pass++) {
      const counts = new Map();
      for (const chord of Object.values(result)) counts.set(chord, (counts.get(chord) || 0) + 1);
      const conflicts = Object.keys(result).filter(id => counts.get(result[id]) > 1);
      if (!conflicts.length) break;
      for (const id of conflicts) result[id] = ACTIONS[id].defaultChord;
    }
    return result;
  }

  function validate(id, chord, shortcuts, isMac = false) {
    if (!ACTIONS[id] || !parse(chord) || (!isMac && parse(chord).ctrl)) return { ok: false, reason: "Use Command or Control on Mac, or Control on Windows/Linux, with another key." };
    const normalised = serialise(parse(chord));
    if (RESERVED.has(normalised) || (isMac && MAC_RESERVED.has(normalised))) return { ok: false, reason: "That shortcut is reserved by the browser or macOS." };
    const conflict = Object.entries(shortcuts).find(([otherId, value]) => otherId !== id && value === normalised);
    if (conflict) return { ok: false, reason: `Already used by ${ACTIONS[conflict[0]].label}.` };
    return { ok: true, chord: normalised };
  }

  function format(chord, isMac) {
    const value = parse(chord);
    if (!value) return "Not set";
    const key = value.code.replace(/^Key/, "").replace(/^Digit/, "")
      .replace("BracketLeft", "[").replace("BracketRight", "]")
      .replace("Backslash", "\\").replace("Comma", ",").replace("Period", ".")
      .replace("Slash", "/").replace("Semicolon", ";").replace("Quote", "'")
      .replace("Minus", "-").replace("Equal", "=").replace("Backquote", "`");
    if (isMac) return `${value.ctrl ? "⌃ " : ""}${value.accel ? "⌘ " : ""}${value.alt ? "⌥ " : ""}${value.shift ? "⇧ " : ""}${key}`.trim();
    return [(value.accel || value.ctrl) && "Ctrl", value.alt && "Alt", value.shift && "Shift", key].filter(Boolean).join("+");
  }

  scope.FluxionShortcutPolicy = Object.freeze({ ACTIONS, RESERVED, eventChord, format, normaliseMap, parse, serialise, validate });
})(typeof globalThis === "object" ? globalThis : this);
