/* global Services */
(function alignFluxionChrome(window) {
  "use strict";
  const { document } = window;
  const root = document.documentElement;
  const flow = document.getElementById("fluxion-flow");
  const nav = document.getElementById("nav-bar");
  const target = document.getElementById("nav-bar-customization-target");
  const toolbox = document.getElementById("navigator-toolbox");
  if (!flow || !nav || !target || window.FluxionChromeLayout) return;
  let frame = 0, disposed = false, lastOffset = -1, lastRail = -1, lastTop = -1;
  function align() {
    frame = 0;
    if (disposed) return;
    const rail = flow.getBoundingClientRect(), controls = target.getBoundingClientRect();
    const rtl = window.getComputedStyle(flow).direction === "rtl";
    // Keep native window buttons and toolbar overflow ownership. Padding starts
    // navigation at the page column only when enough room exists beside them.
    const available = Math.max(0, controls.width - 480);
    const overlay = flow.dataset?.state === "focus";
    const wanted = overlay ? 0 : rtl ? controls.right - rail.left : rail.right - controls.left;
    const offset = Math.round(Math.min(available, Math.max(0, wanted)));
    const width = overlay ? 0 : Math.round(rail.width);
    // Lift the persistent rail above the bookmarks/navigation rows, reserving
    // only actual native caption controls that overlap this side of the window.
    // Narrow windows retain the original below-toolbox layout: native toolbar
    // overflow and caption ownership take precedence over reclaiming this gap.
    let top = 6;
    if (offset + 1 < Math.max(0, wanted) || root.hasAttribute("customizing")) {
      top = Math.max(6, toolbox?.getBoundingClientRect().bottom || rail.top || 0);
    } else {
      for (const buttons of document.querySelectorAll("#navigator-toolbox .titlebar-buttonbox")) {
        const box = buttons.getBoundingClientRect(), style = window.getComputedStyle(buttons);
        if (box.width > 0 && box.height > 0 && box.bottom > 0 && box.right > rail.left && box.left < rail.right &&
            style.visibility !== "hidden" && style.visibility !== "collapse" && style.display !== "none") top = Math.max(top, box.bottom + 6);
      }
    }
    top = Math.ceil(top);
    if (offset !== lastOffset) {
      nav.style.setProperty("--fluxion-navigation-offset", `${offset}px`);
      lastOffset = offset;
    }
    if (width !== lastRail) {
      root.style.setProperty("--fluxion-chrome-rail", `${width}px`);
      lastRail = width;
    }
    if (top !== lastTop) {
      root.style.setProperty("--fluxion-persistent-sidebar-top", `${top}px`);
      lastTop = top;
    }
  }
  function schedule() {
    if (!disposed && !frame) frame = window.requestAnimationFrame(align);
  }
  const resize = new window.ResizeObserver(schedule);
  resize.observe(flow); resize.observe(nav);
  if (toolbox) resize.observe(toolbox);
  const appearance = new window.MutationObserver(schedule);
  appearance.observe(root, { attributes: true, attributeFilter: ["inFullscreen", "inDOMFullscreen", "sizemode", "chromedir", "customizing"] });
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
