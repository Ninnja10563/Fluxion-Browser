/* exported FluxionWorkspaceSwipe */
(function exposeWorkspaceSwipe(scope) {
  "use strict";

  const DEFAULTS = Object.freeze({ threshold: 56, axisSlop: 8, axisRatio: 1.35, idle: 220 });

  function create() {
    let last = -Infinity, x = 0, y = 0, axis = null, fired = false;
    function reset() {
      last = -Infinity; x = 0; y = 0; axis = null; fired = false;
    }
    function advance(time) {
      if (!Number.isFinite(time)) return false;
      if (time < last || time - last >= DEFAULTS.idle) reset();
      last = time;
      return true;
    }
    function block(time) {
      // Keep rejected events in the same gesture: releasing a modifier or
      // closing a popup must not turn its remaining momentum into a switch.
      if (advance(time)) axis = "blocked";
    }
    function push({ deltaX, deltaY, deltaMode = 0, time }) {
      if (!advance(time)) return { consume: false, direction: 0 };
      if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY) || ![0, 1].includes(deltaMode)) {
        axis = "blocked";
      }
      if (axis === "blocked" || axis === "vertical") return { consume: false, direction: 0 };
      const scale = deltaMode === 1 ? 16 : 1;
      x += deltaX * scale;
      y += deltaY * scale;
      if (!axis) {
        if (Math.max(Math.abs(x), Math.abs(y)) < DEFAULTS.axisSlop) return { consume: false, direction: 0 };
        // Ambiguous diagonals belong to scrolling, not workspace navigation.
        axis = Math.abs(x) >= Math.abs(y) * DEFAULTS.axisRatio ? "horizontal" : "vertical";
      }
      if (axis !== "horizontal") return { consume: false, direction: 0 };
      let direction = 0;
      if (!fired && Math.abs(x) >= DEFAULTS.threshold) {
        fired = true;
        direction = Math.sign(x);
      }
      return { consume: true, direction };
    }
    return Object.freeze({ push, block, reset });
  }

  function adjacent(workspaces, current, direction) {
    if (!Array.isArray(workspaces) || ![-1, 1].includes(direction)) return null;
    const index = workspaces.findIndex(workspace => workspace.id === current);
    return index < 0 ? null : workspaces[index + direction]?.id ?? null;
  }

  const api = Object.freeze({ DEFAULTS, create, adjacent });
  scope.FluxionWorkspaceSwipe = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis === "object" ? globalThis : this);
