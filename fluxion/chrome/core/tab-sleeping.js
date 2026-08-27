/* exported FluxionTabSleepingPolicy */
(function exposeTabSleepingPolicy(scope) {
  "use strict";

  const INTERVALS = Object.freeze([0, 5, 15, 30, 60]);

  function normaliseMinutes(value) {
    const minutes = Number.parseInt(value, 10);
    return INTERVALS.includes(minutes) ? minutes : 30;
  }

  function canSleep(tab, options = {}) {
    if (!tab || options.privateWindow || options.selected || options.pinned ||
        options.closing || options.busy || options.discarded || options.split ||
        options.playingAudio || options.sharing) return false;
    return Number.isFinite(options.lastAccessed) &&
      Number.isFinite(options.now) &&
      options.now - options.lastAccessed >= options.minimumIdleMs;
  }

  function nextCheckDelay(minutes) {
    const normalised = normaliseMinutes(minutes);
    if (!normalised) return 0;
    return Math.min(60_000, Math.max(15_000, normalised * 60_000 / 4));
  }

  scope.FluxionTabSleepingPolicy = Object.freeze({
    INTERVALS,
    canSleep,
    nextCheckDelay,
    normaliseMinutes,
  });
})(typeof globalThis === "object" ? globalThis : this);
