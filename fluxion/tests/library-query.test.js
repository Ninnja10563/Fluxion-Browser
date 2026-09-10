"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const Query = require("../chrome/core/library-query.js");

// SQLite executes the production SQL, including binding, filtering, ordering,
// joins, ties and LIMIT. The registered callback is only a literal token test
// double: Mozilla Unicode matching is verified separately in the native gate.
const BRIDGE = String.raw`
import json, sqlite3, sys
query = json.load(sys.stdin)
db = sqlite3.connect(':memory:')
db.row_factory = sqlite3.Row
def match(search, url, title, tags, visits, typed, bookmarked, opened, mode, behavior, fallback):
    assert mode == 4 and behavior == 256
    fields = [str(value or '').lower() for value in [url, title, tags, fallback]]
    return int(all(any(token.lower() in field for field in fields) for token in search.split()))
db.create_function('autocomplete_match', 11, match)
db.executescript('''
CREATE TABLE moz_places(id INTEGER PRIMARY KEY, url TEXT, title TEXT, hidden INTEGER, last_visit_date INTEGER);
CREATE TABLE moz_historyvisits(id INTEGER PRIMARY KEY, place_id INTEGER);
CREATE INDEX history_place ON moz_historyvisits(place_id);
CREATE TABLE moz_bookmarks(id INTEGER PRIMARY KEY, guid TEXT, title TEXT, fk INTEGER, parent INTEGER, type INTEGER, dateAdded INTEGER);
INSERT INTO moz_bookmarks VALUES(10000, 'workfolder__', 'Work', NULL, NULL, 2, 0);
INSERT INTO moz_bookmarks VALUES(10001, 'otherfolder_', 'Other', NULL, NULL, 2, 0);
''')
for i in range(1, 651):
    title = 'Archive record ' + str(i)
    bookmark_title = 'Saved record ' + str(i)
    if i == 1:
        title = 'Ancient rediscovery needle'
        bookmark_title = 'Oldest saved needle'
    if i == 2:
        title = "Literal %_ ' OR 1=1 --"
    timestamp = 1000000 + (i // 4) * 1000 + (i % 2)
    db.execute('INSERT INTO moz_places VALUES(?,?,?,?,?)', (i, 'https://example.test/archive/' + str(i), title, 0, timestamp))
    db.execute('INSERT INTO moz_historyvisits VALUES(?,?)', (i, i))
    db.execute('INSERT INTO moz_bookmarks VALUES(?,?,?,?,?,?,?)', (i, 'bookmark' + str(i).zfill(4), bookmark_title, i, 10000 if i % 2 else 10001, 1, timestamp))
db.execute('INSERT INTO moz_historyvisits VALUES(1000,1)')
db.execute("INSERT INTO moz_places VALUES(900, 'https://hidden.test', 'Hidden', 1, 999999999)")
db.execute('INSERT INTO moz_historyvisits VALUES(900,900)')
db.execute("INSERT INTO moz_places VALUES(901, 'https://unvisited.test', 'Never visited', 0, 999999999)")
print(json.dumps([dict(row) for row in db.execute(query['sql'], query['params'])]))
`;

function execute(spec) {
  const child = spawnSync("python3", ["-c", BRIDGE], { input: JSON.stringify(spec), encoding: "utf8" });
  assert.equal(child.status, 0, child.stderr || child.error?.message);
  return JSON.parse(child.stdout);
}

test("search reaches older history and bookmarks before applying the page limit", () => {
  const history = execute(Query.history({ search: "ancient rediscovery" }));
  assert.deepEqual(history.map(row => row.id), [1]);
  assert.equal(history[0].visits, 2);
  assert.equal(history[0].visited, 1000);
  const bookmarks = execute(Query.bookmarks({ search: "oldest saved" }));
  assert.deepEqual(bookmarks.map(row => row.id), [1]);
  assert.equal(bookmarks[0].guid, "bookmark0001");
  assert.equal(bookmarks[0].folder, "Work");
});

