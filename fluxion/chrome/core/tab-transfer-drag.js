(function initialiseTransferDrag(global) {
  "use strict";
  const TYPE = "application/x-fluxion-tab";
  const LIMIT = 2048;

  function write(transfer, tabs) {
    if (!transfer?.mozSetDataAt || !tabs?.length || tabs.length > LIMIT) return false;
    try {
      tabs.forEach((tab, index) => transfer.mozSetDataAt(TYPE, tab, index));
      transfer.effectAllowed = "move";
      return true;
    } catch (_) {
      // Never expose a successfully written prefix as a smaller selection if
      // Gecko rejects a later item during serialization.
      for (let index = tabs.length - 1; index >= 0; index--) {
        try { transfer.mozClearDataAt?.(TYPE, index); } catch (_) {}
      }
      try { transfer.clearData?.(TYPE); } catch (_) {}
      return false;
    }
  }

  function read(transfer, isBrowserTab) {
    const count = transfer?.mozItemCount;
    if (!Number.isInteger(count) || count < 1 || count > LIMIT || !transfer.mozGetDataAt) return [];
    try {
      const tabs = Array.from({ length: count }, (_, index) => transfer.mozGetDataAt(TYPE, index));
      if (new Set(tabs).size !== count || tabs.some(tab => !isBrowserTab(tab))) return [];
      const source = tabs[0].ownerGlobal;
      return tabs.every(tab => tab.ownerGlobal === source) ? tabs : [];
    } catch (_) { return []; }
  }

  function shouldDetach({ trusted, canceled, effect, screenX, screenY, windows }) {
    if (trusted !== true || canceled !== false || effect !== "none" ||
        !Number.isFinite(screenX) || !Number.isFinite(screenY) || !windows?.length) return false;
    // A rejected drop inside another browser, including a private window, must
    // not unexpectedly create a third window. Invalid geometry fails closed.
    for (const rect of windows) {
      if (![rect.left, rect.top, rect.width, rect.height].every(Number.isFinite) ||
          rect.width <= 0 || rect.height <= 0) return false;
      if (screenX >= rect.left && screenX <= rect.left + rect.width &&
          screenY >= rect.top && screenY <= rect.top + rect.height) return false;
    }
    return true;
  }

  const api = Object.freeze({ TYPE, LIMIT, write, read, shouldDetach });
  global.FluxionTransferDrag = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
