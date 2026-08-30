/* exported FluxionShortcutPolicy */
(function exposeFluxionShortcutPolicy(scope) {
  "use strict";

  const ACTIONS = Object.freeze({
    palette: Object.freeze({ label: "Command palette", defaultChord: "Accel+KeyK" }),
    tabSearch: Object.freeze({ label: "Search open tabs", defaultChord: "Accel+Shift+KeyA" }),
    sidebar: Object.freeze({ label: "Cycle Flow sidebar", defaultChord: "Accel+Shift+Backslash" }),
    workspaceNext: Object.freeze({ label: "Next workspace", defaultChord: "Accel+Alt+BracketRight" }),
    workspacePrevious: Object.freeze({ label: "Previous workspace", defaultChord: "Accel+Alt+BracketLeft" }),
  });
  const RESERVED = new Set([
    "Accel+KeyQ", "Accel+KeyW", "Accel+KeyN", "Accel+KeyT", "Accel+KeyL",
    "Accel+KeyR", "Accel+KeyF", "Accel+KeyP", "Accel+Comma",
  ]);
  const MODIFIERS = new Set(["Accel", "Alt", "Shift"]);

  function parse(chord) {
    const parts = String(chord || "").split("+").filter(Boolean);
    const code = parts.at(-1) || "";
    const modifiers = new Set(parts.slice(0, -1));
    if (!code || !/^(?:Key[A-Z]|Digit[0-9]|F(?:[1-9]|1[0-2])|Bracket(?:Left|Right)|Backslash|Comma|Period|Slash|Semicolon|Quote|Minus|Equal|Backquote)$/.test(code)) return null;
    if ([...modifiers].some(value => !MODIFIERS.has(value))) return null;
    if (!modifiers.size) return null;
    return { accel: modifiers.has("Accel"), alt: modifiers.has("Alt"), shift: modifiers.has("Shift"), code };
  }

  function serialise(value) {
    if (!value?.code) return "";
    return [value.accel && "Accel", value.alt && "Alt", value.shift && "Shift", value.code]
      .filter(Boolean).join("+");
  }

  function eventChord(event, isMac) {
    if (!event?.code || /^(?:Meta|Control|Alt|Shift)/.test(event.code)) return "";
    return serialise({
      accel: isMac ? event.metaKey : event.ctrlKey,
      alt: event.altKey,
      shift: event.shiftKey,
      code: event.code,
    });
  }

  function normaliseMap(value) {
    const source = value && typeof value === "object" ? value : {};
    const result = Object.fromEntries(
      Object.entries(ACTIONS).map(([id, action]) => [id, action.defaultChord]),
    );
    for (const id of Object.keys(ACTIONS)) {
      const candidate = parse(source[id]) ? serialise(parse(source[id])) : "";
      if (!candidate || RESERVED.has(candidate)) continue;
      const conflicts = Object.entries(result).some(([otherId, value]) => otherId !== id && value === candidate);
      if (!conflicts) result[id] = candidate;
    }
    return result;
  }

  function validate(id, chord, shortcuts) {
    if (!ACTIONS[id] || !parse(chord)) return { ok: false, reason: "Press a shortcut with a modifier key." };
    const normalised = serialise(parse(chord));
    if (RESERVED.has(normalised)) return { ok: false, reason: "That shortcut is reserved by the browser or macOS." };
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
    if (isMac) return `${value.accel ? "⌘ " : ""}${value.alt ? "⌥ " : ""}${value.shift ? "⇧ " : ""}${key}`.trim();
    return [value.accel && "Ctrl", value.alt && "Alt", value.shift && "Shift", key].filter(Boolean).join("+");
  }

  scope.FluxionShortcutPolicy = Object.freeze({ ACTIONS, RESERVED, eventChord, format, normaliseMap, parse, serialise, validate });
})(typeof globalThis === "object" ? globalThis : this);
