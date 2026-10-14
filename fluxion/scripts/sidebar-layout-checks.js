/* CSS-fixture checks only: not native Gecko/XUL validation. */
(() => {
  "use strict";
  const root = document.documentElement;
  const q = selector => document.querySelector(selector);
  const box = selector => q(selector).getBoundingClientRect();
  const flow = q("#fluxion-flow"), browser = q("#browser"), list = q(".fluxion-tabs");
  const report = { scope: "rendered sidebar CSS fixture, not native Gecko", cases: 0, errors: [] };
  root.setAttribute("data-fluxion-no-motion", "");
  while (list.children.length < 45) list.append(list.firstElementChild.cloneNode(true));
  // Measure settled states; animation timing is deliberately not asserted here.
  for (const dir of ["ltr", "rtl"]) for (const theme of ["light", "dark"])
    for (const state of ["expanded", "focus"]) for (const density of ["compact", "standard", "roomy"])
      for (const width of [180, 232, 320]) {
        root.dir = dir; root.setAttribute("chromedir", dir); root.style.colorScheme = theme;
        root.setAttribute("data-fluxion-density", density); flow.dataset.state = state;
        browser.style.setProperty("--fluxion-sidebar-width", `${width}px`);
        const scroll = q(".fluxion-tab-scroll");
        scroll.scrollTop = 0;
        const headerBefore = box(".fluxion-workspace-heading").top;
        scroll.scrollTop = scroll.scrollHeight;
        const tab = box(".fluxion-tab"), newTab = box(".fluxion-new-tab");
        const context = { dir, theme, state, density, width };
        const check = (condition, message) => { if (!condition) report.errors.push({ ...context, message }); };
        check(Math.abs(headerBefore - box(".fluxion-workspace-heading").top) <= 0.5, "heading moved with tab scroll");
        check(["left", "width", "height"].every(key => Math.abs(tab[key] - newTab[key]) <= 0.5), "tab and New Tab targets differ");
        check(box(".fluxion-workspaces").bottom <= box(".fluxion-surface").bottom + 0.5, "dock clipped");
        check(getComputedStyle(q(".fluxion-new-tab")).transitionDuration === "0s", "reduced motion ignored");
        if (q(".fluxion-folders").children.length) {
          check(box(".fluxion-folders").bottom <= box(".fluxion-workspace-divider").top + 0.5, "folders overlap workspace divider");
          check(box(".fluxion-folders").top >= box(".fluxion-workspace-heading").bottom - 0.5, "folders overlap workspace heading");
          check(q(".fluxion-folders").clientWidth >= q(".fluxion-folders").scrollWidth, "folders overflow horizontally");
        }
        report.cases++;
      }
  const result = document.createElement("pre");
  result.id = "sidebar-layout-results";
  result.textContent = JSON.stringify(report);
  document.body.appendChild(result);
  window.sidebarLayoutReport = report;
})();
