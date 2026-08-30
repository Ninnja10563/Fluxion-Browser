(function initialiseFluxionTabDrop(global) {
  "use strict";

  const EDGE_FRACTION = 0.24;
  const NONE = Object.freeze({ action: "none" });

  const finite = value => Number.isFinite(Number(value));
  const clamp = value => Math.max(0, Math.min(1, value));

  function classify(options = {}) {
    const rect = options.rect || {};
    if (
      !finite(options.clientX) || !finite(options.clientY) ||
      !finite(rect.left) || !finite(rect.top) ||
      !finite(rect.width) || !finite(rect.height) ||
      Number(rect.width) <= 0 || Number(rect.height) <= 0
    ) return NONE;

    const x = clamp((Number(options.clientX) - Number(rect.left)) / Number(rect.width));
    const y = clamp((Number(options.clientY) - Number(rect.top)) / Number(rect.height));
    if (y <= EDGE_FRACTION) {
      return Object.freeze({ action: "reorder", position: "before" });
    }
    if (y >= 1 - EDGE_FRACTION) {
      return Object.freeze({ action: "reorder", position: "after" });
    }
    if (!options.canSplit) {
      return Object.freeze({ action: "reorder", position: y < 0.5 ? "before" : "after" });
    }

    const orientation = options.stacked ? "stacked" : "side-by-side";
    const axis = options.stacked ? y : (options.rtl ? 1 - x : x);
    return Object.freeze({
      action: "split",
      orientation,
      position: axis < 0.5 ? "before" : "after",
    });
  }

  function shortLabel(intent) {
    if (intent?.action === "reorder") {
      return intent.position === "after" ? "Place after" : "Place before";
    }
    if (intent?.action !== "split") return "";
    if (intent.orientation === "stacked") {
      return intent.position === "after" ? "Stack below" : "Stack above";
    }
    return intent.position === "after" ? "Split right" : "Split left";
  }

  function announcement(intent, dragged = "Tab", target = "tab") {
    if (intent?.action === "reorder") {
      return `Drop to place ${dragged} ${intent.position === "after" ? "after" : "before"} ${target}.`;
    }
    if (intent?.action !== "split") return "";
    const place = intent.orientation === "stacked"
      ? (intent.position === "after" ? "below" : "above")
      : (intent.position === "after" ? "to the right of" : "to the left of");
    return `Drop to place ${dragged} ${place} ${target} in a split view.`;
  }

  const api = Object.freeze({ EDGE_FRACTION, announcement, classify, shortLabel });
  global.FluxionTabDrop = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
