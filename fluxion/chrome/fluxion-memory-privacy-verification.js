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
    assert(await window.FluxionMemory.enable() === "semantic", "Native semantic database is unavailable");
    const manager = getPlacesSemanticHistoryManager();
    connection = await manager.getConnection();
    assert(connection, "Native semantic connection is missing");
    async function reenabledEmpty(label) {
      connection = await manager.getConnection();
      assert(connection, `${label} could not reopen native semantic storage`);
      await empty(label);
    }
    const tensor = new Float32Array(manager.getEmbeddingSize());
    assert(tensor.length > 0, "Native embedding dimension is invalid");
    tensor[0] = 1;
    const vector = PlacesUtils.tensorToSQLBindable(tensor);
    async function seed(label, id) {
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
          { rowid: rows[0].getResultByName("rowid"), vector });
      });
      const result = await counts();
      report.checks.push({ label, ...result });
      assert(result.vectors > 0 && result.mappings > 0, `${label} did not populate actual native tables`);
    }
    await seed("seed-before-provider-disable", 91047001);
    await window.FluxionMemory.setEmbeddingProvider("disabled");
    await empty("provider-disabled");
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
