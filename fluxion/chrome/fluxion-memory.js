/* global Services, ChromeUtils, Ci, Cu, FluxionMemoryPolicy, FluxionMemoryRanking */
(function initialiseFluxionMemory(window) {
  "use strict";

  if (window.FluxionMemory) return;

  const PREF_ENABLED = "fluxion.memory.enabled";
  const PREF_EXCLUDED = "fluxion.memory.excludedDomains";
  const { PlacesUtils } = ChromeUtils.importESModule(
    "resource://gre/modules/PlacesUtils.sys.mjs"
  );
  const { PrivateBrowsingUtils } = ChromeUtils.importESModule(
    "resource://gre/modules/PrivateBrowsingUtils.sys.mjs"
  );
  let manager = null;
  let exclusionSweep = null;

  function enabled() {
    return Services.prefs.getBoolPref(PREF_ENABLED, false);
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
    if (!enabled() || !manager || exclusionSweep) return exclusionSweep;
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

  async function search(searchText, currentWorkspace = "") {
    const query = String(searchText || "").trim();
    if (PrivateBrowsingUtils.isWindowPrivate(window)) {
      return { results: [], state: "private" };
    }
    const keyword = keywordRows(query);
    if (!enabled() || query.length < 2) {
      return { results: keyword, state: enabled() ? "ready" : "disabled" };
    }

    let semantic = [];
    let state = "building";
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

    const openTabsByUrl = new Map();
    for (const tab of window.gBrowser.tabs) {
      const url = tab.linkedBrowser?.currentURI?.spec;
      if (url) openTabsByUrl.set(url, tab);
    }
    const annotate = row => {
      const tab = openTabsByUrl.get(row.url);
      return tab ? { ...row, workspace: window.FluxionUI.tabWorkspace(tab) } : row;
    };
    return {
      results: FluxionMemoryRanking.mergeMemoryResults(
        query,
        keyword.map(annotate),
        semantic.map(annotate),
        { currentWorkspace, limit: 12 },
      ),
      state,
    };
  }

  async function enable() {
    if (PrivateBrowsingUtils.isWindowPrivate(window)) return false;
    Services.prefs.setBoolPref(PREF_ENABLED, true);
    Services.prefs.setBoolPref("browser.ml.enable", true);
    Services.prefs.setBoolPref("places.semanticHistory.featureGate", true);
    Services.prefs.setBoolPref("places.semanticHistory.removeOnStartup", false);
    Services.prefs.savePrefFile(null);
    const semanticManager = getManager();
    const connection = await semanticManager.getConnection();
    semanticManager.onPagesRankChanged();
    applyExclusions();
    return connection ? "semantic" : "lexical";
  }

  async function clearAndDisable() {
    const connection = manager ? await manager.getConnection() : null;
    Services.prefs.setBoolPref(PREF_ENABLED, false);
    Services.prefs.setBoolPref("places.semanticHistory.featureGate", false);
    Services.prefs.setBoolPref("browser.ml.enable", false);
    Services.prefs.setBoolPref("places.semanticHistory.removeOnStartup", true);
    if (connection) {
      await connection.executeTransaction(async () => {
        await connection.execute("DELETE FROM vec_history");
        await connection.execute("DELETE FROM vec_history_mapping");
      });
    }
    Services.prefs.savePrefFile(null);
  }

  async function excludeDomain(value) {
    const domain = FluxionMemoryPolicy.normaliseDomain(value);
    if (!domain) return false;
    const next = [...new Set([...excludedDomains(), domain])].slice(0, 200);
    Services.prefs.setStringPref(PREF_EXCLUDED, JSON.stringify(next));
    Services.prefs.savePrefFile(null);
    await applyExclusions();
    return true;
  }

  async function setExcludedDomains(values) {
    const next = [...new Set(values.map(FluxionMemoryPolicy.normaliseDomain).filter(Boolean))].slice(0, 200);
    Services.prefs.setStringPref(PREF_EXCLUDED, JSON.stringify(next));
    Services.prefs.savePrefFile(null);
    await applyExclusions();
    return next;
  }

  const observer = () => { applyExclusions(); };
  Services.obs.addObserver(observer, "places-semantichistorymanager-update-complete");
  window.addEventListener("unload", () => {
    Services.obs.removeObserver(observer, "places-semantichistorymanager-update-complete");
  }, { once: true });

  window.FluxionMemory = Object.freeze({
    clearAndDisable,
    enable,
    enabled,
    excludeDomain,
    excludedDomains,
    setExcludedDomains,
    search,
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
  Services.prefs.setStringPref("fluxion.memory.health", "local-memory-controls-loaded");
  Services.prefs.savePrefFile(null);
})(window);
