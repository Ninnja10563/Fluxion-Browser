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

test("only the native automatic replacement receives empty-workspace ownership", () => {
  const allocation = replacements.find(([before]) => before.includes("if (newTab)"))[1];
  const adoption = replacements.find(([before]) => before.includes("TabBarVisibility.update()"))[1];
  const run = new Function("newTab", "BROWSER_NEW_TAB_URL", "window", "TabBarVisibility", "console",
    `${allocation}\n skipAnimation: true,\n${adoption}\n}`);
  for (const available of [false, true]) for (const throwing of [false, true]) {
    let marked = false, adopted = 0, errors = 0, updates = 0;
    const replacement = { setAttribute(name, value) {
      assert.equal(name, "fluxion-empty-workspace"); assert.equal(value, "true"); marked = true;
    } };
    const window = available ? { FluxionEmptyWorkspace: { adopt(tab) {
      assert.equal(tab, replacement); assert.equal(marked, true); adopted++;
      if (throwing) throw new Error("initialization failure");
    } } } : {};
    const browser = { addTrustedTab(url, options) {
      assert.equal(url, "about:newtab"); assert.deepEqual(options, { tabIndex: 0, skipAnimation: true }); return replacement;
    } };
    run.call(browser, true, "about:newtab", window, {}, { error() { errors++; } });
    assert.equal(marked, true); assert.equal(adopted, Number(available));
    assert.equal(errors, Number(available && throwing), "controller errors cannot interrupt native tab cleanup");
    run.call(browser, false, "about:newtab", window, { update() { updates++; } }, {});
    assert.equal(updates, 1);
  }
});

test("implementation-only backing tabs never enter closed-tab history", () => {
  const fragment = replacements.find(([before]) => before.includes("metricsContext"))[1];
  const detail = new Function("aTab", "skipSessionStore", "adoptedByTab", "metricsContext", `return ({${fragment}});`);
  for (const marked of [false, true]) for (const skip of [false, true]) {
    const target = {}, metrics = {};
    const result = detail({ hasAttribute: name => name === "fluxion-empty-workspace" && marked }, skip, target, metrics);
    assert.equal(result.skipSessionStore, skip || marked);
    assert.equal(result.adoptedBy, target); assert.equal(result.metricsContext, metrics);
  }
});

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
