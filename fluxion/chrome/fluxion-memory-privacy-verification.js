/* global Services, SessionStore, ChromeUtils, Cu */
(function verifyMemoryPrivacy(window) {
  "use strict";
  if (Services.env.get("FLUXION_MEMORY_PRIVACY_TEST") !== "1") return;
  const prefix = "fluxion.memory.privacy";
  if (Services.prefs.getBoolPref(`${prefix}.claimed`, false)) return;
  Services.prefs.setBoolPref(`${prefix}.claimed`, true);
  const report = { fixture: "synthetic storage tensors plus separately observed real cold-candidate embedding", checks: [] };
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const pause = ms => new Promise(resolve => window.setTimeout(resolve, ms));
  const waitFor = async (check, message) => {
    const deadline = Date.now() + 20000;
    do { const result = check(); if (result) return result; await pause(50); } while (Date.now() < deadline);
    throw new Error(message);
  };
  let companion;
  let privateCompanion;
  let connection;
  function settingsMatch(label, enabled, provider, domains) {
    for (const [name, target] of [["main", window], ["companion", companion]]) {
      const checkbox = target.document.getElementById("fluxion-memory-enabled");
      const choice = target.document.getElementById("fluxion-memory-embedding-provider");
      const exclusions = target.document.getElementById("fluxion-memory-excluded-domains");
      assert(checkbox && choice && exclusions, `${label}: ${name} Settings controls are missing`);
      assert(checkbox.checked === enabled && choice.value === provider && exclusions.value === domains,
        `${label}: ${name} Settings do not reflect shared Memory state`);
    }
    report.checks.push({ label, settingsWindows: 2, enabled, provider, domains });
  }
  const stage = value => {
    Services.prefs.setStringPref(`${prefix}.stage`, value);
    Services.prefs.savePrefFile(null);
  };
  async function counts() {
    // Retain the actual native connection: the manager's feature-gated accessor
    // returning null after disable must never be mistaken for an empty database.
    const rows = await connection.execute(`SELECT
      (SELECT count(*) FROM vec_history) AS vectors,
      (SELECT count(*) FROM vec_history_mapping) AS mappings`);
    return { vectors: Number(rows[0].getResultByName("vectors")), mappings: Number(rows[0].getResultByName("mappings")) };
  }
  async function empty(label) {
    const result = await counts();
    report.checks.push({ label, ...result });
    assert(result.vectors === 0 && result.mappings === 0,
      `${label} retained native data: ${JSON.stringify(result)}`);
  }
  async function run() {
    await SessionStore.promiseAllWindowsRestored;
    assert(window.FluxionMemory && !window.FluxionMemory.enabled(), "Privacy gate requires a fresh Memory-disabled profile");
    const { PlacesBrowserStartup } = ChromeUtils.importESModule(
      "moz-src:///browser/components/places/PlacesBrowserStartup.sys.mjs"
    );
    stage("waiting-for-places-startup");
    const { ProvidersManager } = ChromeUtils.importESModule(
      "moz-src:///browser/components/urlbar/UrlbarProvidersManager.sys.mjs"
    );
    for (const sap of ["urlbar", "smartbar"]) {
      const registry = ProvidersManager.getInstanceForSap(sap);
      const state = {
        sap,
        semanticPresent: Boolean(registry.getProvider("UrlbarProviderSemanticHistorySearch")),
        legacySemanticPresent: Boolean(registry.getProvider("SemanticHistorySearch")),
        ordinaryPlacesRetained: Boolean(registry.getProvider("UrlbarProviderPlaces")),
      };
      report.checks.push({ label: "native-provider-registry", ...state });
      assert(!state.semanticPresent && !state.legacySemanticPresent && state.ordinaryPlacesRetained,
        `${sap}: native semantic provider was not isolated while retaining ordinary Places: ${JSON.stringify(state)}`);
    }
    report.checks.push({ label: "native-semantic-provider-isolated-before-memory-enable", ordinaryPlacesRetained: true });
    // Session restoration does not finish fresh-profile Places initialization.
    // Establish the fixture only after those startup database/import tasks,
    // before opening another window or attaching the semantic database.
    await waitFor(() => PlacesBrowserStartup._placesBrowserInitComplete,
      "Firefox Places startup did not finish before native privacy seeding");
    report.placesStartupComplete = true;
    Services.prefs.setStringPref("browser.search.region", "US");
    // This window starts with no enabled Memory manager. Enabling the main
    // window later must not be necessary for this window to delete shared data.
    const before = new Set(Services.wm.getEnumerator("navigator:browser"));
    window.OpenBrowserWindow();
    companion = await waitFor(() => [...Services.wm.getEnumerator("navigator:browser")]
      .find(candidate => !before.has(candidate) && candidate.FluxionMemory && candidate.FluxionUI),
    "Privacy companion window did not initialise");
    assert(!companion.FluxionMemory.enabled(), "Companion did not initialise while Memory was disabled");
    await waitFor(() => [window, companion].every(target =>
      target.document.getElementById("fluxion-memory-excluded-domains")),
    "Memory Settings controls did not initialise in both windows");
    settingsMatch("initial-hidden-settings", false, "gecko-local", "");
    const settingsTab = window.gBrowser.addTrustedTab("about:preferences?fluxion=search", { skipAnimation: true });
    window.FluxionUI.setTabWorkspace(settingsTab, window.FluxionUI.currentWorkspace());
    window.gBrowser.selectedTab = settingsTab;
    await waitFor(() => window.document.getElementById("fluxion-memory-enabled")
      .getBoundingClientRect().height > 0, "Main Memory Settings did not become visible");
    const { PlacesUtils } = ChromeUtils.importESModule("resource://gre/modules/PlacesUtils.sys.mjs");
    const { getPlacesSemanticHistoryManager } = ChromeUtils.importESModule("resource://gre/modules/PlacesSemanticHistoryManager.sys.mjs");
    const { FluxionNativeMemory } = ChromeUtils.importESModule("resource://fluxion/modules/FluxionNativeMemory.sys.mjs");
    stage("opening-native-vector-database");
    report.initialCapability = await window.FluxionMemory.enable();
    settingsMatch("other-window-enable-reflected", true, "gecko-local", "");
    const manager = getPlacesSemanticHistoryManager();
    // Share storage initialization with background exclusion work. Read and
    // verify real SQL rows below, not the adapter's reported vector counts.
    connection = await FluxionNativeMemory.storageConnection();
    assert(connection, "Native semantic connection is missing");
    async function reenabledEmpty(label) {
      connection = await FluxionNativeMemory.storageConnection();
      assert(connection, `${label} could not reopen native semantic storage`);
      await empty(label);
    }
    const tensor = new Array(manager.getEmbeddingSize()).fill(0);
    assert(tensor.length > 0, "Native embedding dimension is invalid");
    tensor[0] = 1;
    const vector = PlacesUtils.tensorToSQLBindable(tensor);
    async function seed(label, id, seededVector = vector, url = `https://memory-privacy-fixture.invalid/evidence/${id}`) {
      stage(label);
      const inserted = await PlacesUtils.history.insert({ url, title: `Fluxion privacy verification evidence ${id}`,
        visits: [{ date: new Date(), transition: PlacesUtils.history.TRANSITIONS.TYPED }] });
      const canonical = await PlacesUtils.history.fetch(url, { includeVisits: true });
      const attached = await connection.execute(`SELECT id, url, url_hash, last_visit_date
        FROM places.moz_places WHERE url = :url`, { url });
      report.seedDiagnostics = { url, insertedURL: inserted?.url?.href, insertedGuid: inserted?.guid,
        insertedVisits: inserted?.visits?.length || 0,
        historyEnabled: Services.prefs.getBoolPref("places.history.enabled", true), canonicalURL: canonical?.url?.href,
        canonicalVisits: canonical?.visits?.length || 0, attachedRows: attached.length,
        nativeTransactionOpen: connection.transactionInProgress };
      if (attached.length !== 1) {
        const databases = await connection.execute("PRAGMA database_list");
        report.seedDiagnostics.databases = databases.map(row => ({
          name: row.getResultByName("name"), file: row.getResultByName("file"),
        }));
      }
      assert(canonical?.visits?.length > 0 && attached.length === 1,
        `Native privacy seed is not visible in attached Places: ${JSON.stringify(report.seedDiagnostics)}`);
      await connection.executeTransaction(async () => {
        // Use a genuine Places hash so orphan cleanup cannot independently
        // remove the seeded vector and accidentally make this test pass.
        const rows = await connection.execute(`INSERT INTO vec_history_mapping (url_hash)
          SELECT url_hash FROM places.moz_places WHERE url = :url RETURNING rowid`, { url });
        report.seedDiagnostics.returnedMappings = rows.length;
        if (rows.length !== 1) {
          const stored = await connection.execute(`SELECT m.rowid FROM vec_history_mapping m
            JOIN places.moz_places p ON p.url_hash = m.url_hash WHERE p.url = :url`, { url });
          report.seedDiagnostics.storedMappings = stored.length;
        }
        assert(rows.length === 1, "Native privacy fixture has no genuine Places mapping");
        await connection.execute("INSERT INTO vec_history (rowid, embedding) VALUES (:rowid, :vector)",
          { rowid: rows[0].getResultByName("rowid"), vector: seededVector });
      });
      const result = await counts();
      report.checks.push({ label, ...result });
      assert(result.vectors > 0 && result.mappings > 0, `${label} did not populate actual native tables`);
      return url;
    }
    const nonSentinel = new Array(tensor.length).fill(0);
    assert(nonSentinel.length > 1, "Native fixture needs at least two vector dimensions");
    nonSentinel[1] = 1;
    async function storedVector(url) {
      const rows = await connection.execute(`SELECT v.embedding AS embedding
        FROM vec_history_mapping m JOIN vec_history v ON v.rowid = m.rowid
        JOIN places.moz_places p ON p.url_hash = m.url_hash WHERE p.url = :url`, { url });
      assert(rows.length === 1, "Excluded-page mapping must remain paired with exactly one native vector");
      const bytes = Uint8Array.from(rows[0].getResultByName("embedding"));
      assert(bytes.byteLength === tensor.length * 4, "Native vector blob has an unexpected byte length");
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      return Array.from({ length: tensor.length }, (_, index) => view.getFloat32(index * 4, true));
    }
    const blockedURL = "https://memory-privacy-fixture.invalid/%2561ccount/encoded-evidence";
    const safeURL = "https://memory-privacy-fixture.invalid/guides/accounting-evidence";
    const nonSentinelBlob = PlacesUtils.tensorToSQLBindable(nonSentinel);
    await companion.FluxionMemory.setExcludedDomains([]);
    await seed("seed-sensitive-native-path", 91047010, nonSentinelBlob, blockedURL);
    await seed("seed-safe-native-neighbor", 91047011, nonSentinelBlob, safeURL);
    assert((await storedVector(blockedURL)).every((value, i) => value === nonSentinel[i]), "Sensitive seed was already scrubbed");
    stage("sensitive-path-policy-sweep");
    await companion.FluxionMemory.setExcludedDomains([]);
    assert((await storedVector(blockedURL)).every((value, i) => value === tensor[i]), "Encoded sensitive path retained native vector evidence");
    assert((await storedVector(safeURL)).every((value, i) => value === nonSentinel[i]), "Sensitive-path sweep changed safe same-host vector bytes");
    for (const url of [blockedURL, safeURL]) assert((await PlacesUtils.history.fetch(url, { includeVisits: true }))?.visits?.length > 0,
      "Memory privacy sweep removed ordinary Places history");
    const filtered = await companion.FluxionMemory.search("privacy verification");
    assert(!filtered.results.some(item => item.url === blockedURL) && filtered.results.some(item => item.url === safeURL),
      "Memory did not filter sensitive native history while retaining its ordinary neighbor");
    report.checks.push({ label: "encoded-sensitive-native-scrub-safe-neighbor-retained", mappingRetained: true, placesRetained: true, resultFiltered: true });

    const { FluxionMemoryStore } = ChromeUtils.importESModule("resource://fluxion/modules/FluxionMemoryStore.sys.mjs");
    const { Sqlite } = ChromeUtils.importESModule("resource://gre/modules/Sqlite.sys.mjs");
    await FluxionMemoryStore.get(safeURL); // Finish schema opening before simulating old-build evidence.
    const enriched = await Sqlite.openConnection({ path: window.PathUtils.join(window.PathUtils.profileDir, "fluxion_memory.sqlite"), extensions: ["vec"] });
    try {
      const schema = await enriched.execute("SELECT sql FROM sqlite_master WHERE name = 'page_vectors'");
      const dimension = Number(schema[0]?.getResultByName("sql").match(/FLOAT\[(\d+)\]/i)?.[1]);
      assert(dimension > 1 && dimension <= 4096, "Enriched native vector schema dimension is invalid");
      const oldVector = new Array(dimension).fill(0); oldVector[1] = 1;
      // Direct SQL intentionally bypasses the new upsert policy: these rows
      // represent data retained by an older installed browser build.
      async function seedEnriched(id, url) {
        await enriched.execute(`INSERT INTO pages
          (id,url,title,description,headings,content,workspace,workspace_name,tab_group,last_visit,visit_count,indexed_at,
           search_title,search_url,search_description,search_headings,search_content)
          VALUES (:id,:url,'Privacy verification','','','Legacy evidence','focus','','',:now,1,:now,
           'privacy verification',:url,'','','legacy evidence')`, { id, url, now: Date.now() });
        await enriched.execute("INSERT INTO page_vectors(rowid,embedding) VALUES(:id,:vector)",
          { id, vector: PlacesUtils.tensorToSQLBindable(oldVector) });
      }
      for (const [id, url] of [[91047010, blockedURL], [91047011, safeURL]]) await seedEnriched(id, url);
      const rawCounts = async id => {
        const rows = await enriched.execute(`SELECT
          (SELECT count(*) FROM pages WHERE id=:id) AS pages,
          (SELECT count(*) FROM page_vectors WHERE rowid=:id) AS vectors`, { id });
        return { pages: Number(rows[0].getResultByName("pages")), vectors: Number(rows[0].getResultByName("vectors")) };
      };
      for (const id of [91047010, 91047011]) {
        const before = await rawCounts(id);
        assert(before.pages === 1 && before.vectors === 1, "Old-build enriched fixture was not populated");
      }
      stage("pruning-old-enriched-sensitive-evidence");
      await FluxionMemoryStore.pruneExisting();
      const blocked = await rawCounts(91047010), safe = await rawCounts(91047011);
      assert(blocked.pages === 0 && blocked.vectors === 0 && safe.pages === 1 && safe.vectors === 1,
        `Existing enriched policy cleanup was not selective: ${JSON.stringify({ blocked, safe })}`);
      assert(await FluxionMemoryStore.get(blockedURL) === null && (await FluxionMemoryStore.get(safeURL))?.url === safeURL,
        "Enriched store still exposed sensitive evidence or lost its safe neighbor");
      for (const url of [blockedURL, safeURL]) assert((await PlacesUtils.history.fetch(url, { includeVisits: true }))?.visits?.length > 0,
        "Enriched privacy cleanup removed Places history");
      report.checks.push({ label: "old-enriched-sensitive-text-and-vector-deleted", blocked, safe });

      stage("creating-disabled-exclusion-list");
      const listDomains = ["list-privacy-fixture.invalid"];
      const listed = ["https://list-privacy-fixture.invalid/research/page", "https://research.list-privacy-fixture.invalid/article"];
      const initialPolicy = companion.FluxionMemory.exclusionPolicy();
      assert(initialPolicy.valid && !initialPolicy.readOnly, "Companion exclusion policy is not editable");
      const created = await companion.FluxionMemory.saveExclusionList({ name: "Research privacy", enabled: false, domains: listDomains }, initialPolicy.revision);
      const list = created.lists.find(item => item.name === "Research privacy");
      assert(list?.id && !list.enabled, "Disabled exclusion list was not created");
      for (let index = 0; index < listed.length; index++) {
        const id = 91047012 + index;
        await seed("seed-disabled-list-native-evidence", id, nonSentinelBlob, listed[index]);
        await seedEnriched(id, listed[index]);
        assert((await rawCounts(id)).pages === 1 && (await storedVector(listed[index]))[1] === 1,
          "Disabled list fixture did not retain initial evidence");
      }
      stage("enabling-list-from-companion-window");
      const enabledPolicy = await companion.FluxionMemory.saveExclusionList({ ...list, enabled: true }, created.revision);
      assert(window.FluxionMemory.exclusionPolicy().revision === enabledPolicy.revision,
        "Main window did not observe the same atomic exclusion policy");
      settingsMatch("list-policy-keeps-direct-domain-field-separate", true, "gecko-local", "");
      for (let index = 0; index < listed.length; index++) {
        const remaining = await rawCounts(91047012 + index);
        assert(remaining.pages === 0 && remaining.vectors === 0, "Enabled list retained enriched text or vectors");
        assert((await storedVector(listed[index])).every((value, i) => value === tensor[i]),
          "Enabled list retained a native vector on its domain or subdomain");
        assert((await PlacesUtils.history.fetch(listed[index], { includeVisits: true }))?.visits?.length > 0,
          "Enabling an exclusion list removed ordinary history");
      }
      assert((await rawCounts(91047011)).pages === 1 && (await rawCounts(91047011)).vectors === 1 &&
        (await storedVector(safeURL)).every((value, i) => value === nonSentinel[i]), "List cleanup changed safe evidence");
      stage("checking-cold-native-candidate-boundary");
      report.checks.push(await window.FluxionMemoryCandidateVerification.run({ manager, connection, PlacesUtils,
        storedVector, sentinel: tensor, drain: () => FluxionNativeMemory.drainWrites() }));
      for (const target of [window, companion]) {
        const results = (await target.FluxionMemory.search("privacy verification")).results;
        assert(!results.some(item => listed.includes(item.url)) && results.some(item => item.url === safeURL),
          "List exclusion did not filter both windows while retaining safe history");
      }
      let rejected = false;
      try { await window.FluxionMemory.saveExclusionList({ ...list, name: "Stale overwrite" }, created.revision); }
      catch (error) { rejected = error.code === "POLICY_CONFLICT"; }
      assert(rejected && window.FluxionMemory.exclusionPolicy().revision === enabledPolicy.revision,
        "Stale list edit overwrote the current policy");
      const beforePrivate = new Set(Services.wm.getEnumerator("navigator:browser"));
      window.OpenBrowserWindow({ private: true });
      privateCompanion = await waitFor(() => [...Services.wm.getEnumerator("navigator:browser")]
        .find(candidate => !beforePrivate.has(candidate) && candidate.FluxionMemory), "Private policy window did not initialise");
      const privatePolicy = privateCompanion.FluxionMemory.exclusionPolicy();
      const privateSearch = await privateCompanion.FluxionMemory.search("privacy verification");
      assert(privatePolicy.readOnly && privateSearch.state === "private" && privateSearch.results.length === 0,
        "Private policy was not read-only or exposed Memory results");
      let privateRejected = false;
      try { await privateCompanion.FluxionMemory.deleteExclusionList(list.id, privatePolicy.revision); }
      catch (_) { privateRejected = true; }
      assert(privateRejected && window.FluxionMemory.exclusionPolicy().revision === enabledPolicy.revision,
        "Private window changed persistent exclusions");
      privateCompanion.close();
      await waitFor(() => privateCompanion.closed, "Private policy fixture did not close");
      const disabledPolicy = await window.FluxionMemory.saveExclusionList({ ...list, enabled: false }, enabledPolicy.revision);
      await companion.FluxionMemory.deleteExclusionList(list.id, disabledPolicy.revision);
      for (let index = 0; index < listed.length; index++) {
        const remaining = await rawCounts(91047012 + index);
        assert(remaining.pages === 0 && remaining.vectors === 0 &&
          (await storedVector(listed[index])).every((value, i) => value === tensor[i]),
          "Disabling or deleting a list resurrected deleted page evidence");
      }
      report.checks.push({ label: "user-list-domain-and-subdomain-cross-window-selective-cleanup",
        placesRetained: true, safeVectorsRetained: true, staleEditRejected: true, privateWriteRejected: true,
        noEvidenceResurrection: true });
    } finally { await enriched.close(); }

    const excludedURL = await seed("seed-before-provider-disable", 91047001, nonSentinelBlob);
    const initialVector = await storedVector(excludedURL);
    assert(initialVector[0] === 0 && initialVector[1] === 1, "Exclusion fixture was already a sentinel");
    stage("excluding-native-evidence-from-other-window");
    await companion.FluxionMemory.setExcludedDomains(["memory-privacy-fixture.invalid"]);
    settingsMatch("other-window-exclusion-reflected", true, "gecko-local", "memory-privacy-fixture.invalid");
    const scrubbed = await storedVector(excludedURL);
    assert(scrubbed[0] === 1 && scrubbed.slice(1).every(value => value === 0),
      "Other-window domain exclusion did not scrub actual native vector bytes");
    report.checks.push({ label: "other-window-exclusion-scrub", mappingRetained: true,
      originalVectorReplaced: true, dimensions: scrubbed.length });
    await window.FluxionMemory.setEmbeddingProvider("disabled");
    settingsMatch("other-window-provider-reflected", true, "disabled", "memory-privacy-fixture.invalid");
    await empty("provider-disabled");
    const recall = await companion.FluxionMemory.search("privacy verification");
    assert(!recall.results.some(result => result.url === excludedURL), "Excluded page leaked into keyword-only Memory results");
    report.checks.push({ label: "excluded-evidence-filtered-from-keyword-results", filtered: true });
    await companion.FluxionMemory.setExcludedDomains([]);
    await window.FluxionMemory.setEmbeddingProvider("gecko-local");
    await reenabledEmpty("provider-reenabled");
    await seed("seed-before-other-window-disable", 91047002);
    await companion.FluxionMemory.setEmbeddingProvider("disabled");
    await empty("other-window-provider-disabled");
    await window.FluxionMemory.setEmbeddingProvider("gecko-local");
    await reenabledEmpty("other-window-provider-reenabled");
    await seed("seed-before-other-window-clear", 91047003);
    await companion.FluxionMemory.clearAndDisable();
    settingsMatch("other-window-clear-reflected", false, "gecko-local", "");
    assert(!window.FluxionMemory.enabled(), "Other-window clear did not disable shared Memory");
    await empty("other-window-clear-and-disable");
    await window.FluxionMemory.enable();
    settingsMatch("other-window-reenable-reflected", true, "gecko-local", "");
    await reenabledEmpty("memory-reenabled-after-clear");
    await window.FluxionMemory.clearAndDisable();
    settingsMatch("final-settings-disabled", false, "gecko-local", "");
    await empty("final-disabled-state");
    report.reenableScope = "Immediate empty-state check; newly opted-in indexing of retained ordinary history may legitimately generate new vectors later";
  }
  async function closeCompanions() {
    const failures = [];
    for (const target of [privateCompanion, companion]) {
      try {
        if (!target || target.closed) continue;
        target.close();
        await waitFor(() => target.closed, "Memory privacy companion did not close");
      } catch (error) { failures.push(error); }
    }
    if (failures.length) throw new Error(failures.map(error => error.message).join("; "));
  }
  run().then(async () => {
    await closeCompanions();
    Services.prefs.setStringPref(`${prefix}.report`, JSON.stringify(report));
    Services.prefs.setStringPref(`${prefix}.health`, "native-vectors-cleared-across-windows");
    Services.prefs.savePrefFile(null);
  }).catch(async error => {
    try { await closeCompanions(); } catch (cleanupError) { Cu.reportError(cleanupError); }
    Services.prefs.clearUserPref(`${prefix}.health`);
    Services.prefs.setStringPref(`${prefix}.report`, JSON.stringify(report));
    Services.prefs.setStringPref(`${prefix}.error`, `${error?.message || error}\n${error?.stack || ""}`);
    Cu.reportError(error);
    Services.prefs.savePrefFile(null);
  });
})(window);
