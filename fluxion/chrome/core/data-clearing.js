/* global globalThis */
(function exposeDataClearingCore(scope) {
  "use strict";

  const SITE_DATA = "siteData";

  function normaliseScope(value) {
    return value === SITE_DATA ? SITE_DATA : "browsingData";
  }

  function sanitizerMode(scopeName) {
    return normaliseScope(scopeName) === SITE_DATA ? "clearSiteData" : undefined;
  }

  function createController({ showUI, onOpen = () => {}, onResult = () => {} }) {
    if (typeof showUI !== "function") throw new TypeError("showUI must be a function");
    let pending = null;

    function open(scopeName = "browsingData") {
      if (pending) return pending;
      const scope = normaliseScope(scopeName);
      let dialog;
      try {
        dialog = showUI(sanitizerMode(scope));
        onOpen(scope);
      } catch (error) {
        return Promise.reject(error);
      }
      pending = Promise.resolve(dialog)
        .then(value => value === "accept" ? "accept" : "cancel")
        .then(result => {
          onResult(scope, result);
          return result;
        })
        .finally(() => { pending = null; });
      return pending;
    }

    return Object.freeze({
      isOpen: () => Boolean(pending),
      open,
    });
  }

  const api = Object.freeze({ createController, normaliseScope, sanitizerMode });
  scope.FluxionDataClearingCore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis === "object" ? globalThis : this);
