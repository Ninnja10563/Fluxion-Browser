/* global Services, ChromeUtils, PathUtils, Cc, Ci, Cu */
(function verifyCorruptMemoryPolicy(window) {
  "use strict";
  const phase = Services.env.get("FLUXION_MEMORY_CORRUPTION_TEST");
  if (!["seed", "check"].includes(phase)) return;
  const prefix = "fluxion.memory.corruptionVerification";
  const url = "https://memory-corruption-fixture.invalid/article";
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const write = (key, value) => {
    Services.prefs.setStringPref(`${prefix}.${key}`, value);
    Services.prefs.savePrefFile(null);
  };
  const report = { phase, fixture: "synthetic native vec0 storage; no model inference", checks: [] };
  async function waitFor(check, message) {
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      if (await check()) return;
      await new Promise(resolve => window.setTimeout(resolve, 100));
    }
    throw new Error(message);
  }
  function disabled() {
    assert(window.FluxionMemory && !window.FluxionMemory.enabled(), "Memory must remain disabled");
    for (const pref of ["fluxion.memory.enabled", "browser.ml.enable", "places.semanticHistory.featureGate",
      "places.semanticHistory.smartwindow.featureGate"]) {
      assert(!Services.prefs.getBoolPref(pref, false), `Unexpected enabled gate: ${pref}`);
    }
  }
  async function run() {
    const profile = Services.env.get("FLUXION_PROFILE");
    assert(/\/fluxion-memory-corruption\.[^/]+\/profile\/?$/.test(profile), "Requires isolated corruption profile");
    const expected = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    expected.initWithPath(profile); expected.normalize();
    const actual = Services.dirsvc.get("ProfD", Ci.nsIFile); actual.normalize();
    assert(actual.equals(expected), "Profile differs from owned corruption fixture");
    const claim = `${prefix}.${phase}.claimed`;
    if (Services.prefs.getBoolPref(claim, false)) return;
    Services.prefs.setBoolPref(claim, true);
    disabled();
    const { PlacesBrowserStartup } = ChromeUtils.importESModule("moz-src:///browser/components/places/PlacesBrowserStartup.sys.mjs");
    await waitFor(() => PlacesBrowserStartup._placesBrowserInitComplete, "Places startup did not finish");
    const { PlacesUtils } = ChromeUtils.importESModule("resource://gre/modules/PlacesUtils.sys.mjs");
    const { Sqlite } = ChromeUtils.importESModule("resource://gre/modules/Sqlite.sys.mjs");
    const path = PathUtils.join(PathUtils.profileDir, "places_semantic.sqlite");
    if (phase === "seed") {
      write("stage", "seeding-prior-native-storage");
      Services.prefs.setStringPref("browser.search.region", "US");
      const { FluxionNativeMemory } = ChromeUtils.importESModule("resource://fluxion/modules/FluxionNativeMemory.sys.mjs");
      const db = await FluxionNativeMemory.storageConnection();
      const manager = FluxionNativeMemory.getManager();
      const inserted = await PlacesUtils.history.insert({ url, title: "Corruption retention fixture",
        visits: [{ date: new Date(), transition: PlacesUtils.history.TRANSITIONS.TYPED }] });
      assert(inserted?.url?.href === url && (await PlacesUtils.history.fetch(url, { includeVisits: true }))?.visits?.length > 0,
        "Seed did not persist an ordinary Places visit");
      const vector = PlacesUtils.tensorToSQLBindable(new Array(manager.getEmbeddingSize()).fill(0.25));
      await db.executeTransaction(async () => {
        const rows = await db.execute(`INSERT INTO vec_history_mapping(url_hash)
          SELECT url_hash FROM places.moz_places WHERE url=:url RETURNING rowid`, { url });
        assert(rows.length === 1, "Seed did not create exactly one genuine Places mapping");
        await db.execute("INSERT INTO vec_history(rowid,embedding) VALUES(:id,:vector)",
          { id: rows[0].getResultByName("rowid"), vector });
      });
      const rows = await db.execute(`SELECT v.rowid,hex(v.embedding) AS bytes,m.url_hash AS hash
        FROM vec_history v JOIN vec_history_mapping m ON m.rowid=v.rowid`);
      assert(rows.length === 1 && rows[0].getResultByName("bytes"), "Seed native bytes are missing");
      write("baseline", JSON.stringify({ id: rows[0].getResultByName("rowid"), bytes: rows[0].getResultByName("bytes"),
        hash: String(rows[0].getResultByName("hash")) }));
      // Emulate an already-initialized older process whose policy became
      // unreadable on disk. This marker is set LAST, after live observers, so
      // the next process must independently prevent Gecko's unavailable purge.
      Services.prefs.setStringPref("fluxion.memory.exclusionPolicy", "{invalid fixture policy");
      Services.prefs.setBoolPref("places.semanticHistory.removeOnStartup", false);
      Services.prefs.setBoolPref("places.semanticHistory.initialized", true);
      assert(!window.FluxionMemory.exclusionPolicy().valid, "Fixture policy must be invalid");
      report.checks.push("previously-initialized-native-vector-and-mapping-seeded");
    } else {
      write("stage", "direct-native-consumer-initialization");
      assert(!window.FluxionMemory.exclusionPolicy().valid, "Malformed policy did not persist");
      assert(!Services.prefs.prefHasUserValue("places.semanticHistory.initialized"), "Startup did not clear native activation marker");
      assert(!Services.prefs.getBoolPref("places.semanticHistory.removeOnStartup", false), "Corruption invented deletion intent");
      assert(!Services.prefs.getBoolPref("fluxion.memory.nativePendingRemoval", false), "Corruption invented pending removal");
      // Deliberately bypass Fluxion's getManager guard, as Gecko's URL-bar
      // provider can. Awaiting this getter waits for the upstream constructor's
      // file-removal lifecycle even though its disabled result is null.
      const { getPlacesSemanticHistoryManager } = ChromeUtils.importESModule("resource://gre/modules/PlacesSemanticHistoryManager.sys.mjs");
      const manager = getPlacesSemanticHistoryManager();
      assert(await manager.getConnection() === null, "Native semantic search unexpectedly became available");
      const baseline = JSON.parse(Services.prefs.getStringPref(`${prefix}.baseline`, "null"));
      assert(baseline?.bytes && Number.isInteger(baseline.id), "Missing seed baseline");
      let db = await Sqlite.openConnection({ path, extensions: ["vec"], readOnly: true });
      try {
        const rows = await db.execute(`SELECT v.rowid,hex(v.embedding) AS bytes,m.url_hash AS hash
          FROM vec_history v JOIN vec_history_mapping m ON m.rowid=v.rowid`);
        assert(rows.length === 1 && rows[0].getResultByName("rowid") === baseline.id &&
          rows[0].getResultByName("bytes") === baseline.bytes && String(rows[0].getResultByName("hash")) === baseline.hash,
        "Native consumer erased or changed retained evidence");
      } finally { await db.close(); }
      assert((await PlacesUtils.history.fetch(url, { includeVisits: true }))?.visits?.length > 0,
        "Corruption retention changed ordinary browsing history");
      report.checks.push("direct-gecko-consumer-disabled-without-data-loss", "native-vector-and-mapping-byte-identity-retained", "ordinary-places-visit-retained");
      write("stage", "verifying-explicit-purge-still-honored");
      const { FluxionNativeMemory } = ChromeUtils.importESModule("resource://fluxion/modules/FluxionNativeMemory.sys.mjs");
      await FluxionNativeMemory.purge();
      db = await Sqlite.openConnection({ path, extensions: ["vec"], readOnly: true });
      try {
        const row = (await db.execute(`SELECT (SELECT count(*) FROM vec_history) AS vectors,
          (SELECT count(*) FROM vec_history_mapping) AS mappings`))[0];
        assert(row.getResultByName("vectors") === 0 && row.getResultByName("mappings") === 0,
          "Explicit purge was blocked by corrupted policy");
      } finally { await db.close(); }
      report.checks.push("explicit-native-purge-still-removes-evidence");
    }
    disabled();
    write("report", JSON.stringify(report));
    write(`${phase}.health`, phase === "seed" ? "native-corruption-baseline-seeded" : "native-corruption-retention-verified");
  }
  run().catch(error => {
    // A preference flush can fail after setting the in-memory success value.
    // Never let a later shutdown flush turn that failed run into a success.
    try { Services.prefs.clearUserPref(`${prefix}.${phase}.health`); }
    catch (cleanupError) { Cu.reportError(cleanupError); }
    try { write("error", `${error.message}\n${error.stack || ""}`); } finally { Cu.reportError(error); }
  });
})(window);
