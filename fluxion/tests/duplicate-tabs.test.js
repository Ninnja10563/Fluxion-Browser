"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { planDuplicateTabs } = require("../chrome/core/duplicate-tabs.js");
const record = (id, changes = {}) => ({ id, url: "https://example.org/path?q=%2f#part", containerId: 0,
  workspaceId: "research", protected: false, ...changes });

test("ordered duplicate plan retains original records and the first ordinary keeper without mutating snapshots", () => {
  const first = Object.freeze(record("first")), second = Object.freeze(record("second"));
  const other = Object.freeze(record("other", { url: "https://example.org/elsewhere" }));
  const fourth = Object.freeze(record("fourth"));
  const input = Object.freeze([first, second, other, fourth]);
  const plan = planDuplicateTabs(input);
  assert.deepEqual(plan, [{ target: second, keeper: first }, { target: fourth, keeper: first }]);
  assert.equal(plan[0].target, second); assert.equal(plan[1].keeper, first);
  assert.equal(input[0], first); assert.equal(input.length, 4);
  assert.deepEqual(planDuplicateTabs([first, first, second, second]), [{ target: second, keeper: first }]);
});

test("all protected records survive and the first protected keeper takes precedence even when later in tab order", () => {
  const records = [record("early"), record("second"), record("pinned", { protected: true }),
    record("selected", { protected: true }), record("late")];
  assert.deepEqual(planDuplicateTabs(records), [
    { target: records[0], keeper: records[2] }, { target: records[1], keeper: records[2] },
    { target: records[4], keeper: records[2] },
  ]);
  assert.deepEqual(planDuplicateTabs(records.filter(item => item.protected)), []);
});

test("plans preserve global target order across interleaved groups", () => {
  const rows = [record("a0"), record("b0", { url: "https://b.test/" }), record("b1", { url: "https://b.test/" }),
    record("a1"), record("a2", { protected: true }), record("b2", { url: "https://b.test/" })];
  assert.deepEqual(planDuplicateTabs(rows).map(({ target, keeper }) => [target.id, keeper.id]),
    [["a0", "a2"], ["b1", "b0"], ["a1", "a2"], ["b2", "b0"]]);
});

test("HTTP(S) identity remains exact across query, fragment, credentials, port, escaping and host spelling", () => {
  const urls = ["https://example.org/path?q=%2f#part", "https://example.org/path?q=%2F#part",
    "https://example.org/path?q=%2f#other", "https://example.org/path?q=%2f", "https://example.org/path?q=%2f#",
    "https://example.org/path?a=1&b=2", "https://example.org/path?b=2&a=1", "https://example.org/path?",
    "https://example.org/path", "https://reader:one@example.org/path", "https://reader:two@example.org/path",
    "https://example.org:443/path", "https://EXAMPLE.org/path", "https://example.org/a/../path",
    "http://example.org/path", "http://example.org:80/path", "https://example.org", "https://example.org/",
    "http://[::1]:8080/path"];
  const originals = urls.map((url, id) => record(id, { url }));
  assert.deepEqual(planDuplicateTabs(originals), []);
  const duplicates = originals.map(item => ({ ...item }));
  const plan = planDuplicateTabs([...originals, ...duplicates]);
  assert.equal(plan.length, urls.length);
  for (let index = 0; index < urls.length; index++) {
    assert.equal(plan[index].target, duplicates[index]); assert.equal(plan[index].keeper, originals[index]);
  }
});

test("workspace and container boundaries are independent even with equal URL strings", () => {
  const originals = [record(0), record(1, { containerId: 1 }), record(2, { workspaceId: "development" }),
    record(3, { containerId: 1, workspaceId: "development" }), record(4, { workspaceId: "research\u00000" })];
  assert.deepEqual(planDuplicateTabs(originals), []);
  const duplicates = originals.map(item => ({ ...item, id: `${item.id}-copy` }));
  const plan = planDuplicateTabs([...originals, ...duplicates]);
  assert.equal(plan.length, 5);
  for (let index = 0; index < originals.length; index++) assert.equal(plan[index].keeper, originals[index]);
});

test("malformed, privileged and non-web URLs never become targets or keepers", () => {
  for (const url of [undefined, null, {}, 7, "", "https://", "https:///example.org", "https:////example.org",
    "http://user@", "http://example.org:99999/", "https://example.org/white space", "https://example.org/\\path",
    "https://example.org/\n", "https://example.org/\u0000", "https://example.org/%zz", "https://example.org/%",
    "https://[::g]/", "file:///private", "about:blank", "about:newtab", "chrome://browser/content/",
    "resource://fluxion/", "javascript:alert(1)", "data:text/plain,hello", "blob:https://example.org/id",
    "view-source:https://example.org/", "ftp://example.org/"]) {
    assert.deepEqual(planDuplicateTabs([record(0, { url }), record(1, { url })]), [], String(url));
  }
});

test("missing or malformed identity/protection fields fail closed instead of guessing another container or workspace", () => {
  for (const changes of [{ containerId: "0" }, { containerId: -1 }, { containerId: NaN }, { containerId: Infinity },
    { containerId: .5 }, { containerId: Number.MAX_SAFE_INTEGER + 1 }, { containerId: undefined },
    { workspaceId: "" }, { workspaceId: " " }, { workspaceId: undefined }, { workspaceId: 0 },
    { protected: undefined }, { protected: 0 }, { protected: "false" }]) {
    const invalid = record(0, changes), valid = record(1);
    assert.deepEqual(planDuplicateTabs([invalid, { ...invalid }, valid]), [], JSON.stringify(changes));
  }
  for (const input of [undefined, null, {}, "tabs", new Set()]) assert.deepEqual(planDuplicateTabs(input), []);
  assert.deepEqual(planDuplicateTabs([undefined, null, false, 42, "tab", [], record(0)]), []);
});

test("thousand-tab planning is deterministic, retains protected keepers, and reads each URL once", () => {
  let reads = 0;
  const rows = Array.from({ length: 1000 }, (_, index) => {
    const value = record(index, { protected: index >= 900 });
    Object.defineProperty(value, "url", { get() { reads++; return `https://example.org/group/${index % 100}`; } });
    return value;
  });
  const plan = planDuplicateTabs(rows);
  assert.equal(reads, 1000);
  assert.equal(plan.length, 900);
  for (let index = 0; index < plan.length; index++) {
    assert.equal(plan[index].target, rows[index]);
    assert.equal(plan[index].keeper, rows[900 + index % 100]);
    assert.equal(plan[index].keeper.protected, true);
  }
  assert.deepEqual(planDuplicateTabs(rows), plan);
  assert.equal(reads, 2000);
});
