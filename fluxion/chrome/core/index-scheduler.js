/* global globalThis */
(function exposeIndexScheduler(scope) {
  "use strict";

  class IndexScheduler {
    constructor({
      run,
      canRun = () => ({ ok: true }),
      now = () => Date.now(),
      setTimer = (callback, delay) => setTimeout(callback, delay),
      clearTimer = handle => clearTimeout(handle),
      quietMs = 4000,
      retryMs = 5000,
      maxQueue = 64,
    } = {}) {
      if (typeof run !== "function") throw new TypeError("IndexScheduler requires a run function");
      this.run = run;
      this.canRun = canRun;
      this.now = now;
      this.setTimer = setTimer;
      this.clearTimer = clearTimer;
      this.quietMs = quietMs;
      this.retryMs = retryMs;
      this.maxQueue = maxQueue;
      this.queue = new Map();
      this.lastActivity = now();
      this.deferredUntil = 0;
      this.deferReason = "";
      this.running = false;
      this.timer = null;
      this.destroyed = false;
    }

    enqueue(key, value = key) {
      if (this.destroyed || key == null) return false;
      this.queue.delete(key);
      this.queue.set(key, value);
      while (this.queue.size > this.maxQueue) this.queue.delete(this.queue.keys().next().value);
      this.schedule(Math.max(0, this.quietMs - (this.now() - this.lastActivity)));
      return true;
    }

    notifyActivity() {
      if (this.destroyed) return;
      this.lastActivity = this.now();
      if (this.queue.size) this.schedule(this.quietMs);
    }

    defer(reason, milliseconds) {
      if (this.destroyed) return;
      this.deferredUntil = Math.max(this.deferredUntil, this.now() + Math.max(0, milliseconds));
      this.deferReason = String(reason || "deferred");
      if (this.queue.size) this.schedule(milliseconds);
    }

    resume(reason = "") {
      if (this.destroyed || (reason && this.deferReason !== reason)) return false;
      this.deferredUntil = 0;
      this.deferReason = "";
      this.wake();
      return true;
    }

    wake() {
      if (this.destroyed || !this.queue.size) return;
      this.schedule(0);
    }

    clear() {
      this.queue.clear();
      if (this.timer != null) this.clearTimer(this.timer);
      this.timer = null;
    }

    destroy() {
      this.destroyed = true;
      this.clear();
    }

    status() {
      return Object.freeze({
        queued: this.queue.size,
        running: this.running,
        deferredUntil: this.deferredUntil,
        deferReason: this.deferReason,
      });
    }

    schedule(delay) {
      if (this.destroyed || this.running || !this.queue.size) return;
      if (this.timer != null) this.clearTimer(this.timer);
      this.timer = this.setTimer(() => {
        this.timer = null;
        this.pump().catch(error => scope.Cu?.reportError?.(error));
      }, Math.max(0, Number(delay) || 0));
    }

    async pump() {
      if (this.destroyed || this.running || !this.queue.size) return false;
      const now = this.now();
      const quietRemaining = this.quietMs - (now - this.lastActivity);
      if (quietRemaining > 0) {
        this.schedule(quietRemaining);
        return false;
      }
      if (now < this.deferredUntil) {
        this.schedule(this.deferredUntil - now);
        return false;
      }
      this.deferredUntil = 0;
      this.deferReason = "";
      const gate = this.canRun(this.status()) || { ok: true };
      if (!gate.ok) {
        this.deferReason = String(gate.reason || "policy");
        this.schedule(Math.max(250, Number(gate.retryIn) || this.retryMs));
        return false;
      }
      const [key, value] = this.queue.entries().next().value;
      this.queue.delete(key);
      this.running = true;
      try {
        await this.run(value, key);
      } finally {
        this.running = false;
        if (this.queue.size) this.schedule(0);
      }
      return true;
    }
  }

  const api = Object.freeze({ IndexScheduler });
  scope.FluxionIndexScheduler = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis === "object" ? globalThis : this);
