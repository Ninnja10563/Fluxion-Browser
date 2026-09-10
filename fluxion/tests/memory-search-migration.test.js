"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const readline = require("node:readline");
const Search = require("../chrome/core/memory-search.js");

// A persistent real SQLite connection executes every production migration
// statement, including transaction rollback, without requiring Node >20.
function database(t) {
  const child = spawn("python3", ["-u", "-c", `
import json, sqlite3, sys
db = sqlite3.connect(':memory:', isolation_level=None)
db.row_factory = sqlite3.Row
for line in sys.stdin:
    try:
        request = json.loads(line)
        rows = db.execute(request['sql'], request.get('parameters', {})).fetchall()
        print(json.dumps({'rows': [dict(row) for row in rows]}), flush=True)
    except Exception as error:
        print(json.dumps({'error': str(error)}), flush=True)
`], { stdio: ["pipe", "pipe", "pipe"] });
  const pending = [], statements = [];
  let failure = null;
  child.on("error", error => { failure = error; while (pending.length) pending.shift().reject(error); });
  child.on("exit", code => {
    if (pending.length) {
      const error = new Error(`SQLite bridge exited: ${code}`);
      failure = error;
      while (pending.length) pending.shift().reject(error);
    }
  });
  readline.createInterface({ input: child.stdout }).on("line", line => {
    const task = pending.shift(), result = JSON.parse(line);
    if (result.error) task.reject(new Error(result.error));
    else task.resolve(result.rows.map(row => ({ ...row, getResultByName: name => row[name] })));
  });
  t.after(() => { child.stdin.end(); child.kill(); });
  async function execute(sql, parameters = {}) {
    if (failure) throw failure;
    statements.push({ sql, parameters });
    const response = new Promise((resolve, reject) => pending.push({ resolve, reject }));
    child.stdin.write(JSON.stringify({ sql, parameters }) + "\n");
    return response;
  }
  return {
    execute, executeCached: execute, statements,
    setSchemaVersion: version => execute(`PRAGMA user_version=${version}`),
    async executeTransaction(callback) {
      await execute("BEGIN");
      try { await callback(); await execute("COMMIT"); }
      catch (error) { await execute("ROLLBACK"); throw error; }
    },
  };
}

async function seed(db, count = 103) {
  await db.execute("CREATE TABLE pages (id INTEGER PRIMARY KEY, title TEXT, url TEXT, description TEXT, headings TEXT, content TEXT, workspace TEXT, last_visit INTEGER)");
  await db.execute("CREATE TABLE page_vectors (rowid INTEGER PRIMARY KEY, embedding BLOB)");
  await db.setSchemaVersion(1);
  await db.executeTransaction(async () => {
    for (let index = 1; index <= count; index++) {
      await db.execute("INSERT INTO pages VALUES (:id,:title,:url,:description,:headings,:content,:workspace,:visit)", {
        id: index * 2, title: "Café ＧＵＩＤＥ", url: `https://example.org/original-${index}`,
        description: "Été", headings: "МОСКВА", content: "Cafe\u0301 and oﬃce notes", workspace: "dev", visit: index,
      });
    }
    await db.execute("INSERT INTO page_vectors VALUES (2, x'01020304')");
  });
}

test("shared folding is locale independent and preserves deliberate literal punctuation", () => {
  assert.equal(Search.fold(" CAFÉ  Cafe\u0301 ＧＵＩＤＥ oﬃce МОСКВА "), "cafe cafe guide office москва");
  assert.equal(Search.fold("50% a_b / original-path"), "50% a_b / original-path");
  assert.equal(Search.fold("東京"), "東京", "folding is not transliteration");
});

