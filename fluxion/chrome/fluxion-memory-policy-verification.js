/* global Services, ChromeUtils, PathUtils, Cc, Ci, Cu */
(function verifyMemoryPolicyStartup(window) {
  "use strict";
  const phase = Services.env.get("FLUXION_MEMORY_POLICY_TEST");
  if (!["seed", "check"].includes(phase)) return;
  const prefix = "fluxion.memory.policyVerification";
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const write = (key, value) => {
    Services.prefs.setStringPref(`${prefix}.${key}`, value);
    Services.prefs.savePrefFile(null);
  };
  const urls = ["https://memory-policy-fixture.invalid/%61ccount", "https://memory-policy-fixture.invalid/article",
    "https://excluded-policy-fixture.invalid/research"];
  const report = { phase, vectors: "synthetic vec0 storage; no model inference", checks: [] };
  async function waitFor(check, message) {
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      if (await check()) return;
      await new Promise(resolve => window.setTimeout(resolve, 100));
    }
    throw new Error(message);
  }
  function disabled() {
    assert(window.FluxionMemory && !window.FluxionMemory.enabled(), "Browser Memory unexpectedly enabled");
    for (const pref of ["fluxion.memory.enabled", "browser.ml.enable", "places.semanticHistory.featureGate"]) {
      assert(!Services.prefs.getBoolPref(pref, false), `Unexpected enabled gate: ${pref}`);
    }
  }
  async function run() {
    assert(/\/fluxion-memory-policy\.[^/]+\/profile\/?$/.test(Services.env.get("FLUXION_PROFILE")), "Requires isolated Memory policy profile");
    const expectedProfile = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    expectedProfile.initWithPath(Services.env.get("FLUXION_PROFILE"));
    expectedProfile.normalize();
    const actualProfile = Services.dirsvc.get("ProfD", Ci.nsIFile);
    actualProfile.normalize();
    assert(actualProfile.equals(expectedProfile), "Profile directory differs from owned fixture");
    const claim = `${prefix}.${phase}.claimed`;
    if (Services.prefs.getBoolPref(claim, false)) return;
    Services.prefs.setBoolPref(claim, true);
    disabled();
    const { Sqlite } = ChromeUtils.importESModule("resource://gre/modules/Sqlite.sys.mjs");
    const { PlacesUtils } = ChromeUtils.importESModule("resource://gre/modules/PlacesUtils.sys.mjs");
    const { PlacesBrowserStartup } = ChromeUtils.importESModule("moz-src:///browser/components/places/PlacesBrowserStartup.sys.mjs");
    await waitFor(() => PlacesBrowserStartup._placesBrowserInitComplete, "Places initialization did not finish");
    const dbPath = PathUtils.join(PathUtils.profileDir, "fluxion_memory.sqlite");
    if (phase === "seed") {
      write("stage", "initializing-current-owned-schema");
      // Keep Gecko's regional embedding dimension fixed across this storage
      // fixture's launches; this does not enable or invoke its model.
      Services.prefs.setStringPref("browser.search.region", "US");
      Services.prefs.savePrefFile(null);
      const policy = window.FluxionMemory.exclusionPolicy();
      const saved = await window.FluxionMemory.saveExclusionList({ name: "Startup exclusions", enabled: true,
        domains: ["excluded-policy-fixture.invalid"] }, policy.revision);
      assert(saved.valid && saved.lists.some(list => list.enabled && list.name === "Startup exclusions"),
        "Startup fixture did not persist its enabled exclusion list");
      disabled();
      const { FluxionMemoryStore } = ChromeUtils.importESModule("resource://fluxion/modules/FluxionMemoryStore.sys.mjs");
      await FluxionMemoryStore.get(urls[1]);
      await FluxionMemoryStore.pruneExisting();
      for (const url of urls) await PlacesUtils.history.insert({ url, title: "Policy fixture", visits: [{ date: new Date(), transition: PlacesUtils.history.TRANSITIONS.TYPED }] });
      const db = await Sqlite.openConnection({ path: dbPath, extensions: ["vec"] });
      try {
        const definition = (await db.execute("SELECT sql FROM sqlite_master WHERE name='page_vectors'"))[0].getResultByName("sql");
        const dimension = Number(definition.match(/embedding\s+FLOAT\s*\[\s*(\d+)\s*\]/i)?.[1]);
        assert(Number.isInteger(dimension) && dimension > 0 && dimension <= 16384, "Invalid native vector dimension");
        const vector = PlacesUtils.tensorToSQLBindable(new Array(dimension).fill(0.25));
        // Deliberately bypass current policy to emulate evidence from an older
        // build. Actual Gecko Sqlite/vec0 bytes, not semantic model output.
        await db.executeTransaction(async () => {
          for (let index = 0; index < urls.length; index++) {
            await db.executeCached(`INSERT INTO pages
              (id,url,title,description,headings,content,workspace,workspace_name,tab_group,last_visit,indexed_at,
               search_title,search_url,search_description,search_headings,search_content)
              VALUES (:id,:url,'Policy fixture','','','Original evidence','focus','Focus','',1,1,
               'policy fixture',:url,'','','original evidence')`, { id: index + 1, url: urls[index] });
            await db.executeCached("INSERT INTO page_vectors(rowid,embedding) VALUES(:id,:vector)", { id: index + 1, vector });
          }
        });
        const rows = await db.execute("SELECT rowid,hex(embedding) AS bytes FROM page_vectors ORDER BY rowid");
        assert(rows.length === 3, "Seed must contain all three native vectors");
        write("safeBytes", rows[1].getResultByName("bytes"));
        assert((await db.execute("SELECT count(*) AS n FROM pages"))[0].getResultByName("n") === 3, "Seed evidence missing");
      } finally { await db.close(); }
      for (const url of urls) assert(await PlacesUtils.history.fetch(url, { includeVisits: true }), "Seed Places visit missing");
      report.checks.push("prior-build-sensitive-and-safe-pages-with-native-vectors-seeded");
    } else {
      write("stage", "observing-ordinary-disabled-startup-cleanup");
      const savedPolicy = JSON.parse(Services.prefs.getStringPref("fluxion.memory.exclusionPolicy", "null"));
      assert(savedPolicy?.version === 1 && savedPolicy.lists.some(list => list.enabled &&
        list.domains.includes("excluded-policy-fixture.invalid")), "Enabled exclusion list did not persist");
      // Do not import or call Store get/search/prune here. Only the ordinary
      // window startup path may cause the removal this launch must prove.
      const db = await Sqlite.openConnection({ path: dbPath, extensions: ["vec"], readOnly: true });
      try {
        await waitFor(async () => (await db.execute("SELECT count(*) AS n FROM pages WHERE id=1"))[0].getResultByName("n") === 0,
          "Ordinary disabled startup retained sensitive evidence");
        assert((await db.execute("SELECT count(*) AS n FROM page_vectors WHERE rowid=1"))[0].getResultByName("n") === 0, "Sensitive vector survived startup cleanup");
        await waitFor(async () => (await db.execute("SELECT count(*) AS n FROM pages WHERE id=3"))[0].getResultByName("n") === 0,
          "Ordinary disabled startup retained list-excluded evidence");
        assert((await db.execute("SELECT count(*) AS n FROM page_vectors WHERE rowid=3"))[0].getResultByName("n") === 0,
          "List-excluded vector survived startup cleanup");
        const safe = (await db.execute("SELECT url,content FROM pages WHERE id=2"))[0];
        assert(safe?.getResultByName("url") === urls[1] && safe.getResultByName("content") === "Original evidence", "Safe evidence changed");
        const bytes = (await db.execute("SELECT hex(embedding) AS bytes FROM page_vectors WHERE rowid=2"))[0]?.getResultByName("bytes");
        assert(bytes && bytes === Services.prefs.getStringPref(`${prefix}.safeBytes`, ""), "Safe native vector bytes changed");
      } finally { await db.close(); }
      for (const url of urls) {
        const page = await PlacesUtils.history.fetch(url, { includeVisits: true });
        assert(page?.visits?.length > 0, "Memory cleanup removed an ordinary Places visit");
      }
      report.checks.push("disabled-startup-removes-sensitive-page-and-vector", "disabled-startup-removes-list-excluded-page-and-vector",
        "safe-evidence-and-vector-bytes-preserved", "ordinary-places-visits-retained");
    }
    disabled();
    write("report", JSON.stringify(report));
    write(`${phase}.health`, phase === "seed" ? "prior-build-evidence-seeded" : "disabled-startup-policy-cleanup-verified");
  }
  run().catch(error => {
    write("error", `${error.message}\n${error.stack || ""}`);
    Cu.reportError(error);
  });
})(window);
