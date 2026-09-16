"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const helper = path.resolve(__dirname, "../scripts/install-macos-session-policy.py");
const loaded = spawnSync("python3", ["-c", `import importlib.util,json
s=importlib.util.spec_from_file_location("policy",${JSON.stringify(helper)})
m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
print(json.dumps(m.TAB_REPLACEMENTS))`], { encoding: "utf8" });
assert.equal(loaded.status, 0, loaded.stderr);
const replacements = JSON.parse(loaded.stdout);
const single = replacements.find(([, after]) => after.includes("!adoptedByTab"))[1];
const start = single.indexOf("        if (closeWindow && !adoptedByTab"), end = single.lastIndexOf("        if (closeWindow) {");
assert.ok(start >= 0 && end > start);
const decision = new Function("window", "adoptedByTab", "closeWindow", `${single.slice(start, end)}return closeWindow;`);
const bulk = replacements.find(([before]) => before.includes("this.tabs.length == tabs.length"))[1];
const bulkDecision = new Function("window", "Services", "tabs", `return (${bulk});`);
const getter = replacements.find(([before]) => before.includes("!window.toolbar.visible ||"))[1];
const shouldClose = new Function("window", getter);

test("ordinary last-tab closure retains every normal window without requiring sidebar or workspace metadata", () => {
  for (const fields of [{}, { FluxionUI: {} }, { private: true }, { restoring: true }]) {
    const window = { toolbar: { visible: true }, ...fields };
    assert.equal(shouldClose(window), false);
    assert.equal(decision(window, undefined, true), false);
    assert.equal(decision(window, undefined, false), false);
  }
});

test("native popup closure and explicit cross-window adoption teardown remain unchanged", () => {
  const popup = { toolbar: { visible: false } }, normal = { toolbar: { visible: true } };
  assert.equal(shouldClose(popup), true);
  assert.equal(decision(popup, undefined, true), true);
  assert.equal(decision(popup, undefined, false), false);
  assert.equal(decision(normal, { adopted: true }, true), true);
  assert.equal(decision(normal, { adopted: true }, false), false);
});

test("bulk all-tab close cannot bypass empty-tab replacement in a normal window", () => {
  const tabs = [{}, {}], Services = { prefs: { getBoolPref: () => true } };
  assert.equal(bulkDecision.call({ tabs }, { toolbar: { visible: true } }, Services, tabs), false);
  assert.equal(bulkDecision.call({ tabs }, { toolbar: { visible: false } }, Services, tabs), true);
  assert.equal(bulkDecision.call({ tabs }, { toolbar: { visible: false } }, Services, [tabs[0]]), false);
  Services.prefs.getBoolPref = () => false;
  assert.equal(bulkDecision.call({ tabs }, { toolbar: { visible: false } }, Services, tabs), false);
});
