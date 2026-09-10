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
  const { FluxionNativeMemory } = ChromeUtils.importESModule(
    "resource://fluxion/modules/FluxionNativeMemory.sys.mjs"
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
    return enabled() && embeddingProvider() === "gecko-local" && !FluxionNativeMemory.pending();
  }

  function applyEmbeddingFeaturePrefs(active = embeddingsEnabled()) {
    active = active && !FluxionNativeMemory.pending();
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
      manager = FluxionNativeMemory.getManager();
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
    if (!embeddingsEnabled() || PrivateBrowsingUtils.isWindowPrivate(window) || exclusionSweep) return exclusionSweep;
    exclusionSweep = FluxionNativeMemory.runMutation(async () => {
      const native = FluxionNativeMemory.getManager();
      const connection = await FluxionNativeMemory.storageConnection();
      const rows = await connection.execute(`
        SELECT map.rowid AS rowid, places.url AS url
        FROM vec_history_mapping map
        JOIN places.moz_places places USING (url_hash)
      `);
      const blocked = rows.filter(row =>
        !isAllowedResult(row.getResultByName("url"))
      );
      if (!blocked.length) return;
      // Array.isArray crosses chrome/module realms; Gecko's Float32Array
      // instanceof check does not accept this window's typed-array constructor.
      const sentinel = new Array(native.getEmbeddingSize()).fill(0);
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
    }).finally(() => { exclusionSweep = null; });
    return exclusionSweep;
  }

  async function clearEmbeddingData() {
    let nativeError = null;
    try {
      await FluxionNativeMemory.purge();
    } catch (error) {
      Cu.reportError(error);
      nativeError = error;
    }
    await FluxionMemoryStore.clearVectors();
    if (nativeError) throw nativeError;
  }

  async function embeddingVectorCounts() {
    const native = await FluxionNativeMemory.vectorCount();
    return { native, enriched: await FluxionMemoryStore.vectorCount() };
  }

  function setEmbeddingProvider(value) {
    return FluxionNativeMemory.runControl(() => applyEmbeddingProvider(value));
  }

  async function applyEmbeddingProvider(value) {
    if (PrivateBrowsingUtils.isWindowPrivate(window)) return embeddingProvider();
    const next = FluxionSettings.normaliseEmbeddingProvider(value);
    if (next !== "disabled") await FluxionNativeMemory.recover();
    Services.prefs.setStringPref(PREF_EMBEDDING_PROVIDER, next);
    applyEmbeddingFeaturePrefs(enabled() && next === "gecko-local");
    if (next === "disabled") {
      await clearEmbeddingData();
    } else if (enabled()) {
      const semanticManager = getManager();
      await semanticManager.getConnection();
      semanticManager.onPagesRankChanged();
      applyExclusions().catch(Cu.reportError);
    }
    Services.prefs.savePrefFile(null);
    indexScheduler?.wake();
    return next;
  }

  async function search(searchText, currentWorkspace = "", { onPartial } = {}) {
    const startedAt = FluxionMemoryStore.revision;
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
    const openTabsByUrl = new Map();
    const workspaceNames = new Map(window.FluxionUI.workspaces().map(item => [item.id, item.name]));
    for (const tab of window.gBrowser.tabs) {
      const url = tab.linkedBrowser?.currentURI?.spec;
      if (url) openTabsByUrl.set(url, tab);
    }
    const annotate = row => {
      const tab = openTabsByUrl.get(row.url);
      const workspace = tab ? window.FluxionUI.tabWorkspace(tab) : row.workspace;
      return { ...row, workspace, workspaceName: workspaceNames.get(workspace) || workspace || "" };
    };
    const snapshot = (state, lexical = [], semantic = []) => {
      const results = FluxionMemoryRanking.mergeMemoryResults(query,
        [...keyword, ...lexical].map(annotate), semantic.map(annotate), { currentWorkspace, limit: 12 });
      return { results, state, answer: FluxionMemoryGrounding.ground(query, results) };
    };
    const partial = rows => {
      if (typeof onPartial !== "function" || startedAt !== FluxionMemoryStore.revision ||
          !enabled() || PrivateBrowsingUtils.isWindowPrivate(window)) return;
      try { onPartial(snapshot(useEmbeddings ? "searching" : "keyword-only", rows.filter(row => isAllowedResult(row.url)))); }
      catch (error) { Cu.reportError(error); }
    };
    partial([]);
    let semantic = [];
    let enrichedKeyword = [];
    let state = useEmbeddings ? "building" : "keyword-only";
    // Native model startup must not delay the independent page-evidence query.
    // Each embedding path has its own deadline and one pending-model limit.
    const [native, enriched] = await Promise.all([
      useEmbeddings ? FluxionNativeMemory.search(query).catch(error => {
        Cu.reportError(error);
        return { state: "lexical", results: [] };
      }) : null,
      FluxionMemoryStore.search(query, 18, useEmbeddings, { onLexical: partial }).catch(error => {
        Cu.reportError(error);
        return null;
      }),
    ]);
    if (native) {
      semantic = native.results.filter(row => isAllowedResult(row.url))
        .map(row => ({ ...row, lastVisit: Number(row.lastVisit || 0) / 1000 }));
      state = ["ready", "building"].includes(native.state) ? native.state : "lexical";
      applyExclusions().catch(Cu.reportError);
    }
    if (enriched) {
      enrichedKeyword = enriched.lexical.filter(row => isAllowedResult(row.url));
      semantic.push(...enriched.semantic.filter(row => isAllowedResult(row.url)));
      if (enriched.semantic.length) state = "ready";
    }

    if (startedAt !== FluxionMemoryStore.revision || !enabled()) {
      return { results: [], state: enabled() ? "ready" : "disabled",
        answer: FluxionMemoryGrounding.ground(query, []) };
    }
    return snapshot(state, enrichedKeyword, semantic);
  }

  function enable() {
    return FluxionNativeMemory.runControl(enableMemory);
  }

  async function enableMemory() {
    if (PrivateBrowsingUtils.isWindowPrivate(window)) return false;
    await FluxionNativeMemory.recover();
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
    applyExclusions().catch(Cu.reportError);
    indexScheduler?.wake();
    return connection ? "semantic" : "lexical";
  }

  function clearAndDisable() {
    return FluxionNativeMemory.runControl(disableMemory);
  }

  async function disableMemory() {
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

  function excludeDomain(value) {
    return FluxionNativeMemory.runControl(() => addExcludedDomain(value));
  }

  async function addExcludedDomain(value) {
    const domain = FluxionMemoryPolicy.normaliseDomain(value);
    if (!domain) return false;
    const next = [...new Set([...excludedDomains(), domain])].slice(0, 200);
    Services.prefs.setStringPref(PREF_EXCLUDED, JSON.stringify(next));
    Services.prefs.savePrefFile(null);
    await deleteExcludedEvidence(next);
    return true;
  }

  function setExcludedDomains(values) {
    return FluxionNativeMemory.runControl(() => replaceExcludedDomains(values));
  }

  async function replaceExcludedDomains(values) {
    const next = [...new Set(values.map(FluxionMemoryPolicy.normaliseDomain).filter(Boolean))].slice(0, 200);
    Services.prefs.setStringPref(PREF_EXCLUDED, JSON.stringify(next));
    Services.prefs.savePrefFile(null);
    await deleteExcludedEvidence(next);
    return next;
  }

  async function deleteExcludedEvidence(domains) {
    // An older background sweep may already have selected its blocked rows
    // before this preference edit. Wait for it, then scan the current policy.
    if (exclusionSweep) await exclusionSweep.catch(() => {});
    let nativeError = null;
    try { await applyExclusions(); }
    catch (error) { nativeError = error; }
    // A native database failure must not prevent deletion of extracted text
    // and vectors in Fluxion's independent evidence store.
    await FluxionMemoryStore.deleteBlocked(domains);
    if (nativeError) throw nativeError;
  }

  async function indexBrowser(browser, startedAt = FluxionMemoryStore.revision) {
    if (!enabled() || PrivateBrowsingUtils.isWindowPrivate(window) || !browser) return;
    if (startedAt !== FluxionMemoryStore.revision) return;
    const url = browser.currentURI?.spec || "";
    if (Date.now() - (indexedAt.get(url) || 0) < 30000) return url;
    if (!FluxionMemoryPolicy.canIndexPage({ url }, excludedDomains())) return;
    const actor = browser.browsingContext?.currentWindowGlobal?.getActor("FluxionMemoryPage");
    const extracted = await actor?.sendQuery("FluxionMemory:Extract");
    if (startedAt !== FluxionMemoryStore.revision || !enabled() ||
        PrivateBrowsingUtils.isWindowPrivate(window) || browser.currentURI?.spec !== url) return;
    if (Services.env.get("FLUXION_VISUAL_ENRICHMENT_TEST") === "1") {
      Services.prefs.setStringPref("fluxion.memory.enrichment.stage", "content-extracted");
      Services.prefs.savePrefFile(null);
    }
    const page = FluxionMemoryContent.normalisePage(extracted);
    if (!FluxionMemoryPolicy.canIndexPage(page, excludedDomains())) return;
    const embeddingText = FluxionMemoryContent.embeddingText(page);
    if (embeddingText.length < 80) return;
    const tab = window.gBrowser.getTabForBrowser(browser);
    const stored = await FluxionMemoryStore.upsert({
      ...page,
      embeddingText,
      workspace: tab ? window.FluxionUI.tabWorkspace(tab) : "",
      tabGroup: tab?.group?.label || "",
      lastVisit: Date.now(),
      indexedAt: Date.now(),
    }, startedAt);
    if (!stored || startedAt !== FluxionMemoryStore.revision) return;
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
    run: job => indexBrowser(job.browser, job.revision).catch(error => {
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
    return indexScheduler.enqueue(browser, { browser, revision: FluxionMemoryStore.revision });
  }

  const progressListener = {
    onStateChange(browser, webProgress, request, flags) {
      const stopped = flags & Ci.nsIWebProgressListener.STATE_STOP;
      const network = flags & Ci.nsIWebProgressListener.STATE_IS_NETWORK;
      if (stopped && network && webProgress?.isTopLevel) scheduleIndex(browser);
    },
  };
  window.gBrowser.addTabsProgressListener(progressListener);

  const observer = () => { applyExclusions().catch(Cu.reportError); };
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
      .then(async record => {
        const deletedURL = "https://example.com/?fluxion-memory-deletion-test=1";
        await PlacesUtils.history.insert({
          url: deletedURL, title: "Fluxion Memory deletion fixture",
          visits: [{ date: new Date(), transition: PlacesUtils.history.TRANSITIONS.LINK }],
        });
        await FluxionMemoryStore.upsert({
          url: deletedURL, title: "Fluxion Memory deletion fixture", description: "",
          headings: "", text: "Evidence that must be forgotten with its browsing history.",
          workspace: "", tabGroup: "", lastVisit: Date.now(), indexedAt: Date.now(),
        });
        if (!(await FluxionMemoryStore.get(deletedURL))) {
          throw new Error("history deletion gate failed to create its Memory fixture");
        }
        await PlacesUtils.history.remove(deletedURL);
        for (let attempt = 0; attempt < 40; attempt += 1) {
          if (!(await FluxionMemoryStore.get(deletedURL))) {
            if (!(await FluxionMemoryStore.get(testURL))) {
              throw new Error("history deletion removed unrelated Memory evidence");
            }
            Services.prefs.setStringPref("fluxion.memory.deletion.health", "places-removal-deleted-only-associated-evidence");
            Services.prefs.savePrefFile(null);
            return record;
          }
          await new Promise(resolve => window.setTimeout(resolve, 50));
        }
        throw new Error("Places history removal retained Browser Memory evidence");
      })
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
  if (Services.env.get("FLUXION_SEMANTIC_MODEL_TEST") === "1") {
    const stage = value => {
      Services.prefs.setStringPref("fluxion.memory.semantic.stage", value);
      Services.prefs.savePrefFile(null);
    };
    (async () => {
      stage("waiting-for-places-before-ranking");
      const { PlacesBrowserStartup } = ChromeUtils.importESModule(
        "moz-src:///browser/components/places/PlacesBrowserStartup.sys.mjs"
      );
      const startupDeadline = Date.now() + 20000;
      while (!PlacesBrowserStartup._placesBrowserInitComplete) {
        if (Date.now() >= startupDeadline) throw new Error("Places startup did not finish before ranking verification");
        await new Promise(resolve => window.setTimeout(resolve, 100));
      }
      stage("seeding-exact-ranking-candidates");
      await window.FluxionMemory.setEmbeddingProvider("disabled");
      await window.FluxionMemory.enable();
      const rankingQuery = "fluxion exact recall fixture";
      const exactURL = "https://memory-ranking-fixture.invalid/exact";
      const unicodeURL = "https://memory-ranking-fixture.invalid/body-evidence";
      const now = Date.now();
      const rankingPages = [
        { url: exactURL, title: rankingQuery, time: now - 7 * 86400000, exact: true },
        { url: unicodeURL, title: "Saved reading notes", time: now - 86400000, exact: true,
          text: "ÉCOLE MÉMOIRE Cafe\u0301 — documentation remembered from a visit." },
        ...Array.from({ length: 30 }, (_, index) => ({
          url: `https://memory-ranking-fixture.invalid/partial-${index}`,
          title: `Discussion about ${rankingQuery} examples ${index}`,
          time: now - (index + 1) * 10000, exact: false,
        })),
      ];
      try {
        for (const page of rankingPages) {
          await PlacesUtils.history.insert({ url: page.url, title: page.title,
            visits: Array.from({ length: page.exact ? 1 : 3 }, (_, index) => ({
              date: new Date(page.time - index * 1000),
              transition: page.exact ? PlacesUtils.history.TRANSITIONS.LINK : PlacesUtils.history.TRANSITIONS.TYPED,
            })),
          });
          if (!(await FluxionMemoryStore.upsert({
            url: page.url, title: page.title, description: "", headings: "",
            text: page.text || "Saved source for candidate ordering verification.", workspace: "", tabGroup: "",
            lastVisit: page.time, indexedAt: now,
          }))) throw new Error("Ranking fixture evidence was not stored");
        }
        stage("checking-exact-ranking-beyond-places-cap");
        const rankingDeadline = Date.now() + 20000;
        let keywords;
        do {
          keywords = keywordRows(rankingQuery);
          if (keywords.length === 24 && !keywords.some(row => row.url === exactURL)) break;
          await new Promise(resolve => window.setTimeout(resolve, 100));
        } while (Date.now() < rankingDeadline);
        if (keywords.length !== 24 || keywords.some(row => row.url === exactURL)) {
          throw new Error("Ranking fixture did not put the old exact page beyond Places' 24-row frecency cap");
        }
        const recalled = await window.FluxionMemory.search(rankingQuery);
        if (recalled.state !== "keyword-only" || recalled.results[0]?.url !== exactURL ||
            recalled.answer?.sourceURL !== exactURL) {
          throw new Error("Integrated keyword-only Memory did not rank the old exact page first");
        }
        stage("checking-normalized-body-only-recall");
        for (const query of ["ecole memoire cafe", "école mémoire café"]) {
          if (keywordRows(query).length) throw new Error("Unicode fixture unexpectedly matched native title/URL history");
          const recalledBody = await window.FluxionMemory.search(query);
          if (recalledBody.state !== "keyword-only" || recalledBody.results[0]?.url !== unicodeURL ||
              recalledBody.answer?.sourceURL !== unicodeURL ||
              !recalledBody.results[0]?.content.includes("ÉCOLE MÉMOIRE Cafe\u0301")) {
            throw new Error("Normalized body-only Memory recall failed or rewrote its source evidence");
          }
        }
      } finally {
        stage("cleaning-exact-ranking-fixtures");
        for (const page of rankingPages) await PlacesUtils.history.remove(page.url);
        await FluxionMemoryStore.deleteURLs(rankingPages.map(page => page.url));
      }
      if (keywordRows(rankingQuery).length || await FluxionMemoryStore.get(exactURL) ||
          await FluxionMemoryStore.get(unicodeURL)) {
        throw new Error("Ranking fixture cleanup retained history or extracted evidence");
      }
      Services.prefs.setStringPref("fluxion.memory.ranking.health", "old-exact-page-recalled-beyond-native-candidate-cap");
      Services.prefs.setStringPref("fluxion.memory.unicode.health", "normalized-body-only-recall-preserves-original-evidence");
      Services.prefs.savePrefFile(null);

      const deadline = Date.now() + 240000;
      stage("enabling-local-model");
      await window.FluxionMemory.setEmbeddingProvider("gecko-local");
      await enable();
      const pages = [
        {
          url: "https://example.com/fluxion-plant-evidence", title: "How green plants make food",
          text: "Green plants use sunlight to convert water and carbon dioxide into sugar. Chlorophyll in leaves captures light energy. This process releases oxygen and supplies energy for plant growth.",
        },
        {
          url: "https://example.com/fluxion-railway-evidence", title: "Railway station timetable",
          text: "Passenger trains arrive at railway platforms according to a timetable. Travelers buy tickets, check departure times and board carriages. Express services connect cities by rail.",
        },
      ];
      for (let index = 0; index < pages.length; index += 1) {
        const page = pages[index];
        await FluxionMemoryStore.upsert({ ...page, description: "", headings: "",
          workspace: "", tabGroup: "", lastVisit: Date.now(), indexedAt: Date.now() });
        let lastError = "No vector stored";
        let stored = false;
        while (Date.now() < deadline) {
          stage(`embedding-page-${index + 1}`);
          try {
            await FluxionMemoryStore.embed(page.url, `${page.title}\n${page.text}`);
            if (await FluxionMemoryStore.vectorCount() >= index + 1) {
              stored = true;
              break;
            }
          } catch (error) {
            lastError = String(error);
            stage(`waiting-for-local-model: ${lastError}`);
          }
          await new Promise(resolve => window.setTimeout(resolve, 1000));
        }
        if (!stored) throw new Error(`Local model did not store page ${index + 1}: ${lastError}`);
      }
      stage("querying-semantic-only-concept");
      while (Date.now() < deadline) {
        const result = await FluxionMemoryStore.search("photosynthesis", 6, true);
        if (result.lexical.length) throw new Error("Semantic fixture unexpectedly has a lexical match");
        const plant = result.semantic.find(row => row.url === pages[0].url);
        const railway = result.semantic.find(row => row.url === pages[1].url);
        if (plant && Number.isFinite(plant.distance) && (!railway || plant.distance < railway.distance)) {
          Services.prefs.setStringPref("fluxion.memory.semantic.health", "gecko-model-generated-vectors-and-recalled-nonliteral-evidence");
          Services.prefs.savePrefFile(null);
          return;
        }
        await new Promise(resolve => window.setTimeout(resolve, 1000));
      }
      throw new Error("Real local embeddings did not recall the plant evidence for photosynthesis");
    })().catch(error => {
      Services.prefs.setStringPref("fluxion.memory.semantic.error", String(error));
      Services.prefs.savePrefFile(null);
      Cu.reportError(error);
    });
  }
  Services.prefs.setStringPref("fluxion.memory.health", "local-memory-controls-loaded");
  Services.prefs.savePrefFile(null);
})(window);
