/* exported FluxionWorkspaceSwipe */
(function exposeWorkspaceSwipe(scope) {
  "use strict";

  const DEFAULTS = Object.freeze({ threshold: 56, axisSlop: 12, axisRatio: 1.35,
    diagonalLimit: 24, idle: 220, tailDelta: 4, restartDelta: 24 });

  function create() {
    let last = -Infinity, x = 0, y = 0, axis = null, firedDirection = 0, reverse = 0, quietTail = 0;
    function reset() {
      last = -Infinity; x = 0; y = 0; axis = null; firedDirection = 0; reverse = 0; quietTail = 0;
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
      const dx = deltaX * scale, dy = deltaY * scale;
      if (firedDirection) {
        if (Math.abs(dx) <= DEFAULTS.tailDelta) quietTail++;
        // WheelEvent does not expose macOS gesture phases. A fresh strong
        // impulse after a decayed tail can begin another gesture without an
        // artificial idle wait; constant or decaying inertia cannot do so.
        else if (quietTail >= 2 && Math.abs(dx) >= DEFAULTS.restartDelta && Math.abs(dx) >= Math.abs(dy) * DEFAULTS.axisRatio) {
          x = 0; y = 0; firedDirection = 0; reverse = 0; quietTail = 0;
        } else quietTail = 0;
        if (firedDirection) {
          if (Math.sign(dx) === -firedDirection && Math.abs(dx) >= Math.abs(dy) * DEFAULTS.axisRatio) reverse += Math.abs(dx);
          else if (Math.sign(dx) === firedDirection) reverse = 0;
          if (reverse >= DEFAULTS.threshold) {
            // A purposeful reversal is new input, not the old direction's
            // momentum. Small opposite-direction jitter never reaches this.
            firedDirection *= -1;
            reverse = 0; quietTail = 0;
            return { consume: true, direction: firedDirection };
          }
          return { consume: true, direction: 0 };
        }
      }
      x += dx;
      y += dy;
      if (!axis) {
        if (Math.max(Math.abs(x), Math.abs(y)) < DEFAULTS.axisSlop) return { consume: false, direction: 0 };
        if (Math.abs(x) >= Math.abs(y) * DEFAULTS.axisRatio) axis = "horizontal";
        else if (Math.abs(y) >= Math.abs(x) * DEFAULTS.axisRatio || Math.max(Math.abs(x), Math.abs(y)) >= DEFAULTS.diagonalLimit) axis = "vertical";
        // A few diagonal pixels at touch-down must not permanently lock an
        // otherwise horizontal swipe. Pending input remains native scrolling.
      }
      if (axis !== "horizontal") return { consume: false, direction: 0 };
      let direction = 0;
      if (Math.abs(x) >= DEFAULTS.threshold) {
        direction = Math.sign(x);
        firedDirection = direction;
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
