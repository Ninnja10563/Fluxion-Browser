"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const verifier = fs.readFileSync(path.join(__dirname,
  "../chrome/fluxion-settings-accessibility-verification.js"), "utf8");
const start = verifier.indexOf("  async function waitForPersistedPreferences(");
const end = verifier.indexOf("  async function seedExclusionList(", start);
assert.ok(start > 0 && end > start, "Extract the actual packaged verifier's persistence barrier");
const expected = [
  { id: "smooth-scrolling", pref: "general.smoothScroll", after: false },
  { id: "https-only", pref: "dom.security.https_only_mode", after: true },
];
const lines = expected.map(item => `user_pref("${item.pref}", ${item.after});`);

function fixture(snapshots, { values = new Map(expected.map(item => [item.pref, item.after])),
  userValues = new Set(values.keys()), readError } = {}) {
  let elapsed = 0, reads = 0, waits = 0;
  const context = {
    deadline: 200,
    Date: { now: () => elapsed },
    PathUtils: { profileDir: "/isolated/profile", join: (...parts) => parts.join("/") },
    IOUtils: { async readUTF8(file) {
      assert.equal(file, "/isolated/profile/prefs.js");
      if (readError) throw readError;
      return snapshots[Math.min(reads++, snapshots.length - 1)];
    } },
    Services: { prefs: {
      prefHasUserValue: pref => userValues.has(pref),
      getBoolPref: pref => values.get(pref),
    } },
    pause: async () => { elapsed += 50; waits++; },
  };
  vm.createContext(context);
  vm.runInContext(`${verifier.slice(start, end)}\nthis.verify = waitForPersistedPreferences;`, context);
  return { run: () => context.verify(expected), reads: () => reads, waits: () => waits };
}

test("packaged persistence gate waits for all asynchronous writes in one real disk snapshot", async () => {
  const h = fixture(["// prior snapshot", lines[0], `${lines.join("\r\n")}\r\n`]);
  assert.equal(await h.run(), 3);
  assert.equal(h.reads(), 3);
  assert.equal(h.waits(), 2);
});

test("packaged persistence gate cannot combine partial snapshots or accept a permanently missing final write", async () => {
  for (const snapshots of [[lines[0], lines[1]], [lines[0]]]) {
    const h = fixture(snapshots);
    await assert.rejects(h.run(), /not saved to prefs\.js after 4 reads/);
    assert.equal(h.reads(), 4);
  }
});

test("disk persistence requires exact boolean lines and still-current user preferences", async () => {
  for (const [snapshots, options] of [
    [[`${lines[0]}\n// ${lines[1]}`]],
    [[`${lines[0]}\n${lines[1].replace("true", "false")}`]],
    [[lines.join("\n")], { values: new Map([[expected[0].pref, false], [expected[1].pref, false]]) }],
    [[lines.join("\n")], { userValues: new Set([expected[0].pref]) }],
  ]) {
    const h = fixture(snapshots, options);
    await assert.rejects(h.run(), /https-only/);
  }
});

test("an actual disk read failure is not converted into successful runtime-only persistence", async () => {
  const failure = new Error("permission denied reading isolated prefs.js");
  const h = fixture([], { readError: failure });
  await assert.rejects(h.run(), error => error === failure);
  assert.equal(h.waits(), 0);
});
