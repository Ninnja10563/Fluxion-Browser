/* global Services, SessionStore, ChromeUtils, Cu */
(function verifyMemoryPrivacy(window) {
  "use strict";
  if (Services.env.get("FLUXION_MEMORY_PRIVACY_TEST") !== "1") return;
  const prefix = "fluxion.memory.privacy";
  if (Services.prefs.getBoolPref(`${prefix}.claimed`, false)) return;
  Services.prefs.setBoolPref(`${prefix}.claimed`, true);
  const report = { fixture: "explicit-native-tensors-not-model-inference", checks: [] };
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const pause = ms => new Promise(resolve => window.setTimeout(resolve, ms));
  const waitFor = async (check, message) => {
    const deadline = Date.now() + 20000;
    do { const result = check(); if (result) return result; await pause(50); } while (Date.now() < deadline);
    throw new Error(message);
  };
  let companion;
  let connection;
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
    Services.prefs.setStringPref("browser.search.region", "US");
    // This window starts with no enabled Memory manager. Enabling the main
    // window later must not be necessary for this window to delete shared data.
    const before = new Set(Services.wm.getEnumerator("navigator:browser"));
    window.OpenBrowserWindow();
    companion = await waitFor(() => [...Services.wm.getEnumerator("navigator:browser")]
      .find(candidate => !before.has(candidate) && candidate.FluxionMemory && candidate.FluxionUI),
    "Privacy companion window did not initialise");
    assert(!companion.FluxionMemory.enabled(), "Companion did not initialise while Memory was disabled");
    const { PlacesUtils } = ChromeUtils.importESModule("resource://gre/modules/PlacesUtils.sys.mjs");
    const { getPlacesSemanticHistoryManager } = ChromeUtils.importESModule("resource://gre/modules/PlacesSemanticHistoryManager.sys.mjs");
    stage("opening-native-vector-database");
    report.initialCapability = await window.FluxionMemory.enable();
    const manager = getPlacesSemanticHistoryManager();
    // Unsupported semantic-search hardware still has native storage to erase.
    // Finish Gecko's startup lifecycle before obtaining storage-only access.
    await manager.getConnection();
    connection = await manager.semanticDB.getConnection();
    assert(connection, "Native semantic connection is missing");
    async function reenabledEmpty(label) {
      await manager.getConnection();
      connection = await manager.semanticDB.getConnection();
      assert(connection, `${label} could not reopen native semantic storage`);
      await empty(label);
    }
    const tensor = new Array(manager.getEmbeddingSize()).fill(0);
    assert(tensor.length > 0, "Native embedding dimension is invalid");
    tensor[0] = 1;
    const vector = PlacesUtils.tensorToSQLBindable(tensor);
    async function seed(label, id, seededVector = vector) {
      stage(label);
      const url = `https://memory-privacy-fixture.invalid/evidence/${id}`;
      await PlacesUtils.history.insert({ url, title: `Fluxion privacy verification evidence ${id}`,
        visits: [{ date: new Date(), transition: PlacesUtils.history.TRANSITIONS.TYPED }] });
      await connection.executeTransaction(async () => {
        // Use a genuine Places hash so orphan cleanup cannot independently
        // remove the seeded vector and accidentally make this test pass.
        const rows = await connection.execute(`INSERT INTO vec_history_mapping (url_hash)
          SELECT url_hash FROM places.moz_places WHERE url = :url RETURNING rowid`, { url });
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
    const excludedURL = await seed("seed-before-provider-disable", 91047001,
      PlacesUtils.tensorToSQLBindable(nonSentinel));
    async function storedExcludedVector() {
      const rows = await connection.execute(`SELECT v.embedding AS embedding
        FROM vec_history_mapping m JOIN vec_history v ON v.rowid = m.rowid
        JOIN places.moz_places p ON p.url_hash = m.url_hash WHERE p.url = :url`, { url: excludedURL });
      assert(rows.length === 1, "Excluded-page mapping must remain paired with exactly one native vector");
      const bytes = Uint8Array.from(rows[0].getResultByName("embedding"));
      assert(bytes.byteLength === tensor.length * 4, "Native vector blob has an unexpected byte length");
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      return Array.from({ length: tensor.length }, (_, index) => view.getFloat32(index * 4, true));
    }
    const initialVector = await storedExcludedVector();
    assert(initialVector[0] === 0 && initialVector[1] === 1, "Exclusion fixture was already a sentinel");
    stage("excluding-native-evidence-from-other-window");
    await companion.FluxionMemory.setExcludedDomains(["memory-privacy-fixture.invalid"]);
    const scrubbed = await storedExcludedVector();
    assert(scrubbed[0] === 1 && scrubbed.slice(1).every(value => value === 0),
      "Other-window domain exclusion did not scrub actual native vector bytes");
    report.checks.push({ label: "other-window-exclusion-scrub", mappingRetained: true,
      originalVectorReplaced: true, dimensions: scrubbed.length });
    await window.FluxionMemory.setEmbeddingProvider("disabled");
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
    assert(!window.FluxionMemory.enabled(), "Other-window clear did not disable shared Memory");
    await empty("other-window-clear-and-disable");
    await window.FluxionMemory.enable();
    await reenabledEmpty("memory-reenabled-after-clear");
    await window.FluxionMemory.clearAndDisable();
    await empty("final-disabled-state");
    report.reenableScope = "Immediate empty-state check; newly opted-in indexing of retained ordinary history may legitimately generate new vectors later";
  }
  run().then(() => {
    Services.prefs.setStringPref(`${prefix}.report`, JSON.stringify(report));
    Services.prefs.setStringPref(`${prefix}.health`, "native-vectors-cleared-across-windows");
  }).catch(error => {
    Services.prefs.setStringPref(`${prefix}.report`, JSON.stringify(report));
    Services.prefs.setStringPref(`${prefix}.error`, `${error?.message || error}\n${error?.stack || ""}`);
    Cu.reportError(error);
  }).finally(() => {
    companion?.close();
    Services.prefs.savePrefFile(null);
  });
})(window);
