/* global Services, ChromeUtils, PathUtils, IOUtils, Cu */
(function verifyMemoryMigration(window) {
  "use strict";
  if (Services.env.get("FLUXION_SEMANTIC_MODEL_TEST") !== "1") return;
  const prefix = "fluxion.memory.migration";
  if (Services.prefs.getBoolPref(`${prefix}.claimed`, false)) return;
  Services.prefs.setBoolPref(`${prefix}.claimed`, true);
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const stage = value => {
    Services.prefs.setStringPref(`${prefix}.stage`, value);
    Services.prefs.savePrefFile(null);
  };
  const report = { fixture: "synthetic-vec0-storage-not-model-inference", checks: [] };

  async function run() {
    assert(/\/fluxion-semantic-check\.[^/]+\/profile\/?$/.test(Services.env.get("FLUXION_PROFILE")),
      "Migration verification requires the dedicated semantic verifier's isolated profile");
    const { Sqlite } = ChromeUtils.importESModule("resource://gre/modules/Sqlite.sys.mjs");
    const { PlacesUtils } = ChromeUtils.importESModule("resource://gre/modules/PlacesUtils.sys.mjs");
    // Import the actual production bridge; no test-provided normalizer/migrator.
    const { FluxionMemorySearch } = ChromeUtils.importESModule("resource://fluxion/modules/FluxionMemorySearch.sys.mjs");
    const uuid = Services.uuid.generateUUID().toString().replace(/[{}]/g, "");
    const path = PathUtils.join(PathUtils.profileDir, `fluxion-migration-fixture-${uuid}.sqlite`);
    assert(!(await IOUtils.exists(path)), "Migration fixture path unexpectedly already exists");
    let db;
    try {
      stage("creating-v1-native-vector-fixture");
      db = await Sqlite.openConnection({ path, extensions: ["vec"] });
      await db.execute("PRAGMA journal_mode = WAL");
      await db.execute(`CREATE TABLE pages (
        id INTEGER PRIMARY KEY, url TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
        description TEXT NOT NULL, headings TEXT NOT NULL, content TEXT NOT NULL,
        workspace TEXT NOT NULL, tab_group TEXT NOT NULL, last_visit INTEGER NOT NULL,
        visit_count INTEGER NOT NULL DEFAULT 1, indexed_at INTEGER NOT NULL
      )`);
      await db.execute("CREATE VIRTUAL TABLE page_vectors USING vec0(embedding FLOAT[4] distance_metric=cosine)");
      await db.setSchemaVersion(1);
      await db.executeTransaction(async () => {
        for (let index = 1; index <= 103; index++) {
          await db.executeCached(`INSERT INTO pages
            (id,url,title,description,headings,content,workspace,tab_group,last_visit,indexed_at)
            VALUES (:id,:url,:title,:description,:headings,:content,'dev','Research',:visit,1000)`, {
            id: index * 2, url: `https://migration-fixture.invalid/Original-${index}`,
            title: "Café ＧＵＩＤＥ", description: "Été", headings: "МОСКВА",
            content: "Cafe\u0301 and oﬃce notes", visit: index,
          });
        }
        await db.executeCached("INSERT INTO page_vectors(rowid,embedding) VALUES (2,:vector)", {
          vector: PlacesUtils.tensorToSQLBindable([0.25, 0.5, 0.75, 1]),
        });
      });
      const vectorBytes = async () => (await db.execute("SELECT hex(embedding) AS bytes FROM page_vectors WHERE rowid=2"))[0]?.getResultByName("bytes");
      const before = await vectorBytes();
      assert(typeof before === "string" && before.length === 32, "Native vec0 fixture did not store four real float values");
      stage("interrupting-native-migration");
      let interrupted = false;
      try {
        await FluxionMemorySearch.migrateV1(db, async () => { throw new Error("fixture migration interruption"); });
      } catch (error) {
        if (error.message !== "fixture migration interruption") throw error;
        interrupted = true;
      }
      assert(interrupted && await db.getSchemaVersion() === 1, "Interrupted migration advanced the schema");
      assert(!(await db.execute("PRAGMA table_info(pages)")).some(row => row.getResultByName("name").startsWith("search_")),
        "Interrupted migration retained partially added columns");
      assert(await vectorBytes() === before, "Interrupted migration changed native vectors");
      report.checks.push("interrupted-native-transaction-rolled-back");

      stage("retrying-bounded-native-migration");
      let yields = 0;
      await FluxionMemorySearch.migrateV1(db, async () => {
        yields++;
        await new Promise(resolve => window.setTimeout(resolve, 0));
      });
      assert(yields === 3 && await db.getSchemaVersion() === 2, "Native migration did not backfill three bounded batches");
      const original = (await db.execute("SELECT * FROM pages WHERE id=2"))[0];
      for (const [field, value] of Object.entries({
        url: "https://migration-fixture.invalid/Original-1", title: "Café ＧＵＩＤＥ",
        content: "Cafe\u0301 and oﬃce notes", workspace: "dev", tab_group: "Research", last_visit: 1,
        search_title: "cafe guide", search_content: "cafe and office notes", search_headings: "москва",
      })) assert(original?.getResultByName(field) === value, `Migration changed or failed to fold ${field}`);
      assert(await vectorBytes() === before, "Successful migration changed native vec0 bytes/row identity");
      const matched = await db.executeCached("SELECT count(*) AS count FROM pages WHERE search_content LIKE :pattern", {
        pattern: `%${FluxionMemorySearch.fold("CAFÉ")}%`,
      });
      assert(matched[0].getResultByName("count") === 103, "Native normalized body query missed migrated rows");
      report.checks.push("103-original-pages-and-native-vector-bytes-preserved", "accented-body-query-matches-migrated-evidence");
      stage("reopening-native-migrated-fixture");
      await db.close();
      db = null;
      db = await Sqlite.openConnection({ path, extensions: ["vec"] });
      assert(await db.getSchemaVersion() === 2 && await vectorBytes() === before, "Migrated schema/vector bytes did not survive reopen");
      report.checks.push("schema-and-native-vectors-survive-reopen");
    } finally {
      // Only this UUID-named verification database and its known SQLite
      // sidecars are removed; the production Memory database is never opened.
      if (db) await db.close();
      for (const suffix of ["", "-wal", "-shm", "-journal"]) await IOUtils.remove(path + suffix, { ignoreAbsent: true });
    }
    assert(!(await IOUtils.exists(path)), "Migration fixture was not cleaned up");
  }
  run().then(() => {
    Services.prefs.setStringPref(`${prefix}.health`, "native-v1-migration-preserved-evidence-and-vec0-bytes");
  }).catch(error => {
    Services.prefs.setStringPref(`${prefix}.error`, `${error?.message || error}\n${error?.stack || ""}`);
    Cu.reportError(error);
  }).finally(() => {
    Services.prefs.setStringPref(`${prefix}.report`, JSON.stringify(report));
    Services.prefs.savePrefFile(null);
  });
})(window);
