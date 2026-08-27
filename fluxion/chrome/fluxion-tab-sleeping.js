/* global gBrowser, Services, FluxionTabSleepingPolicy */
(function initialiseFluxionTabSleeping(window) {
  "use strict";

  if (window.FluxionTabSleeping) return;
  const { PrivateBrowsingUtils } = ChromeUtils.importESModule(
    "resource://gre/modules/PrivateBrowsingUtils.sys.mjs",
  );
  const PREF_MINUTES = "fluxion.tabs.sleepMinutes";
  let timer = 0;
  let running = false;

  function minutes() {
    return FluxionTabSleepingPolicy.normaliseMinutes(
      Services.prefs.getIntPref(PREF_MINUTES, 30),
    );
  }

  function tabState(tab, now, minimumIdleMs) {
    const browser = tab?.linkedBrowser;
    return {
      busy: tab?.hasAttribute("busy"),
      closing: Boolean(tab?.closing),
      discarded: !tab?.linkedPanel || tab?.hasAttribute("pending"),
      lastAccessed: Number(tab?.lastAccessed),
      minimumIdleMs,
      now,
      pinned: Boolean(tab?.pinned),
      playingAudio: Boolean(tab?.soundPlaying || tab?.pictureinpicture),
      privateWindow: PrivateBrowsingUtils.isWindowPrivate(window),
      selected: tab === gBrowser.selectedTab,
      sharing: Boolean(tab?.sharingState || browser?.getAttribute("sharing")),
      split: Boolean(tab?.splitview),
    };
  }

  async function sleep(tab, { forceAge = false } = {}) {
    const threshold = minutes() * 60_000;
    if (!threshold && !forceAge) return false;
    const now = Date.now();
    if (!FluxionTabSleepingPolicy.canSleep(tab, tabState(tab, now, forceAge ? 0 : threshold))) {
      return false;
    }
    // Gecko flushes SessionStore first and refuses pages with beforeunload
    // handlers or active tab dialogs. Never force-discard: unsaved forms win.
    await gBrowser.prepareDiscardBrowser(tab);
    const discarded = gBrowser.discardBrowser(tab, false);
    if (discarded) {
      tab.setAttribute("fluxion-sleeping", "true");
      gBrowser.tabContainer.dispatchEvent(new CustomEvent("FluxionTabSleep", {
        bubbles: true,
        detail: { tab },
      }));
    }
    return discarded;
  }

  async function run() {
    if (running || !minutes() || PrivateBrowsingUtils.isWindowPrivate(window)) return 0;
    running = true;
    let count = 0;
    try {
      for (const tab of gBrowser.tabs) {
        if (await sleep(tab)) count++;
      }
    } finally {
      running = false;
    }
    return count;
  }

  function schedule() {
    window.clearTimeout(timer);
    const delay = FluxionTabSleepingPolicy.nextCheckDelay(minutes());
    if (delay) timer = window.setTimeout(async () => { await run(); schedule(); }, delay);
  }

  function setMinutes(value) {
    const next = FluxionTabSleepingPolicy.normaliseMinutes(value);
    Services.prefs.setIntPref(PREF_MINUTES, next);
    Services.prefs.savePrefFile(null);
    schedule();
    return next;
  }

  function wake(tab) {
    if (!tab?.parentNode) return false;
    tab.removeAttribute("fluxion-sleeping");
    gBrowser.selectedTab = tab;
    return true;
  }

  gBrowser.tabContainer.addEventListener("TabSelect", event => {
    event.target.removeAttribute("fluxion-sleeping");
  });
  window.addEventListener("unload", () => window.clearTimeout(timer), { once: true });
  window.FluxionTabSleeping = Object.freeze({ minutes, run, setMinutes, sleep, wake });
  schedule();
  Services.prefs.setStringPref("fluxion.sleeping.health", "native-discard-scheduler-loaded");
  Services.prefs.savePrefFile(null);

  if (Services.env.get("FLUXION_VISUAL_SLEEP_TEST") === "1") {
    window.setTimeout(async () => {
      const candidate = [...gBrowser.tabs].find(tab =>
        tab !== gBrowser.selectedTab && !tab.pinned && !tab.splitview && tab.linkedPanel
      );
      if (candidate && await sleep(candidate, { forceAge: true })) {
        Services.prefs.setStringPref("fluxion.sleeping.visual.health", "native-tab-discarded");
        Services.prefs.savePrefFile(null);
      }
    }, 1800);
  }
})(window);
