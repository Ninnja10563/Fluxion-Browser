/* global Services, FluxionDataClearingCore, ChromeUtils */
(function initialiseFluxionDataClearing(window) {
  "use strict";

  if (!window.gBrowser || window.FluxionDataClearing) return;
  const { Sanitizer } = ChromeUtils.importESModule(
    "resource:///modules/Sanitizer.sys.mjs",
  );

  const controller = FluxionDataClearingCore.createController({
    showUI: mode => Sanitizer.showUI(window, mode),
    onOpen(scope) {
      Services.prefs.setStringPref(
        "fluxion.dataClearing.dialog.health",
        scope === "siteData" ? "gecko-site-data-dialog-opened" : "gecko-browsing-data-dialog-opened",
      );
      Services.prefs.savePrefFile(null);
      window.dispatchEvent(new window.CustomEvent("FluxionDataClearingDialogOpened", {
        detail: { scope },
      }));
    },
    onResult(scope, result) {
      window.dispatchEvent(new window.CustomEvent("FluxionDataClearingDialogClosed", {
        detail: { scope, result },
      }));
    },
  });

  window.FluxionDataClearing = Object.freeze({
    isOpen: controller.isOpen,
    open: () => controller.open("browsingData"),
    openSiteData: () => controller.open("siteData"),
  });
  Services.prefs.setStringPref(
    "fluxion.dataClearing.health",
    "native-gecko-sanitizer-ready",
  );
  Services.prefs.savePrefFile(null);

})(window);
