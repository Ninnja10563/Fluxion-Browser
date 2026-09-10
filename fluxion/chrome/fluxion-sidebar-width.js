/* global Services */
(function initialiseSidebarWidth(window) {
  "use strict";
  const { document, FluxionSidebarSizing: sizing } = window;
  const browser = document.getElementById("browser");
  const flow = document.getElementById("fluxion-flow");
  const handle = document.getElementById("fluxion-sidebar-resizer");
  if (!sizing || !browser || !flow || !handle || window.FluxionSidebarWidth) return;
  const pref = "fluxion.sidebar.width", cleanups = [];
  let gesture = null, disposed = false, committing = false, displayed = sizing.bounds.default;
  const on = (node, type, callback, options) => {
    node.addEventListener(type, callback, options);
    cleanups.push(() => node.removeEventListener(type, callback, options));
  };
  const preferredWidth = () => sizing.preferred(Services.prefs.getIntPref(pref, sizing.bounds.default));
  const state = () => `${flow.dataset.state}:${flow.dataset.revealed}`;
  const visible = () => flow.dataset.state === "expanded" ||
    (flow.dataset.state === "focus" && flow.dataset.revealed === "true");
  const trustedHandle = event => !disposed && event.isTrusted === true && event.target === handle &&
    handle.ownerDocument === document && document.getElementById("fluxion-sidebar-resizer") === handle &&
    handle.nodePrincipal?.isSystemPrincipal === true && visible();
  const rtl = () => window.getComputedStyle(flow).direction === "rtl";
  function apply(value) {
    if (disposed) return;
    displayed = sizing.effective(value, browser.clientWidth);
    browser.style.setProperty("--fluxion-sidebar-width", `${displayed}px`);
    handle.setAttribute("aria-valuemin", String(sizing.bounds.min));
    handle.setAttribute("aria-valuemax", String(sizing.available(browser.clientWidth)));
    handle.setAttribute("aria-valuenow", String(displayed));
    handle.setAttribute("aria-valuetext", `${displayed} pixels`);
  }
  function finishGesture({ keepMarker = false } = {}) {
    const previous = gesture;
    gesture = null;
    if (previous?.frame) window.cancelAnimationFrame(previous.frame);
    if (!keepMarker) document.documentElement.removeAttribute("data-fluxion-sidebar-resizing");
    if (previous) {
      try { if (handle.hasPointerCapture(previous.id)) handle.releasePointerCapture(previous.id); } catch (_) {}
    }
    return previous;
  }
  function finishPreviewStyle() {
    // Resolve the final drag width before re-enabling ordinary transitions.
    // A pointerup can contain a newer coordinate than the last preview frame.
    if (document.documentElement.hasAttribute("data-fluxion-sidebar-resizing")) flow.getBoundingClientRect();
    document.documentElement.removeAttribute("data-fluxion-sidebar-resizing");
  }
  function cancel() {
    finishGesture({ keepMarker: true });
    apply(preferredWidth());
    finishPreviewStyle();
  }
  function setWidth(value) {
    if (disposed) return preferredWidth();
    finishGesture({ keepMarker: true });
    const width = sizing.preferred(value);
    committing = true;
    try {
      if (Services.prefs.getIntPref(pref, sizing.bounds.default) !== width) {
        Services.prefs.setIntPref(pref, width);
        Services.prefs.savePrefFile(null);
      }
      apply(preferredWidth());
    } finally {
      committing = false;
      finishPreviewStyle();
    }
    return preferredWidth();
  }
  const resetWidth = () => setWidth(sizing.bounds.default);
  const pointerWidth = event => sizing.effective(
    gesture.startWidth + (event.clientX - gesture.startX) * gesture.direction, browser.clientWidth);
  on(handle, "pointerdown", event => {
    if (!trustedHandle(event) || gesture || event.button !== 0 || event.isPrimary !== true ||
        event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || !Number.isFinite(event.clientX)) return;
    event.preventDefault();
    gesture = { id: event.pointerId, startX: event.clientX, startWidth: displayed,
      direction: rtl() ? -1 : 1, state: state(), frame: 0, pending: displayed };
    try { handle.setPointerCapture(event.pointerId); }
    catch (_) { cancel(); return; }
    document.documentElement.setAttribute("data-fluxion-sidebar-resizing", "true");
  });
  on(handle, "pointermove", event => {
    if (!gesture || event.isTrusted !== true || event.pointerId !== gesture.id || !Number.isFinite(event.clientX)) return;
    if (state() !== gesture.state) { cancel(); return; }
    gesture.pending = pointerWidth(event);
    if (!gesture.frame) {
      const active = gesture;
      active.frame = window.requestAnimationFrame(() => {
        if (gesture !== active || disposed) return;
        active.frame = 0;
        if (state() !== active.state) { cancel(); return; }
        apply(active.pending);
      });
    }
  });
  on(handle, "pointerup", event => {
    if (!gesture || event.isTrusted !== true || event.pointerId !== gesture.id) return;
    if (state() !== gesture.state || !Number.isFinite(event.clientX) || event.button !== 0) { cancel(); return; }
    const width = pointerWidth(event);
    if (width === gesture.startWidth) { cancel(); return; }
    setWidth(width);
  });
  for (const type of ["pointercancel", "lostpointercapture"]) on(handle, type, event => {
    if (gesture && event.pointerId === gesture.id) cancel();
  });
  on(window, "blur", () => { if (gesture) cancel(); });
  on(window, "keydown", event => {
    if (gesture && event.isTrusted === true && event.key === "Escape") {
      event.preventDefault(); event.stopPropagation(); cancel();
    }
  }, true);
  on(handle, "keydown", event => {
    if (!trustedHandle(event) || gesture || event.altKey || event.ctrlKey || event.metaKey) return;
    const width = sizing.keyboard(event.key, displayed, browser.clientWidth, { shift: event.shiftKey, rtl: rtl() });
    if (width === null) return;
    event.preventDefault(); event.stopPropagation();
    if (width !== displayed || !event.key.startsWith("Arrow")) setWidth(width);
  });
  on(handle, "dblclick", event => {
    if (!trustedHandle(event) || event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    event.preventDefault(); resetWidth();
  });
  const prefObserver = { observe() { if (!committing) cancel(); } };
  Services.prefs.addObserver(pref, prefObserver);
  cleanups.push(() => Services.prefs.removeObserver(pref, prefObserver));
  const stateObserver = new window.MutationObserver(() => {
    if (gesture && state() !== gesture.state) cancel();
    else if (!gesture) apply(preferredWidth());
    if (!visible() && document.activeElement === handle) {
      const target = flow.dataset.state === "compact"
        ? flow.querySelector('button[aria-label="Cycle sidebar size"]') : flow;
      target?.focus({ preventScroll: true });
    }
  });
  stateObserver.observe(flow, { attributes: true, attributeFilter: ["data-state", "data-revealed"] });
  let containerWidth = browser.clientWidth;
  const resizeObserver = new window.ResizeObserver(() => {
    const width = browser.clientWidth;
    if (width === containerWidth) return;
    containerWidth = width;
    cancel();
  });
  resizeObserver.observe(browser);
  on(window, "unload", () => {
    cancel();
    disposed = true;
    stateObserver.disconnect(); resizeObserver.disconnect();
    while (cleanups.length) cleanups.pop()();
    delete window.FluxionSidebarWidth;
  }, { once: true });
  handle.setAttribute("role", "separator");
  handle.setAttribute("aria-orientation", "vertical");
  handle.setAttribute("aria-label", "Sidebar width");
  handle.setAttribute("aria-keyshortcuts", "ArrowLeft ArrowRight Shift+ArrowLeft Shift+ArrowRight Home End");
  handle.tabIndex = 0;
  apply(preferredWidth());
  window.FluxionSidebarWidth = Object.freeze({ preferredWidth, effectiveWidth: () => displayed,
    setWidth, resetWidth, bounds: sizing.bounds });
})(window);
