/* global Services, FluxionThemeCore, ChromeUtils, Cu */
(function initialiseFluxionTheme(window) {
  "use strict";

  if (!window.gBrowser || window.FluxionTheme) return;
  const ACTIVE_THEME_PREF = "extensions.activeThemeID";
  const { AddonManager } = ChromeUtils.importESModule(
    "resource://gre/modules/AddonManager.sys.mjs",
  );
  const { BuiltInThemes } = ChromeUtils.importESModule(
    "resource:///modules/BuiltInThemes.sys.mjs",
  );
  let request = 0;
  let applyChain = Promise.resolve();

  function current() {
    return FluxionThemeCore.choiceForId(Services.prefs.getStringPref(
      ACTIVE_THEME_PREF,
      FluxionThemeCore.THEME_IDS.system,
    ));
  }

  function project(choice = current()) {
    const root = window.document.documentElement;
    if (choice === "light" || choice === "dark") root.style.colorScheme = choice;
    else root.style.removeProperty("color-scheme");
    root.dataset.fluxionTheme = choice;
    window.dispatchEvent(new window.CustomEvent("FluxionThemeChanged", {
      detail: { choice },
    }));
    return choice;
  }

  function set(choice) {
    const next = FluxionThemeCore.normaliseChoice(choice);
    const token = ++request;
    const operation = applyChain.catch(() => {}).then(async () => {
      if (token !== request) return current();
      await BuiltInThemes.ensureBuiltInThemes();
      if (token !== request) return current();
      const id = FluxionThemeCore.idForChoice(next);
      const addon = await AddonManager.getAddonByID(id);
      if (!addon || addon.type !== "theme") throw new Error("The selected Gecko theme is unavailable.");
      await addon.enable();
      Services.prefs.savePrefFile(null);
      return project(next);
    });
    applyChain = operation;
    return operation;
  }

  const prefObserver = { observe: () => project() };
  Services.prefs.addObserver(ACTIVE_THEME_PREF, prefObserver);
  window.addEventListener("unload", () => {
    Services.prefs.removeObserver(ACTIVE_THEME_PREF, prefObserver);
  }, { once: true });

  window.FluxionTheme = Object.freeze({ current, set });
  project();
  Services.prefs.setStringPref("fluxion.theme.health", "gecko-built-in-theme-controller-ready");
  Services.prefs.savePrefFile(null);

  if (Services.env.get("FLUXION_VISUAL_THEME_TEST") === "1") {
    let ran = false;
    const runThemeGate = async () => {
      if (ran) return;
      ran = true;
      try {
        await set("dark");
        const tab = window.gBrowser.addTrustedTab("about:preferences#appearance");
        window.FluxionUI.setTabWorkspace(tab, window.FluxionUI.currentWorkspace());
        window.gBrowser.selectedTab = tab;
        window.setTimeout(() => {
          const control = window.document.getElementById("fluxion-theme-choice");
          const flowRect = window.document.getElementById("fluxion-flow")?.getBoundingClientRect();
          const settingsRect = window.document.getElementById("fluxion-settings")?.getBoundingClientRect();
          const navRect = window.document.querySelector(".fluxion-settings-nav")?.getBoundingClientRect();
          const mainRect = window.document.querySelector(".fluxion-settings-main")?.getBoundingClientRect();
          const activeId = Services.prefs.getStringPref(ACTIVE_THEME_PREF, "");
          const computed = window.getComputedStyle(window.document.documentElement).colorScheme;
          if (
            activeId === FluxionThemeCore.THEME_IDS.dark &&
            current() === "dark" && control?.value === "dark" && computed.includes("dark") &&
            settingsRect?.left >= flowRect?.right - 1 &&
            navRect?.left >= settingsRect?.left - 1 && navRect?.width >= 150 &&
            mainRect?.left >= navRect?.right - 1 && mainRect?.width >= 360
          ) {
            Services.prefs.setStringPref(
              "fluxion.theme.visual.health",
              "dark-theme-enabled-in-live-gecko-chrome",
            );
            Services.prefs.setStringPref(
              "fluxion.settings.geometry.visual.health",
              "settings-nav-and-content-clear-flow",
            );
            window.dispatchEvent(new window.CustomEvent("FluxionThemeVisualReady"));
          } else {
            Services.prefs.setStringPref(
              "fluxion.theme.visual.error",
              `active=${activeId} current=${current()} control=${control?.value} scheme=${computed} ` +
                `flow=${flowRect?.left},${flowRect?.right} settings=${settingsRect?.left},${settingsRect?.right} ` +
                `nav=${navRect?.left},${navRect?.right} main=${mainRect?.left},${mainRect?.right}`,
            );
          }
          Services.prefs.savePrefFile(null);
        }, 500);
      } catch (error) {
        Services.prefs.setStringPref("fluxion.theme.visual.error", String(error));
        Services.prefs.savePrefFile(null);
        Cu.reportError(error);
      }
    };
    window.addEventListener("FluxionWebSearchVisualReady", () => {
      runThemeGate().catch(Cu.reportError);
    }, { once: true });
    window.setTimeout(() => runThemeGate().catch(Cu.reportError), 65000);
  }
})(window);
