/* exported FluxionColorsCore */
(function exposeFluxionColors(scope) {
  "use strict";

  const DEFAULTS = Object.freeze({
    enabled: false,
    light: Object.freeze({ base: "#e9eae7", accent: "#3f596e" }),
    dark: Object.freeze({ base: "#1c1e20", accent: "#8ba9bd" }),
  });
  const TOKENS = Object.freeze(["bg", "bg-raised", "ink", "muted", "line", "selected", "hover", "accent"]);

  function hex(value) {
    if (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value.trim())) return null;
    return value.trim().toLowerCase();
  }
  function normalise(value) {
    const source = value && typeof value === "object" ? value : {};
    return {
      enabled: source.enabled === true,
      light: { base: hex(source.light?.base) || DEFAULTS.light.base, accent: hex(source.light?.accent) || DEFAULTS.light.accent },
      dark: { base: hex(source.dark?.base) || DEFAULTS.dark.base, accent: hex(source.dark?.accent) || DEFAULTS.dark.accent },
    };
  }
  function decode(value) {
    try { return normalise(JSON.parse(value)); }
    catch { return normalise(null); }
  }
  function channels(value) {
    const valid = hex(value);
    if (!valid) throw new TypeError("Use a six-digit hexadecimal color, such as #1c1e20.");
    return [1, 3, 5].map(index => Number.parseInt(valid.slice(index, index + 2), 16));
  }
  function luminance(value) {
    const values = channels(value).map(channel => {
      const s = channel / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
  }
  function contrast(a, b) {
    const first = luminance(a), second = luminance(b);
    return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
  }
  function mix(a, b, amount) {
    const first = channels(a), second = channels(b);
    return "#" + first.map((channel, index) => Math.round(channel + (second[index] - channel) * amount)
      .toString(16).padStart(2, "0")).join("");
  }
  function readable(candidate, ink, surfaces, minimum = 4.5) {
    // Quantized sRGB colors need a checked result, not an assumed interpolation
    // threshold. The final iteration always reaches the known-readable ink.
    for (let step = 0; step <= 100; step++) {
      const color = mix(candidate, ink, step / 100);
      if (surfaces.every(surface => contrast(color, surface) >= minimum)) return color;
    }
    return ink;
  }
  function palette({ base, accent }) {
    base = hex(base); accent = hex(accent);
    if (!base || !accent) throw new TypeError("Use six-digit hexadecimal colors.");
    const ink = contrast(base, "#000000") >= contrast(base, "#ffffff") ? "#000000" : "#ffffff";
    const paper = ink === "#000000" ? "#ffffff" : "#000000";
    function surface(amount) {
      // Keep all surfaces on the readable side of the chosen foreground, even
      // for a custom middle-gray or saturated base at the AA contrast boundary.
      for (let step = Math.round(amount * 100); step >= 0; step--) {
        const color = mix(base, ink, step / 100);
        if (contrast(color, ink) >= 4.5) return color;
      }
      return base;
    }
    const raised = ink === "#000000" ? mix(base, paper, 0.10) : surface(0.06);
    const selected = surface(0.10), hover = surface(0.05);
    const surfaces = [base, raised, selected, hover];
    return {
      bg: base, "bg-raised": raised, ink,
      muted: readable(mix(base, ink, 0.55), ink, surfaces),
      line: mix(base, ink, 0.20), selected, hover,
      accent: readable(accent, ink, surfaces),
    };
  }
  function variables(settings) {
    const normalized = normalise(settings);
    if (!normalized.enabled) return {};
    const light = palette(normalized.light), dark = palette(normalized.dark);
    return Object.fromEntries(TOKENS.map(token => [
      `--fluxion-${token}`, `light-dark(${light[token]}, ${dark[token]})`,
    ]));
  }
  const api = Object.freeze({ DEFAULTS, TOKENS, hex, normalise, decode, contrast, palette, variables });
  scope.FluxionColorsCore = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis === "object" ? globalThis : this);
