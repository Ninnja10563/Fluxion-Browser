/* Lucide 0.468.0, ISC license; see workspace-icons.LICENSE and docs/workspace-symbols.md. */
(function exposeWorkspaceIcons(scope) {
  "use strict";

  const shape = (tag, attributes) => Object.freeze({ tag, attributes: Object.freeze(attributes) });
  const icon = (label, source, shapes) => Object.freeze({ label, source, shapes: Object.freeze(shapes) });

  // Persisted IDs deliberately stay stable: upgrading symbols must not rewrite
  // workspace identity, user selections, or restored sessions.
  const icons = Object.freeze({
    circle: icon("Compass", "compass", [
      shape("path", { d: "m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z" }),
      shape("circle", { cx: "12", cy: "12", r: "10" }),
    ]),
    diamond: icon("Code", "code-xml", [
      shape("path", { d: "m18 16 4-4-4-4" }),
      shape("path", { d: "m6 8-4 4 4 4" }),
      shape("path", { d: "m14.5 4-5 16" }),
    ]),
    square: icon("Briefcase", "briefcase-business", [
      shape("path", { d: "M12 12h.01" }),
      shape("path", { d: "M16 6V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" }),
      shape("path", { d: "M22 13a18.15 18.15 0 0 1-20 0" }),
      shape("rect", { width: "20", height: "14", x: "2", y: "6", rx: "2" }),
    ]),
    arc: icon("Leaf", "leaf", [
      shape("path", { d: "M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z" }),
      shape("path", { d: "M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12" }),
    ]),
    grid: icon("Open book", "book-open", [
      shape("path", { d: "M12 7v14" }),
      shape("path", { d: "M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" }),
    ]),
  });

  const attributes = Object.freeze({
    viewBox: "0 0 24 24",
    width: "18",
    height: "18",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "2",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
    focusable: "false",
  });
  const choices = Object.freeze(Object.entries(icons).map(([id, value]) => Object.freeze([id, value.label])));
  function get(id) {
    return typeof id === "string" && Object.hasOwn(icons, id) ? icons[id] : icons.circle;
  }
  const api = Object.freeze({ viewBox: attributes.viewBox, attributes, choices, icons, get });
  scope.FluxionWorkspaceIcons = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis === "object" ? globalThis : this);
