/* exported FluxionTabCloseStability */
(function exposeFluxionTabCloseStability(scope) {
  "use strict";

  const DEFAULT_PADDING = 4;

  function finite(value, fallback = 0) {
    return Number.isFinite(Number(value)) ? Number(value) : fallback;
  }

  function guardRect(rect, padding = DEFAULT_PADDING) {
    const left = finite(rect?.left);
    const top = finite(rect?.top);
    const width = Math.max(0, finite(rect?.width, finite(rect?.right) - left));
    const height = Math.max(0, finite(rect?.height, finite(rect?.bottom) - top));
    const inset = Math.max(0, finite(padding, DEFAULT_PADDING));
    return Object.freeze({
      left: left - inset,
      right: left + width + inset,
      top: top - inset,
      bottom: top + height + inset,
    });
  }

  function contains(rect, point) {
    const x = Number(point?.clientX);
    const y = Number(point?.clientY);
    return Number.isFinite(x) && Number.isFinite(y) &&
      x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  function shouldRelease(rect, point) {
    return !contains(rect, point);
  }

  scope.FluxionTabCloseStability = Object.freeze({
    DEFAULT_PADDING,
    contains,
    guardRect,
    shouldRelease,
  });
})(typeof globalThis === "object" ? globalThis : this);
