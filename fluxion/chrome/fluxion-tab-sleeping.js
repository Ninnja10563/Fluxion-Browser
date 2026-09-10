/* global Cu, gBrowser, Services, FluxionTabSleepingPolicy */
(function initialiseFluxionTabSleeping(window) {
  "use strict";

  if (window.FluxionTabSleeping) return;
  const { PrivateBrowsingUtils } = ChromeUtils.importESModule(
    "resource://gre/modules/PrivateBrowsingUtils.sys.mjs",
  );
  const PREF_MINUTES = "fluxion.tabs.sleepMinutes";
  let timer = 0;
  let running = false;
  let destroyed = false;
  const pending = new WeakSet();
  let preferenceRevision = 0;

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
    if (destroyed || !tab || pending.has(tab) || ![...gBrowser.tabs].includes(tab)) return false;
    const scheduledMinutes = minutes();
    const threshold = scheduledMinutes * 60_000;
    if (!threshold && !forceAge) return false;
    const now = Date.now();
    if (!FluxionTabSleepingPolicy.canSleep(tab, tabState(tab, now, forceAge ? 0 : threshold))) {
      return false;
    }
    const scheduledRevision = preferenceRevision;
    const browser = tab.linkedBrowser;
    pending.add(tab);
    try {
      // Flushes can overlap playback, capture, navigation, or preference changes.
      // Gecko's final guard protects beforeunload/dialogs, but not all of ours.
      await gBrowser.prepareDiscardBrowser(tab);
      const currentMinutes = minutes();
      const currentThreshold = currentMinutes * 60_000;
      if (destroyed || scheduledRevision !== preferenceRevision ||
          currentMinutes !== scheduledMinutes ||
          (!currentThreshold && !forceAge) || ![...gBrowser.tabs].includes(tab) ||
          tab.linkedBrowser !== browser ||
          !FluxionTabSleepingPolicy.canSleep(tab, tabState(tab, Date.now(), forceAge ? 0 : currentThreshold))) {
        return false;
      }
      const discarded = gBrowser.discardBrowser(tab, false);
      if (discarded) {
        tab.setAttribute("fluxion-sleeping", "true");
        gBrowser.tabContainer.dispatchEvent(new CustomEvent("FluxionTabSleep", {
          bubbles: true,
          detail: { tab },
        }));
      }
      return discarded;
    } finally {
      pending.delete(tab);
    }
  }

  async function run() {
    if (destroyed || running || !minutes() || PrivateBrowsingUtils.isWindowPrivate(window)) return 0;
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
    if (destroyed) return;
    const delay = FluxionTabSleepingPolicy.nextCheckDelay(minutes());
    if (delay) timer = window.setTimeout(async () => {
      try { await run(); } catch (error) { Cu.reportError(error); }
      finally { schedule(); }
    }, delay);
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
  const preferenceObserver = {
    observe() {
      preferenceRevision += 1;
      schedule();
    },
  };
  Services.prefs.addObserver(PREF_MINUTES, preferenceObserver);
  window.addEventListener("unload", () => {
    destroyed = true;
    window.clearTimeout(timer);
    Services.prefs.removeObserver(PREF_MINUTES, preferenceObserver);
  }, { once: true });
  window.FluxionTabSleeping = Object.freeze({ minutes, run, setMinutes, sleep, wake });
  schedule();
  Services.prefs.setStringPref("fluxion.sleeping.health", "native-discard-scheduler-loaded");
  Services.prefs.savePrefFile(null);

  if (Services.env.get("FLUXION_VISUAL_SLEEP_TEST") === "1") {
    window.setTimeout(async () => {
      const fixtureURL = "https://example.com/?fluxion-sleep-race-test=1";
      const candidate = gBrowser.addTrustedTab(fixtureURL, { skipAnimation: true });
      window.FluxionUI.setTabWorkspace(candidate, window.FluxionUI.currentWorkspace());
      try {
        for (let attempt = 0; attempt < 100 &&
            (candidate.hasAttribute("busy") || candidate.linkedBrowser?.currentURI?.spec !== fixtureURL); attempt += 1) {
          await new Promise(resolve => window.setTimeout(resolve, 100));
        }
        if (candidate.hasAttribute("busy") || candidate.linkedBrowser?.currentURI?.spec !== fixtureURL) {
          throw new Error("The sleep race fixture did not finish its HTTPS navigation");
        }
        const originalBrowser = candidate.linkedBrowser;
        const sleeping = sleep(candidate, { forceAge: true });
        if (!pending.has(candidate)) throw new Error("The sleep race fixture did not enter native state flushing");
        // The async flush is now pending. Pin through Gecko before the sleeping
        // continuation can run; this must protect the still-live browser.
        gBrowser.pinTab(candidate);
        if (await sleeping || !candidate.linkedPanel || candidate.linkedBrowser !== originalBrowser) {
          throw new Error("Pinning during state flushing did not prevent native discard");
        }
        Services.prefs.setStringPref("fluxion.sleeping.race.health", "pin-during-flush-kept-native-tab-live");
        gBrowser.unpinTab(candidate);
        if (!(await sleep(candidate, { forceAge: true }))) {
          throw new Error("The unpinned eligible fixture did not discard through Gecko");
        }
        Services.prefs.setStringPref("fluxion.sleeping.visual.health", "native-tab-discarded");
        Services.prefs.savePrefFile(null);
      } catch (error) {
        Services.prefs.setStringPref("fluxion.sleeping.error", String(error));
        Services.prefs.savePrefFile(null);
        Cu.reportError(error);
      } finally {
        if ([...gBrowser.tabs].includes(candidate) && !candidate.closing) {
          gBrowser.removeTab(candidate, { animate: false, skipSessionStore: true });
        }
      }
    }, 1800);
  }
})(window);
