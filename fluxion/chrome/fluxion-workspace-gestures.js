/* global Services */
(function initialiseWorkspaceGestures(window) {
  "use strict";
  const { document, FluxionWorkspaceSwipe: swipe } = window;
  const flow = document.getElementById("fluxion-flow");
  const surface = flow?.querySelector(".fluxion-surface");
  if (!window.gBrowser || !window.FluxionUI || !swipe || !surface || window.FluxionWorkspaceGestures) return;

  const gesture = swipe.create(), cleanups = [], popups = new Set();
  let dragging = false, disposed = false;
  const on = (target, type, callback, options) => {
    target.addEventListener(type, callback, options);
    cleanups.push(() => target.removeEventListener(type, callback, options));
  };
  const visible = () => flow.dataset.state !== "focus" || flow.dataset.revealed === "true";
  const now = () => window.performance.now();
  const block = () => gesture.block(now());
  on(surface, "wheel", event => {
    // This listener never attaches to a content browser. Only trusted input in
    // our system-principal sidebar can invoke privileged workspace operations.
    if (event.isTrusted !== true || event.target?.ownerDocument !== document ||
        surface.nodePrincipal?.isSystemPrincipal !== true || !surface.contains(event.target)) return;
    const time = now();
    if (!visible() || event.defaultPrevented || !event.cancelable || dragging || popups.size ||
        document.documentElement.hasAttribute("data-fluxion-sidebar-resizing") ||
        event.ctrlKey || event.metaKey || event.altKey || event.shiftKey ||
        event.target.closest("input, textarea, select, [contenteditable='true']")) {
      gesture.block(time);
      return;
    }
    const result = gesture.push({ deltaX: event.deltaX, deltaY: event.deltaY, deltaMode: event.deltaMode, time });
    if (!result.consume) return;
    event.preventDefault();
    event.stopPropagation();
    if (!result.direction) return;
    const api = window.FluxionUI;
    const next = swipe.adjacent(api.workspaces(), api.currentWorkspace(), result.direction);
    if (next !== null) api.switchWorkspace(next);
  }, { passive: false });

  // Keep momentum ownership when the pointer briefly leaves the sidebar. A
  // deliberate next gesture resets after idle, not merely after pointer entry.
  on(surface, "pointerleave", block);
  on(document, "dragstart", () => { dragging = true; block(); }, true);
  for (const type of ["dragend", "drop"]) on(document, type, () => { dragging = false; block(); }, true);
  on(document, "popupshowing", event => {
    if (!["menupopup", "panel"].includes(event.target.localName)) return;
    popups.add(event.target);
    block();
  }, true);
  on(document, "popuphidden", event => { if (popups.delete(event.target)) block(); }, true);
  on(window, "blur", () => {
    // Selecting a native tab can transfer focus between chrome and content.
    // Only actual window deactivation relinquishes this wheel gesture.
    window.setTimeout(() => {
      if (!disposed && Services.focus.activeWindow !== window) { dragging = false; block(); }
    }, 0);
  });
  on(window, "unload", () => {
    disposed = true;
    while (cleanups.length) cleanups.pop()();
    popups.clear();
    gesture.reset();
    delete window.FluxionWorkspaceGestures;
  }, { once: true });
  window.FluxionWorkspaceGestures = Object.freeze({ enabled: true });
})(window);
