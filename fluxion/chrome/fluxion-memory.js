/* global Services, ChromeUtils, Cc, Ci, Cu, FluxionIndexScheduler, FluxionMemoryPolicy, FluxionMemoryContent, FluxionMemoryRanking, FluxionMemoryGrounding, FluxionSettings */
(function initialiseFluxionMemory(window) {
  "use strict";

  if (window.FluxionMemory) return;

  const PREF_ENABLED = "fluxion.memory.enabled";
  const PREF_EXCLUDED = "fluxion.memory.excludedDomains";
  const PREF_EMBEDDING_PROVIDER = "fluxion.memory.embeddingProvider";
  const { PlacesUtils } = ChromeUtils.importESModule(
    "resource://gre/modules/PlacesUtils.sys.mjs"
  );
  const { PrivateBrowsingUtils } = ChromeUtils.importESModule(
    "resource://gre/modules/PrivateBrowsingUtils.sys.mjs"
  );
  const { FluxionMemoryStore } = ChromeUtils.importESModule(
    "resource://fluxion/modules/FluxionMemoryStore.sys.mjs"
  );
  let manager = null;
  let exclusionSweep = null;
  let indexScheduler = null;
  let batteryManager = null;
  const batteryState = { supported: false, charging: true, level: 1 };
  const indexedAt = new Map();
  const activityEvents = ["keydown", "pointerdown", "touchstart", "wheel"];
  let idleService = null;
  try {
    idleService = Cc["@mozilla.org/widget/useridleservice;1"]
      .getService(Ci.nsIUserIdleService);
  } catch (_) {}

  function enabled() {
    return Services.prefs.getBoolPref(PREF_ENABLED, false);
  }

  function embeddingProvider() {
    return FluxionSettings.normaliseEmbeddingProvider(
      Services.prefs.getStringPref(PREF_EMBEDDING_PROVIDER, "gecko-local"),
    );
  }

  function embeddingsEnabled() {
    return enabled() && embeddingProvider() === "gecko-local";
  }

  function applyEmbeddingFeaturePrefs(active = embeddingsEnabled()) {
    Services.prefs.setBoolPref("browser.ml.enable", active);
    Services.prefs.setBoolPref("places.semanticHistory.featureGate", active);
    Services.prefs.setBoolPref("places.semanticHistory.removeOnStartup", !active);
  }

  function setLowPriorityTimer(callback, delay) {
    const token = { timeout: 0, idle: 0 };
    token.timeout = window.setTimeout(() => {
      token.timeout = 0;
      if (typeof window.requestIdleCallback === "function") {
        token.idle = window.requestIdleCallback(callback, { timeout: 5000 });
      } else {
        token.timeout = window.setTimeout(callback, 0);
      }
    }, delay);
    return token;
  }

  function clearLowPriorityTimer(token) {
    if (token?.timeout) window.clearTimeout(token.timeout);
    if (token?.idle && typeof window.cancelIdleCallback === "function") {
      window.cancelIdleCallback(token.idle);
    }
  }

  function activePageIsDemanding() {
    const tab = window.gBrowser.selectedTab;
    const browser = tab?.linkedBrowser;
    return Boolean(
      tab?.hasAttribute("busy") || tab?.soundPlaying || tab?.pictureinpicture ||
      tab?.sharingState || browser?.getAttribute("sharing")
    );
  }

  function indexingGate() {
    if (!enabled() || PrivateBrowsingUtils.isWindowPrivate(window)) {
      return { ok: false, reason: "disabled-or-private", retryIn: 30000 };
    }
    if (batteryState.supported && !batteryState.charging && batteryState.level <= 0.2) {
      return { ok: false, reason: "low-battery", retryIn: 60000 };
    }
    if (activePageIsDemanding()) {
      return { ok: false, reason: "active-media-or-sharing", retryIn: 15000 };
    }
    const idleTime = Number(idleService?.idleTime || 0);
    if (idleService && idleTime < 3000) {
      return { ok: false, reason: "user-active", retryIn: Math.max(500, 3000 - idleTime) };
    }
    return { ok: true };
  }

  function updateBatteryState() {
    if (!batteryManager) return;
    batteryState.supported = true;
    batteryState.charging = Boolean(batteryManager.charging);
    batteryState.level = Number.isFinite(batteryManager.level) ? batteryManager.level : 1;
    indexScheduler?.wake();
  }

  function excludedDomains() {
    return FluxionMemoryPolicy.parseExcludedDomains(
      Services.prefs.getStringPref(PREF_EXCLUDED, "[]")
    );
  }

  function isAllowedResult(url) {
    return !FluxionMemoryPolicy.isSensitiveUrl(url) &&
      !FluxionMemoryPolicy.isExcludedUrl(url, excludedDomains());
  }

  function getManager() {
    if (!manager) {
      const { getPlacesSemanticHistoryManager } = ChromeUtils.importESModule(
        "resource://gre/modules/PlacesSemanticHistoryManager.sys.mjs"
      );
      manager = getPlacesSemanticHistoryManager({
        rowLimit: 10000,
        samplingAttrib: "frecency",
        changeThresholdCount: 1,
        distanceThreshold: 0.68,
      });
    }
    return manager;
  }

  function keywordRows(search) {
    if (search.length < 2 || PrivateBrowsingUtils.isWindowPrivate(window)) return [];
    try {
      const query = PlacesUtils.history.getNewQuery();
      query.searchTerms = search;
      const options = PlacesUtils.history.getNewQueryOptions();
      options.maxResults = 24;
      options.resultType = Ci.nsINavHistoryQueryOptions.RESULTS_AS_URI;
      options.sortingMode = Ci.nsINavHistoryQueryOptions.SORT_BY_FRECENCY_DESCENDING;
      const result = PlacesUtils.history.executeQuery(query, options);
      const root = result.root;
      const rows = [];
      root.containerOpen = true;
      try {
        for (let index = 0; index < root.childCount; index += 1) {
          const node = root.getChild(index);
          if (!node.uri || !isAllowedResult(node.uri)) continue;
          rows.push({
            title: node.title || node.uri,
            url: node.uri,
            lastVisit: Number(node.time || 0) / 1000,
            visitCount: Number(node.accessCount || 0),
          });
        }
      } finally {
        root.containerOpen = false;
      }
      return rows;
    } catch (error) {
      Cu.reportError(error);
      return [];
    }
  }

  async function applyExclusions() {
    if (!embeddingsEnabled() || !manager || exclusionSweep) return exclusionSweep;
    exclusionSweep = (async () => {
      const connection = await manager.getConnection();
      if (!connection) return;
      const rows = await connection.execute(`
        SELECT map.rowid AS rowid, places.url AS url
        FROM vec_history_mapping map
        JOIN places.moz_places places USING (url_hash)
      `);
      const blocked = rows.filter(row =>
        !isAllowedResult(row.getResultByName("url"))
      );
      if (!blocked.length) return;
      const sentinel = new Float32Array(manager.getEmbeddingSize());
      sentinel[0] = 1;
      const vector = PlacesUtils.tensorToSQLBindable(sentinel);
      await connection.executeTransaction(async () => {
        for (const row of blocked) {
          const rowid = row.getResultByName("rowid");
          await connection.executeCached(
            "DELETE FROM vec_history WHERE rowid = :rowid",
            { rowid },
          );
          await connection.executeCached(
            "INSERT INTO vec_history (rowid, embedding) VALUES (:rowid, :vector)",
            { rowid, vector },
          );
        }
      });
    })().catch(Cu.reportError).finally(() => { exclusionSweep = null; });
    return exclusionSweep;
  }

  async function clearEmbeddingData() {
    let nativeError = null;
    try {
      const semanticManager = manager || getManager();
      const nativeConnection = await semanticManager.getConnection();
      if (nativeConnection) {
        await nativeConnection.executeTransaction(async () => {
          await nativeConnection.execute("DELETE FROM vec_history");
          await nativeConnection.execute("DELETE FROM vec_history_mapping");
        });
      }
    } catch (error) {
      Cu.reportError(error);
      nativeError = error;
    }
    await FluxionMemoryStore.clearVectors();
    if (nativeError) throw nativeError;
  }

  async function embeddingVectorCounts() {
    const semanticManager = manager || getManager();
    const nativeConnection = await semanticManager.getConnection();
    let native = 0;
    if (nativeConnection) {
      const rows = await nativeConnection.execute("SELECT count(*) AS count FROM vec_history");
      native = Number(rows[0]?.getResultByName("count") || 0);
    }
    return { native, enriched: await FluxionMemoryStore.vectorCount() };
  }

  async function setEmbeddingProvider(value) {
    if (PrivateBrowsingUtils.isWindowPrivate(window)) return embeddingProvider();
    const next = FluxionSettings.normaliseEmbeddingProvider(value);
    Services.prefs.setStringPref(PREF_EMBEDDING_PROVIDER, next);
    applyEmbeddingFeaturePrefs(enabled() && next === "gecko-local");
    if (next === "disabled") {
      await clearEmbeddingData();
    } else if (enabled()) {
      const semanticManager = getManager();
      await semanticManager.getConnection();
      semanticManager.onPagesRankChanged();
      applyExclusions();
    }
    Services.prefs.savePrefFile(null);
    indexScheduler?.wake();
    return next;
  }

  async function search(searchText, currentWorkspace = "") {
    const query = String(searchText || "").trim();
    if (PrivateBrowsingUtils.isWindowPrivate(window)) {
      return { results: [], state: "private", answer: FluxionMemoryGrounding.ground(query, []) };
    }
    const keyword = keywordRows(query);
    if (!enabled() || query.length < 2) {
      return {
        results: keyword,
        state: enabled() ? "ready" : "disabled",
        answer: FluxionMemoryGrounding.ground(query, keyword),
      };
    }

    const useEmbeddings = embeddingsEnabled();
    let semantic = [];
    let enrichedKeyword = [];
    let state = useEmbeddings ? "building" : "keyword-only";
    if (useEmbeddings) {
      try {
        const semanticManager = getManager();
        const connection = await semanticManager.getConnection();
        if (!connection) {
          state = "lexical";
        } else if (await semanticManager.hasSufficientEntriesForSearching()) {
          const response = await semanticManager.infer({ searchString: query });
          semantic = (response.results || [])
            .filter(row => isAllowedResult(row.url))
            .map(row => ({ ...row, lastVisit: Number(row.lastVisit || 0) / 1000 }));
          state = "ready";
        }
        applyExclusions();
      } catch (error) {
        Cu.reportError(error);
        state = "lexical";
      }
    }

    try {
      const enriched = await FluxionMemoryStore.search(query, 18, useEmbeddings);
      enrichedKeyword = enriched.lexical.filter(row => isAllowedResult(row.url));
      semantic.push(...enriched.semantic.filter(row => isAllowedResult(row.url)));
    } catch (error) {
      Cu.reportError(error);
    }

    const openTabsByUrl = new Map();
    const workspaceNames = new Map(window.FluxionUI.workspaces().map(item => [item.id, item.name]));
    for (const tab of window.gBrowser.tabs) {
      const url = tab.linkedBrowser?.currentURI?.spec;
      if (url) openTabsByUrl.set(url, tab);
    }
    const annotate = row => {
      const tab = openTabsByUrl.get(row.url);
      const workspace = tab ? window.FluxionUI.tabWorkspace(tab) : row.workspace;
      return {
        ...row,
        workspace,
        workspaceName: workspaceNames.get(workspace) || workspace || "",
      };
    };
    const results = FluxionMemoryRanking.mergeMemoryResults(
        query,
        [...keyword, ...enrichedKeyword].map(annotate),
        semantic.map(annotate),
        { currentWorkspace, limit: 12 },
      );
    return {
      results,
      state,
      answer: FluxionMemoryGrounding.ground(query, results),
    };
  }

  async function enable() {
    if (PrivateBrowsingUtils.isWindowPrivate(window)) return false;
    Services.prefs.setBoolPref(PREF_ENABLED, true);
    applyEmbeddingFeaturePrefs();
    Services.prefs.savePrefFile(null);
    if (!embeddingsEnabled()) {
      indexScheduler?.wake();
      return "lexical";
    }
    const semanticManager = getManager();
    const connection = await semanticManager.getConnection();
    semanticManager.onPagesRankChanged();
    applyExclusions();
    indexScheduler?.wake();
    return connection ? "semantic" : "lexical";
  }

  async function clearAndDisable() {
    Services.prefs.setBoolPref(PREF_ENABLED, false);
    applyEmbeddingFeaturePrefs(false);
    indexScheduler?.clear();
    let embeddingError = null;
    try { await clearEmbeddingData(); }
    catch (error) { embeddingError = error; }
    await FluxionMemoryStore.clear();
    Services.prefs.savePrefFile(null);
    if (embeddingError) throw embeddingError;
  }

  async function excludeDomain(value) {
    const domain = FluxionMemoryPolicy.normaliseDomain(value);
    if (!domain) return false;
    const next = [...new Set([...excludedDomains(), domain])].slice(0, 200);
    Services.prefs.setStringPref(PREF_EXCLUDED, JSON.stringify(next));
    Services.prefs.savePrefFile(null);
    await applyExclusions();
    await FluxionMemoryStore.deleteBlocked(next);
    return true;
  }

  async function setExcludedDomains(values) {
    const next = [...new Set(values.map(FluxionMemoryPolicy.normaliseDomain).filter(Boolean))].slice(0, 200);
    Services.prefs.setStringPref(PREF_EXCLUDED, JSON.stringify(next));
    Services.prefs.savePrefFile(null);
    await applyExclusions();
    await FluxionMemoryStore.deleteBlocked(next);
    return next;
  }

  async function indexBrowser(browser) {
    if (!enabled() || PrivateBrowsingUtils.isWindowPrivate(window) || !browser) return;
    const url = browser.currentURI?.spec || "";
    if (Date.now() - (indexedAt.get(url) || 0) < 30000) return url;
    if (!FluxionMemoryPolicy.canIndexPage({ url }, excludedDomains())) return;
    const actor = browser.browsingContext?.currentWindowGlobal?.getActor("FluxionMemoryPage");
    const extracted = await actor?.sendQuery("FluxionMemory:Extract");
    if (Services.env.get("FLUXION_VISUAL_ENRICHMENT_TEST") === "1") {
      Services.prefs.setStringPref("fluxion.memory.enrichment.stage", "content-extracted");
      Services.prefs.savePrefFile(null);
    }
    const page = FluxionMemoryContent.normalisePage(extracted);
    if (!FluxionMemoryPolicy.canIndexPage(page, excludedDomains())) return;
    const embeddingText = FluxionMemoryContent.embeddingText(page);
    if (embeddingText.length < 80) return;
    const tab = window.gBrowser.getTabForBrowser(browser);
    await FluxionMemoryStore.upsert({
      ...page,
      embeddingText,
      workspace: tab ? window.FluxionUI.tabWorkspace(tab) : "",
      tabGroup: tab?.group?.label || "",
      lastVisit: Date.now(),
      indexedAt: Date.now(),
    });
    if (Services.env.get("FLUXION_VISUAL_ENRICHMENT_TEST") !== "1" && embeddingsEnabled()) {
      await FluxionMemoryStore.embed(page.url, embeddingText);
    }
    if (Services.env.get("FLUXION_VISUAL_ENRICHMENT_TEST") === "1") {
      Services.prefs.setStringPref("fluxion.memory.enrichment.stage", "evidence-stored");
      Services.prefs.savePrefFile(null);
    }
    indexedAt.set(page.url, Date.now());
    Services.prefs.setStringPref("fluxion.memory.content.health", "content-indexed");
    return page.url;
  }

  indexScheduler = new FluxionIndexScheduler.IndexScheduler({
    run: browser => indexBrowser(browser).catch(error => {
      Cu.reportError(error);
      return null;
    }),
    canRun: indexingGate,
    setTimer: setLowPriorityTimer,
    clearTimer: clearLowPriorityTimer,
    quietMs: 4000,
    retryMs: 5000,
    maxQueue: 64,
  });

  function scheduleIndex(browser) {
    if (!enabled() || !browser || PrivateBrowsingUtils.isWindowPrivate(window)) return false;
    return indexScheduler.enqueue(browser, browser);
  }

  const progressListener = {
    onStateChange(browser, webProgress, request, flags) {
      const stopped = flags & Ci.nsIWebProgressListener.STATE_STOP;
      const network = flags & Ci.nsIWebProgressListener.STATE_IS_NETWORK;
      if (stopped && network && webProgress?.isTopLevel) scheduleIndex(browser);
    },
  };
  window.gBrowser.addTabsProgressListener(progressListener);

  const observer = () => { applyExclusions(); };
  const embeddingPrefObserver = {
    observe() {
      applyEmbeddingFeaturePrefs();
      window.dispatchEvent(new window.CustomEvent("FluxionMemoryEmbeddingProviderChanged", {
        detail: { provider: embeddingProvider() },
      }));
      indexScheduler?.wake();
    },
  };
  const activityObserver = () => indexScheduler.notifyActivity();
  const memoryPressureObserver = () => indexScheduler.defer("memory-pressure", 30000);
  Services.obs.addObserver(observer, "places-semantichistorymanager-update-complete");
  Services.obs.addObserver(memoryPressureObserver, "memory-pressure");
  Services.prefs.addObserver(PREF_EMBEDDING_PROVIDER, embeddingPrefObserver);
  for (const eventName of activityEvents) {
    window.addEventListener(eventName, activityObserver, { capture: true, passive: true });
  }
  if (typeof window.navigator.getBattery === "function") {
    window.navigator.getBattery().then(manager => {
      batteryManager = manager;
      updateBatteryState();
      batteryManager.addEventListener("chargingchange", updateBatteryState);
      batteryManager.addEventListener("levelchange", updateBatteryState);
    }).catch(Cu.reportError);
  }
  window.addEventListener("unload", () => {
    window.gBrowser.removeTabsProgressListener(progressListener);
    Services.obs.removeObserver(observer, "places-semantichistorymanager-update-complete");
    Services.obs.removeObserver(memoryPressureObserver, "memory-pressure");
    Services.prefs.removeObserver(PREF_EMBEDDING_PROVIDER, embeddingPrefObserver);
    for (const eventName of activityEvents) {
      window.removeEventListener(eventName, activityObserver, { capture: true });
    }
    batteryManager?.removeEventListener("chargingchange", updateBatteryState);
    batteryManager?.removeEventListener("levelchange", updateBatteryState);
    indexScheduler.destroy();
  }, { once: true });

  window.FluxionMemory = Object.freeze({
    clearAndDisable,
    embeddingProvider,
    embeddingVectorCounts,
    enable,
    enabled,
    excludeDomain,
    excludedDomains,
    setExcludedDomains,
    setEmbeddingProvider,
    search,
    indexBrowser,
    indexingStatus: () => indexScheduler.status(),
  });
  if (enabled() && !PrivateBrowsingUtils.isWindowPrivate(window)) {
    enable().catch(Cu.reportError);
  }
  if (Services.env.get("FLUXION_VISUAL_MEMORY_TEST") === "1") {
    Services.prefs.setStringPref("browser.search.region", "US");
    enable().then(capability => {
      Services.prefs.setStringPref(
        "fluxion.memory.engine.health",
        capability === "semantic" ? "local-vector-store-opened" : "lexical-fallback-available",
      );
      Services.prefs.savePrefFile(null);
    }).catch(Cu.reportError);
  }
  if (Services.env.get("FLUXION_VISUAL_ENRICHMENT_TEST") === "1") {
    const testURL = "https://example.com/?fluxion-memory-test=1";
    indexScheduler.defer("packaged-runtime-test", 30000);
    const testTab = window.gBrowser.addTrustedTab(testURL, { skipAnimation: true });
    window.FluxionUI.setTabWorkspace(testTab, window.FluxionUI.currentWorkspace());
    enable().then(() => new Promise(resolve => window.setTimeout(resolve, 3000)))
      .then(async () => {
        if (testTab.closing || testTab.linkedBrowser?.currentURI?.spec !== testURL) {
          throw new Error("enrichment gate could not load its dedicated HTTPS tab");
        }
        Services.prefs.setStringPref("fluxion.memory.enrichment.stage", "page-found");
        Services.prefs.savePrefFile(null);
        if (!scheduleIndex(testTab.linkedBrowser)) {
          throw new Error("enrichment gate could not enqueue its page");
        }
        await new Promise(resolve => window.setTimeout(resolve, 500));
        if (await FluxionMemoryStore.get(testURL)) {
          throw new Error("low-priority queue ignored its explicit deferral");
        }
        Services.prefs.setStringPref(
          "fluxion.memory.scheduler.stage",
          "queued-work-remained-paused",
        );
        Services.prefs.savePrefFile(null);
        if (!indexScheduler.resume("packaged-runtime-test")) {
          throw new Error("low-priority queue could not release its test hold");
        }
        for (let attempt = 0; attempt < 48; attempt += 1) {
          const record = await FluxionMemoryStore.get(testURL);
          if (record) return testURL;
          await new Promise(resolve => window.setTimeout(resolve, 250));
        }
        throw new Error("low-priority queue did not resume within its bound");
      })
      .then(indexedURL => FluxionMemoryStore.get(indexedURL))
      .then(record => {
        const evidence = [record?.title, record?.description, record?.headings, record?.content]
          .filter(Boolean).join(" ").toLocaleLowerCase();
        const found = record?.url?.startsWith("https://example.com/") &&
          evidence.includes("example");
        if (found) {
          Services.prefs.setStringPref(
            "fluxion.memory.scheduler.health",
            "bounded-serial-queue-paused-and-resumed",
          );
          Services.prefs.setStringPref(
            "fluxion.memory.enrichment.health",
            "content-indexed-and-retrieved",
          );
          Services.prefs.savePrefFile(null);
          window.dispatchEvent(new window.CustomEvent("FluxionMemoryVisualReady"));
        } else {
          throw new Error("enrichment gate could not read extracted page evidence");
        }
      }).catch(error => {
        indexScheduler.resume("packaged-runtime-test");
        Services.prefs.setStringPref("fluxion.memory.enrichment.error", String(error));
        Services.prefs.savePrefFile(null);
        Cu.reportError(error);
      });
  }
  Services.prefs.setStringPref("fluxion.memory.health", "local-memory-controls-loaded");
  Services.prefs.savePrefFile(null);
})(window);
