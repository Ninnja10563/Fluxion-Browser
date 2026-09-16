const INTERVAL = 5 * 60 * 1000;
const ACTIVE = new Set(["checking-install", "downloading", "extracting", "installing", "retry"]);

// One coordinator per browser process, not one timer/request per window.
// All platform IO is injected; this state machine never handles executable bytes.
export class UpdateCoordinator {
  constructor({ installed, platform, checkRelease, installer, automatic = () => true,
    setAutomatic, online = () => true, now = () => Date.now(), setTimer, clearTimer }) {
    Object.assign(this, { installed, platform, checkRelease, installer, automatic, saveAutomatic: setAutomatic,
      online, now, setTimer, clearTimer });
    this.views = new Map(); this.nextView = 0; this.failures = 0;
    this.checkTimer = null; this.pollTimer = null; this.request = null; this.disposed = false;
    this.snapshot = Object.freeze({ state: "idle", installed, detail: `Installed ${installed}. Not checked.`,
      progress: null, canInstall: false, canCancel: false, canRetry: false, canCheck: true, automatic: automatic() });
  }
  getState() { return this.snapshot; }
  publish(update, replace = false) {
    if (this.disposed) return;
    this.snapshot = Object.freeze({ ...(replace ? { installed: this.installed, progress: null,
      canInstall: false, canCancel: false, canRetry: false, canCheck: true } : this.snapshot),
    ...update, automatic: this.automatic() });
    for (const { callback } of this.views.values()) { try { callback(this.snapshot); } catch (_) {} }
  }
  watch(callback, normal = true) {
    if (this.disposed) return () => {};
    const id = ++this.nextView;
    this.views.set(id, { callback, normal });
    callback(this.snapshot);
    this.schedule(30000);
    return () => { this.views.delete(id); if (![...this.views.values()].some(v => v.normal)) this.stopChecking(); };
  }
  stopChecking() {
    if (this.checkTimer !== null) this.clearTimer(this.checkTimer);
    this.checkTimer = null;
  }
  schedule(delay = INTERVAL) {
    if (this.disposed || this.checkTimer !== null || !this.automatic() || this.platform !== "Darwin" ||
        ![...this.views.values()].some(v => v.normal) || ACTIVE.has(this.snapshot.state)) return;
    const retryDelay = Math.max(0, (this.snapshot.retryAt || 0) - this.now());
    this.checkTimer = this.setTimer(() => {
      this.checkTimer = null;
      this.check().catch(() => {});
    }, Math.max(delay, retryDelay));
  }
  configureAutomatic(value) {
    this.saveAutomatic(Boolean(value));
    this.stopChecking(); this.publish({ automatic: this.automatic() }); this.schedule(30000);
  }
  check() {
    if (this.disposed || ACTIVE.has(this.snapshot.state)) return Promise.resolve(this.snapshot);
    if (this.request) return this.request;
    this.stopChecking();
    this.request = Promise.resolve().then(() => this.online()
      ? this.checkRelease(this.installed, this.platform)
      : { state: "unavailable", reason: "offline" }).then(async result => {
      if (this.disposed) return this.snapshot;
      let canInstall = false, installerDetail = "";
      if (result.state === "available") {
        try {
          const capability = await this.installer.prepare();
          canInstall = capability.canInstall === true;
          installerDetail = capability.detail || "";
        } catch (_) { installerDetail = "Automatic installation is unavailable. You can download the DMG manually."; }
      }
      if (this.disposed) return this.snapshot;
      const error = result.state === "unavailable" && result.reason;
      this.failures = error ? Math.min(this.failures + 1, 4) : 0;
      const detail = result.state === "available"
        ? `${result.latest} is available.${canInstall ? " Update and restart when you are ready." : ` ${installerDetail}`}`
        : result.state === "current" ? `No newer compatible release found. Installed ${this.installed}.${result.latest ? ` Latest published: ${result.latest}.` : ""}`
          : result.state === "unsupported" ? "Packaged update downloads are available for macOS only."
            : error ? ({ offline: "You are offline. Fluxion will check again later.", "invalid-feed": "The update feed expired or could not be verified.",
              "rate-limit": "The update server temporarily refused the request. Fluxion will respect its retry time." }[result.reason] || "Could not safely check for updates. Try again later.")
              : "No compatible downloadable release was found.";
      this.publish({ ...result, state: error ? "error" : result.state, detail, canInstall, canCheck: true,
        checkedAt: this.now() }, true);
      return this.snapshot;
    }).catch(() => {
      this.failures = Math.min(this.failures + 1, 4);
      this.publish({ state: "error", reason: "network", detail: "Could not check for updates. Try again later.", canCheck: true }, true);
      return this.snapshot;
    }).finally(() => {
      this.request = null;
      this.schedule(INTERVAL * Math.min(2 ** this.failures, 6));
    });
    this.publish({ state: "checking", detail: "Checking Fluxion’s verified release feed…", canCheck: false }, true);
    return this.request;
  }
  async install() {
    if (this.disposed || this.snapshot.state !== "available" || !this.snapshot.canInstall) return;
    // Consent belongs to the displayed version. An old offer must be refreshed
    // and clicked again, never silently substituted with another executable.
    if (this.now() - this.snapshot.checkedAt > 2 * INTERVAL) { await this.check(); return; }
    const version = this.snapshot.latest;
    this.stopChecking();
    this.publish({ state: "checking-install", canCheck: false, canInstall: false, canCancel: false,
      detail: "Verifying the signed update offer…" });
    try {
      await this.installer.command({ action: "install", version, consent: true,
        channel: version.includes("-preview.") ? "preview" : "stable" });
      this.poll();
    } catch (_) { this.publish({ state: "error", canCheck: true, detail: "The native updater could not start. Your installed app is unchanged." }); this.schedule(); }
  }
  poll(delay = 250) {
    if (this.disposed || this.pollTimer !== null) return;
    this.pollTimer = this.setTimer(async () => {
      this.pollTimer = null;
      if (this.disposed) return;
      try {
        const state = await this.installer.getState();
        if (this.disposed) return;
        const allowed = new Set(["idle", "current", "checking", "downloading", "extracting", "installing", "retry", "error", "unsupported", "canceled"]);
        if (!allowed.has(state.state)) throw new Error("Unknown native updater state");
        const mapped = state.state === "checking" ? "checking-install" : state.state;
        this.publish({ state: mapped, detail: String(state.detail || "Updating Fluxion…").slice(0, 500),
          progress: Number.isFinite(state.progress) ? Math.max(0, Math.min(1, state.progress)) : null,
          canCancel: state.canCancel === true, canRetry: state.canRetry === true,
          canCheck: !ACTIVE.has(mapped), canInstall: false });
        // Sparkle can first report awaiting quit before its retry block is
        // available, and can still report an installer error afterward.
        if (ACTIVE.has(mapped)) this.poll(mapped === "retry" ? 1000 : 250);
        else this.schedule();
      } catch (_) {
        this.publish({ state: "error", detail: "Could not read native update progress. The updater has not been forced to quit.", canCheck: false });
      }
    }, delay);
  }
  async action(action, flag) {
    if (this.disposed || !this.snapshot[flag]) return;
    const version = this.snapshot.latest;
    const command = action === "retry" ? { action, version, consent: true,
      channel: version.includes("-preview.") ? "preview" : "stable" } : { action };
    try { await this.installer.command(command); this.poll(); }
    catch (_) { this.publish({ detail: "The updater could not complete that action. Your session has not been forced closed." }); }
  }
  cancel() { return this.action("cancel", "canCancel"); }
  retry() { return this.action("retry", "canRetry"); }
  dispose() {
    this.disposed = true; this.stopChecking();
    if (this.pollTimer !== null) this.clearTimer(this.pollTimer);
    this.pollTimer = null; this.views.clear();
  }
}
