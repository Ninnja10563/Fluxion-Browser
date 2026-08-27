/* exported FluxionPeekPolicy */
(function exposeFluxionPeekPolicy(scope) {
  "use strict";

  const ATTRIBUTE = "fluxion-peek";

  function isSafeLink(value) {
    try {
      const url = new URL(String(value));
      return ["http:", "https:", "file:"].includes(url.protocol);
    } catch (_) {
      return false;
    }
  }

  function canPair(source, peek) {
    return Boolean(source && peek && source !== peek && source.parentNode && peek.parentNode &&
      !source.pinned && !peek.pinned && !source.splitview && !peek.splitview);
  }

  scope.FluxionPeekPolicy = Object.freeze({ ATTRIBUTE, canPair, isSafeLink });
})(typeof globalThis === "object" ? globalThis : this);
