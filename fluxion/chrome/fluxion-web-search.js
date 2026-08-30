/* global gBrowser, Services, ChromeUtils, Cu */
(function initialiseFluxionWebSearch(window) {
  "use strict";

  if (!window.gBrowser || window.FluxionWebSearch) return;

  const { SearchService } = ChromeUtils.importESModule(
    "moz-src:///toolkit/components/search/SearchService.sys.mjs",
  );
  const { PrivateBrowsingUtils } = ChromeUtils.importESModule(
    "resource://gre/modules/PrivateBrowsingUtils.sys.mjs",
  );
  const isPrivate = PrivateBrowsingUtils.isWindowPrivate(window);
  let engineName = "Default search engine";

  async function currentEngine() {
    await SearchService.init();
    return isPrivate ? SearchService.defaultPrivateEngine : SearchService.defaultEngine;
  }

  async function refresh() {
    const engine = await currentEngine();
    engineName = engine?.name || "Default search engine";
    window.dispatchEvent(new window.CustomEvent("FluxionSearchEngineChanged", {
      detail: { name: engineName },
    }));
    return engineName;
  }

  async function resolve(query) {
    const terms = String(query ?? "").trim();
    if (!terms) throw new Error("Search terms are empty");
    const engine = await currentEngine();
    const submission = engine?.getSubmission(terms, null);
    if (!submission?.uri) throw new Error("The default search engine could not create a submission");
    if (!submission.uri.schemeIs("https") && !submission.uri.schemeIs("http")) {
      throw new Error("The default search engine returned an unsafe submission scheme");
    }
    return Object.freeze({
      engineId: engine.id || engine.name,
      engineName: engine.name,
      postData: submission.postData || null,
      url: submission.uri.spec,
    });
  }

  async function open(query) {
    const submission = await resolve(query);
    const tab = gBrowser.addTrustedTab(submission.url, {
      postData: submission.postData,
      globalHistoryOptions: { triggeringSearchEngine: submission.engineName },
    });
    window.FluxionUI.setTabWorkspace(tab, window.FluxionUI.currentWorkspace());
    gBrowser.selectedTab = tab;
    return Object.freeze({ ...submission, tab });
  }

  const searchObserver = {
    observe(_subject, _topic, data) {
      if (data === "engine-default" || (isPrivate && data === "engine-default-private")) {
        refresh().catch(Cu.reportError);
      }
    },
  };
  Services.obs.addObserver(searchObserver, "browser-search-engine-modified");
  window.addEventListener("unload", () => {
    Services.obs.removeObserver(searchObserver, "browser-search-engine-modified");
  }, { once: true });

  window.FluxionWebSearch = Object.freeze({
    currentName: () => engineName,
    open,
    refresh,
    resolve,
  });
  refresh().catch(Cu.reportError);
})(window);