test("timestamp and id keysets traverse every row once across tied timestamps", () => {
  for (const build of [Query.history, Query.bookmarks]) {
    let cursor = null;
    const found = [];
    do {
      const spec = build({ cursor, pageSize: 100 });
      const page = Query.pageFromRows(execute(spec), spec.pageSize);
      found.push(...page.rows);
      cursor = page.cursor;
    } while (cursor);
    assert.equal(found.length, 650);
    assert.equal(new Set(found.map(row => row.id)).size, 650);
    for (let i = 1; i < found.length; i++) {
      assert.ok(found[i - 1].cursorTimestamp > found[i].cursorTimestamp ||
        (found[i - 1].cursorTimestamp === found[i].cursorTimestamp && found[i - 1].id > found[i].id));
    }
    assert.equal(found.at(-1).id, 2); // Microsecond order, not truncated display milliseconds.
  }
});

test("folder and search restrictions apply together before the bookmark limit", () => {
  const first = Query.bookmarks({ folderGuid: "workfolder__", pageSize: 5 });
  assert.equal(execute(first).length, 6);
  assert.ok(execute(first).every(row => row.parentGuid === "workfolder__"));
  assert.deepEqual(execute(Query.bookmarks({ folderGuid: "workfolder__", search: "oldest" })).map(row => row.id), [1]);
  assert.equal(execute(Query.bookmarks({ folderGuid: "otherfolder_", search: "oldest" })).length, 0);
});

test("bound literal search and folder input cannot inject SQL or wildcard matches", () => {
  assert.deepEqual(execute(Query.history({ search: "%_" })).map(row => row.id), [2]);
  assert.deepEqual(execute(Query.history({ search: "' OR 1=1 --" })).map(row => row.id), [2]);
  assert.equal(execute(Query.history({ search: "' UNION SELECT secrets --" })).length, 0);
  assert.equal(execute(Query.bookmarks({ folderGuid: "' OR 1=1 --" })).length, 0);
});

test("terms may match URL and title separately; bookmarks also search page titles", () => {
  assert.deepEqual(execute(Query.history({ search: "ancient example.test" })).map(row => row.id), [1]);
  assert.deepEqual(execute(Query.bookmarks({ search: "ancient saved" })).map(row => row.id), [1]);
});

test("older bookmarks match distributed folder and title terms including native root labels", () => {
  assert.deepEqual(execute(Query.bookmarks({ search: "work oldest" })).map(row => row.id), [1]);
  assert.equal(execute(Query.bookmarks({ search: "other oldest" })).length, 0);
  const roots = { toolbarGuid: "workfolder__" };
  const rows = execute(Query.bookmarks({ search: "toolbar oldest", roots }));
  assert.deepEqual(rows.map(row => row.id), [1]);
  assert.equal(rows[0].folder, "Bookmarks Toolbar");
});

test("page bounds, native rows and invalid cursors preserve the query contract", () => {
  assert.equal(Query.history({ pageSize: 10000 }).params.limit, 101);
  assert.equal(Query.bookmarks({ pageSize: 0 }).params.limit, 2);
  assert.equal(Query.history({ pageSize: NaN }).pageSize, 100);
  for (const cursor of [{ timestamp: -1, id: 1 }, { timestamp: 1, id: "1 OR 1" }, { timestamp: 1.5, id: 1 }]) {
    assert.throws(() => Query.history({ cursor }), /Invalid Library cursor/);
  }
  const rows = [3, 2, 1].map(id => ({ getResultByName: name => name === "id" ? id : 1234567 }));
  assert.deepEqual(Query.pageFromRows(rows, 2), { rows: rows.slice(0, 2), hasMore: true, cursor: { timestamp: 1234567, id: 2 } });
  assert.deepEqual(Query.pageFromRows([], 2), { rows: [], hasMore: false, cursor: null });
  assert.equal(Query.pageFromRows(rows, 3).hasMore, false);
  assert.equal(Query.history({ search: "a".repeat(1000) }).params.search.length, 500);
  const roots = Query.bookmarks({ roots: { arbitrary: "unused", limit: 99999, toolbarGuid: "custom______" } }).params;
  assert.equal(roots.toolbarGuid, "custom______");
  assert.equal(roots.limit, 101);
  assert.equal(Object.hasOwn(roots, "arbitrary"), false);
});
