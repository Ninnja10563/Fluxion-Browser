"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(require.resolve("../chrome/fluxion-palette.js"), "utf8");
function block(start, end) {
  const begin = source.indexOf(start), finish = source.indexOf(end, begin);
  assert.ok(begin >= 0 && finish > begin);
  return source.slice(begin, finish);
}

test("actual picker activation retains its source and orientation after close resets global state", () => {
  for (const orientation of ["stacked", "side-by-side"]) {
    const sourceTab = {}, target = { label: "Destination" }, calls = [];
    const scope = vm.createContext({ mode: "split", splitSource: sourceTab,
      pendingSplitOrientation: orientation, activeIndex: 0, visibleItems: [],
      layer: { hidden: false }, placesTimer: 0, memoryRequest: 0, aiRequest: 0,
      askController: null, lastFocus: null, input: { value: "Destination", removeAttribute() {} },
      window: { clearTimeout() {}, FluxionSplitViews: { canSplit: () => true, SIDE_BY_SIDE: "side-by-side" } },
      gBrowser: { tabs: [target], selectedTab: target },
      Cu: { reportError: error => { throw error; } },
      ui: { tabWorkspace: () => "focus", currentWorkspace: () => "focus",
        createSplitView: (...args) => calls.push(args), selectTab() { assert.fail("Picker must create a split"); } },
    });
    vm.runInContext(block("  function tabItems()", "  function workspaceItems()") +
      block("  function choose(", "  function setActive(") +
      block("  function close()", '  on(input, "input"'), scope);
    scope.visibleItems = scope.tabItems();
    scope.choose();
    assert.equal(scope.layer.hidden, true); assert.equal(scope.splitSource, null);
    assert.equal(scope.pendingSplitOrientation, "side-by-side");
    assert.equal(calls.length, 1); assert.equal(calls[0][0], sourceTab);
    assert.equal(calls[0][1], target); assert.equal(calls[0][2].orientation, orientation);
    scope.choose(); assert.equal(calls.length, 1, "Closed palette cannot activate a stale choice");
  }
});
