import { setTimeout, clearTimeout } from "resource://gre/modules/Timer.sys.mjs";
import { PrivateBrowsingUtils } from "resource://gre/modules/PrivateBrowsingUtils.sys.mjs";
import { UpdateCoordinator } from "resource://fluxion/modules/FluxionUpdateCoordinatorCore.sys.mjs";
import { FluxionUpdates } from "resource://fluxion/modules/FluxionUpdates.sys.mjs";
import { FluxionNativeUpdater } from "resource://fluxion/modules/FluxionNativeUpdater.sys.mjs";

const INSTALLED = "0.75.0-preview.1";
const AUTO_PREF = "fluxion.updates.automaticChecks";
const controller = new UpdateCoordinator({ installed: INSTALLED, platform: Services.appinfo.OS,
  checkRelease: (installed, platform) => FluxionUpdates.check(installed, platform), installer: FluxionNativeUpdater,
  automatic: () => Services.prefs.getBoolPref(AUTO_PREF, true),
  setAutomatic(value) {
    if (Services.prefs.prefIsLocked(AUTO_PREF)) return;
    Services.prefs.setBoolPref(AUTO_PREF, value);
  },
  online: () => !Services.io.offline, setTimer: setTimeout, clearTimer: clearTimeout,
});
const preferences = { observe() { controller.stopChecking(); controller.publish({}); controller.schedule(30000); } };
Services.prefs.addObserver(AUTO_PREF, preferences);
const shutdown = { observe() {
  controller.dispose(); Services.prefs.removeObserver(AUTO_PREF, preferences);
  Services.obs.removeObserver(shutdown, "quit-application");
} };
Services.obs.addObserver(shutdown, "quit-application");

export const FluxionUpdateCoordinator = Object.freeze({
  watch(window, callback) {
    const stop = controller.watch(callback, !PrivateBrowsingUtils.isWindowPrivate(window));
    const unload = () => { stop(); window.removeEventListener("unload", unload); };
    window.addEventListener("unload", unload, { once: true });
    return unload;
  },
  getState: () => controller.getState(),
  check: () => controller.check(), install: () => controller.install(),
  cancel: () => controller.cancel(), retry: () => controller.retry(),
  setAutomatic: value => controller.configureAutomatic(value),
});
