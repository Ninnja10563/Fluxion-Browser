(function exposeFlowMenuSession(scope) {
  "use strict";

  function create({ snapshot = value => value, validate = () => true,
    restore = () => {}, cancelNative = () => {}, schedule = callback => queueMicrotask(callback) } = {}) {
    let active = null;
    let revision = 0;
    let disposed = false;

    function valid(session) {
      try { return Boolean(validate(session.context, session.root)); }
      catch (_) { return false; }
    }

    function deferRestore(session, reason) {
      const expected = revision;
      schedule(() => {
        if (!disposed && !active && revision === expected) {
          // The chrome owner resolves a replacement row/fallback and checks
          // current focus ownership; stale native nodes are not focused here.
          restore(session.context, session.root, { reason });
        }
      });
    }

    function end({ hide = false, restoreFocus = false, reason = "cancel" } = {}) {
      const session = active;
      if (!session) return false;
      active = null;
      revision += 1;
      // Clear first: hidePopup can synchronously dispatch popuphidden.
      if (hide) cancelNative(session.root);
      if (restoreFocus && !session.claimed) deferRestore(session, reason);
      return true;
    }

    function begin(root, input) {
      if (disposed || !root) return null;
      end({ hide: true });
      revision += 1;
      const value = snapshot(input, root);
      if (!value || typeof value !== "object") return null;
      const context = Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) =>
        [key, Array.isArray(item) ? Object.freeze([...item]) : item])));
      const session = { root, context, claimed: false };
      if (!valid(session)) return null;
      active = session;
      return context;
    }

    function reconcile() {
      if (!active || disposed) return false;
      if (active.claimed || valid(active)) return true;
      end({ hide: true, restoreFocus: true, reason: "invalidated" });
      return false;
    }

    function context(root) {
      if (active?.root !== root || !reconcile()) return null;
      return active.context;
    }

    function beforeCommand(root) {
      if (active?.root !== root || active.claimed || !reconcile()) return null;
      // Firefox 155 executes command before popuphidden on both XUL and
      // Cocoa (nsMenuX::MenuClosedAsync). Claim before action code mutates
      // tabs, opens a modal prompt, or moves focus to another window.
      active.claimed = true;
      return active.context;
    }

    function afterHidden(root) {
      if (active?.root !== root) return false;
      return end({ restoreFocus: true });
    }

    function dispose() {
      if (disposed) return;
      disposed = true;
      revision += 1;
      end({ hide: true });
    }

    return Object.freeze({ begin, context, beforeCommand, afterHidden, reconcile, dispose });
  }

  scope.FluxionFlowMenuSession = Object.freeze({ create });
  if (typeof module !== "undefined" && module.exports) module.exports = scope.FluxionFlowMenuSession;
})(typeof globalThis === "object" ? globalThis : this);