test("v1 migration backfills bounded batches atomically and preserves originals, IDs and vectors", async t => {
  const db = database(t);
  await seed(db);
  let yields = 0;
  await Search.migrateV1(db, async () => { yields++; await new Promise(resolve => setImmediate(resolve)); });
  assert.equal(yields, 3);
  const batches = db.statements.filter(statement => statement.sql.startsWith("SELECT id,"));
  assert.deepEqual(batches.map(statement => statement.parameters), [
    { cursor: 0, limit: 50 }, { cursor: 100, limit: 50 }, { cursor: 200, limit: 50 }, { cursor: 206, limit: 50 },
  ]);
  assert.equal((await db.execute("PRAGMA user_version"))[0].user_version, 2);
  const row = (await db.execute("SELECT * FROM pages WHERE id=2"))[0];
  assert.equal(row.title, "Café ＧＵＩＤＥ");
  assert.equal(row.content, "Cafe\u0301 and oﬃce notes");
  assert.equal(row.url, "https://example.org/original-1");
  assert.equal(row.workspace, "dev");
  assert.equal(row.last_visit, 1);
  assert.equal(row.search_title, "cafe guide");
  assert.equal(row.search_content, "cafe and office notes");
  assert.equal((await db.execute("SELECT hex(embedding) AS value FROM page_vectors WHERE rowid=2"))[0].value, "01020304");
  assert.equal((await db.execute("SELECT count(*) AS count FROM pages WHERE search_headings=:query", { query: Search.fold("МОСКВА") }))[0].count, 103);
  // Reopening schema dispatch sees v2 and must not repeat ALTER/backfill.
  const before = db.statements.filter(statement => statement.sql.startsWith("ALTER")).length;
  if ((await db.execute("PRAGMA user_version"))[0].user_version === 1) await Search.migrateV1(db);
  assert.equal(db.statements.filter(statement => statement.sql.startsWith("ALTER")).length, before);
});

test("interrupted migration rolls back added columns and folded data, then safely retries", async t => {
  const db = database(t);
  await seed(db, 60);
  await assert.rejects(Search.migrateV1(db, async () => { throw new Error("shutdown interruption"); }), /shutdown interruption/);
  assert.equal((await db.execute("PRAGMA user_version"))[0].user_version, 1);
  assert.equal((await db.execute("PRAGMA table_info(pages)")).some(row => row.name.startsWith("search_")), false);
  assert.equal((await db.execute("SELECT count(*) AS count FROM pages"))[0].count, 60);
  assert.equal((await db.execute("SELECT hex(embedding) AS value FROM page_vectors"))[0].value, "01020304");
  await Search.migrateV1(db);
  assert.equal((await db.execute("PRAGMA user_version"))[0].user_version, 2);
});

test("v1→v2→v3 leaves historical workspace names unknown and preserves folded evidence/vectors", async t => {
  const db = database(t);
  await seed(db, 2);
  await Search.migrateV1(db);
  const original = (await db.execute("SELECT * FROM pages WHERE id=2"))[0];
  await Search.migrateV2(db);
  const migrated = (await db.execute("SELECT * FROM pages WHERE id=2"))[0];
  assert.equal((await db.execute("PRAGMA user_version"))[0].user_version, 3);
  assert.equal(migrated.workspace_name, "");
  for (const name of Object.keys(original).filter(name => name !== "getResultByName")) assert.equal(migrated[name], original[name]);
  assert.equal((await db.execute("SELECT hex(embedding) AS value FROM page_vectors"))[0].value, "01020304");
});

test("workspace-name migration rolls back the column when version commit fails and can retry", async t => {
  const db = database(t);
  await seed(db, 2);
  await Search.migrateV1(db);
  const setVersion = db.setSchemaVersion;
  db.setSchemaVersion = async () => { throw new Error("simulated version-write failure"); };
  await assert.rejects(Search.migrateV2(db), /version-write failure/);
  assert.equal((await db.execute("PRAGMA user_version"))[0].user_version, 2);
  assert.equal((await db.execute("PRAGMA table_info(pages)")).some(row => row.name === "workspace_name"), false);
  assert.equal((await db.execute("SELECT search_title FROM pages WHERE id=2"))[0].search_title, "cafe guide");
  assert.equal((await db.execute("SELECT hex(embedding) AS value FROM page_vectors"))[0].value, "01020304");
  db.setSchemaVersion = setVersion;
  await Search.migrateV2(db);
  assert.equal((await db.execute("PRAGMA user_version"))[0].user_version, 3);
  assert.equal((await db.execute("SELECT workspace_name FROM pages WHERE id=2"))[0].workspace_name, "");
});
