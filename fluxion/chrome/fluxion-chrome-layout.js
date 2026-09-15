/* global Services */
(function alignFluxionChrome(window) {
  "use strict";
  const { document } = window;
  const root = document.documentElement;
  const flow = document.getElementById("fluxion-flow");
  const nav = document.getElementById("nav-bar");
  const target = document.getElementById("nav-bar-customization-target");
  if (!flow || !nav || !target || window.FluxionChromeLayout) return;
  let frame = 0, disposed = false, lastOffset = -1, lastRail = -1;
  function align() {
    frame = 0;
    if (disposed) return;
    const rail = flow.getBoundingClientRect(), controls = target.getBoundingClientRect();
    const rtl = window.getComputedStyle(flow).direction === "rtl";
    // Keep native window buttons and toolbar overflow ownership. Padding starts
    // navigation at the page column only when enough room exists beside them.
    const available = Math.max(0, controls.width - 480);
    const wanted = rtl ? controls.right - rail.left : rail.right - controls.left;
    const offset = Math.round(Math.min(available, Math.max(0, wanted)));
    const width = Math.round(rail.width);
    if (offset !== lastOffset) {
      nav.style.setProperty("--fluxion-navigation-offset", `${offset}px`);
      lastOffset = offset;
    }
    if (width !== lastRail) {
      root.style.setProperty("--fluxion-chrome-rail", `${width}px`);
      lastRail = width;
    }
  }
  function schedule() {
    if (!disposed && !frame) frame = window.requestAnimationFrame(align);
  }
  const resize = new window.ResizeObserver(schedule);
  resize.observe(flow); resize.observe(nav);
  const appearance = new window.MutationObserver(schedule);
  appearance.observe(root, { attributes: true, attributeFilter: ["inFullscreen", "inDOMFullscreen", "sizemode", "chromedir"] });
  window.addEventListener("aftercustomization", schedule);
  window.addEventListener("unload", () => {
    disposed = true;
    if (frame) window.cancelAnimationFrame(frame);
    resize.disconnect(); appearance.disconnect();
    window.removeEventListener("aftercustomization", schedule);
  }, { once: true });
  window.FluxionChromeLayout = Object.freeze({ refresh: schedule });
  align();
})(window);
