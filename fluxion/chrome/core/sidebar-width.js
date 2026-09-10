(function exposeSidebarSizing(scope) {
  "use strict";
  const bounds = Object.freeze({ min: 180, max: 420, default: 232 });
  function preferred(value) {
    if (typeof value !== "number" &&
        !(typeof value === "string" && /^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(value.trim()))) return bounds.default;
    const number = Number(value);
    return Number.isFinite(number) ? Math.round(Math.min(bounds.max, Math.max(bounds.min, number))) : bounds.default;
  }
  function available(containerWidth) {
    const width = Number(containerWidth);
    return Number.isFinite(width) ? Math.floor(Math.min(bounds.max, Math.max(bounds.min, width - 320))) : bounds.min;
  }
  function effective(value, containerWidth) { return Math.min(preferred(value), available(containerWidth)); }
  function keyboard(key, current, containerWidth, { shift = false, rtl = false } = {}) {
    const maximum = available(containerWidth);
    if (key === "Home") return bounds.min;
    if (key === "End") return maximum;
    if (key !== "ArrowLeft" && key !== "ArrowRight") return null;
    const direction = (key === "ArrowRight" ? 1 : -1) * (rtl ? -1 : 1);
    return Math.min(maximum, Math.max(bounds.min, current + direction * (shift ? 24 : 8)));
  }
  const api = Object.freeze({ bounds, preferred, available, effective, keyboard });
  scope.FluxionSidebarSizing = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis === "object" ? globalThis : this);
