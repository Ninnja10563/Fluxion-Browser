/* global globalThis */
(function exposeLibraryNavigation(scope) {
  "use strict";

  function attach(list, { enabled = () => true, canAct = () => true, onMenu = () => {} } = {}) {
    const document = list.ownerDocument;
    let activeId = null;
    let activeIndex = 0;
    let destroyed = false;
    const entries = () => [...list.children].flatMap(row => {
      const primary = row.querySelector?.(".fluxion-library-open");
      return primary && row._fluxionLibraryId ? [{ row, primary,
        more: row.querySelector(".fluxion-library-more") }] : [];
    });
    const owns = (entry, node) => node === entry.primary || node === entry.more ||
      entry.primary.contains(node) || Boolean(entry.more?.contains(node));
    function select(items, index) {
      activeIndex = Math.max(0, Math.min(index, items.length - 1));
      activeId = items[activeIndex]?.row._fluxionLibraryId ?? null;
      for (const [position, entry] of items.entries()) {
        const tabIndex = position === activeIndex ? 0 : -1;
        if (entry.primary.tabIndex !== tabIndex) entry.primary.tabIndex = tabIndex;
        if (entry.more && entry.more.tabIndex !== -1) entry.more.tabIndex = -1;
      }
    }
    function sync({ restoreFocus = false } = {}) {
      if (destroyed || !enabled()) return;
      const items = entries();
      if (!items.length) {
        if (restoreFocus) { list.tabIndex = -1; list.focus({ preventScroll: true }); }
        return;
      }
      const focused = items.findIndex(entry => owns(entry, document.activeElement));
      const remembered = items.findIndex(entry => entry.row._fluxionLibraryId === activeId);
      select(items, focused >= 0 ? focused : remembered >= 0 ? remembered : activeIndex);
      if ((restoreFocus || document.activeElement === list) && focused < 0) {
        items[activeIndex].primary.focus({ preventScroll: true });
      }
    }
    function focusIn(event) {
      if (destroyed || !enabled()) return;
      const items = entries();
      const index = items.findIndex(entry => owns(entry, event.target));
      if (index >= 0) select(items, index);
    }
    function keyDown(event) {
      if (destroyed || !enabled() || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      const menuKey = event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey);
      if (event.shiftKey && !menuKey) return;
      const items = entries();
      const index = items.findIndex(entry => owns(entry, event.target));
      if (index < 0) return;
      const entry = items[index];
      let target = null;
      let next = index;
      if (menuKey) {
        event.preventDefault();
        event.stopPropagation();
        if (canAct()) onMenu(entry.row, event.target === entry.more ? entry.more : entry.primary, event);
        return;
      }
      if (event.key === "ArrowDown") next = Math.min(index + 1, items.length - 1);
      else if (event.key === "ArrowUp") next = Math.max(index - 1, 0);
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = items.length - 1;
      else if (event.key === "ArrowRight") target = entry.more;
      else if (event.key === "ArrowLeft") target = entry.primary;
      else return; // Native buttons retain Enter/Space; Tab leaves this list.
      const vertical = ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key);
      if (vertical) target = items[next].primary;
      if (!target || target.disabled || target.hidden) return;
      event.preventDefault();
      event.stopPropagation();
      select(items, next);
      target.focus({ preventScroll: true });
      if (vertical) items[next].row.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
    }
    list.addEventListener("focusin", focusIn);
    list.addEventListener("keydown", keyDown);
    return Object.freeze({ sync, destroy() {
      destroyed = true;
      list.removeEventListener("focusin", focusIn);
      list.removeEventListener("keydown", keyDown);
    } });
  }
  const api = Object.freeze({ attach });
  scope.FluxionLibraryNavigation = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis === "object" ? globalThis : this);
