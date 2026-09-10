const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../chrome/fluxion-selection-verification.js"), "utf8");
const start = source.indexOf("  function isRovingDemotion(");
const end = source.indexOf("\n  const frame", start);
assert.ok(start >= 0 && end > start);
const eligible = vm.runInNewContext(`${source.slice(start, end)}; isRovingDemotion`);

test("native selection verifier permits only the exact prior roving stop's necessary demotion", () => {
  const previous = {}, selected = { tabIndex: 0 };
  const transition = { type: "attributes", attribute: "tabindex", before: "0", after: "-1",
    target: previous, previous, destination: selected, selected };
  assert.equal(eligible(transition), true);
  for (const change of [
    { type: "childList" }, { attribute: "aria-selected" }, { before: "-1" }, { after: "0" },
    { target: {} }, { previous: {} }, { destination: {} }, { target: selected, previous: selected },
  ]) assert.equal(eligible({ ...transition, ...change }), false, JSON.stringify(change));
  selected.tabIndex = -1;
  assert.equal(eligible(transition), false);
});
