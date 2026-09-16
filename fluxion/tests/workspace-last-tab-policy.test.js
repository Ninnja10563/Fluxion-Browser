"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const helper = path.resolve(__dirname, "../scripts/install-macos-session-policy.py");
const loaded = spawnSync("python3", ["-c", `import importlib.util,json
s=importlib.util.spec_from_file_location("policy",${JSON.stringify(helper)})
m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
print(json.dumps(m.TAB_REPLACEMENTS[0][1]))`], { encoding: "utf8" });
assert.equal(loaded.status, 0, loaded.stderr);
const patched = JSON.parse(loaded.stdout);
const start = patched.indexOf("        if (closeWindow && window.FluxionUI)"), end = patched.lastIndexOf("        if (closeWindow) {");
const decision = new Function("window", "aTab", "closeWindow", `${patched.slice(start, end)}return closeWindow;`);
const tab = (workspace, fields = {}) => ({ isOpen: true, hidden: false, getAttribute: () => workspace, ...fields });
const window = { FluxionUI: { workspaces: () => [{ id: "first" }, { id: "second" }] } };

test("last visible workspace tab retains a window with live hidden tabs in another defined workspace", () => {
  const closing = tab("first"), survivor = tab("second", { hidden: true });
  for (const fields of [{}, { pending: true }, { private: true }]) {
    const tabs = [closing, { ...survivor, ...fields }];
    assert.equal(decision.call({ tabs }, window, closing, true), false);
    assert.equal(decision.call({ tabs }, window, closing, false), false);
  }
});

test("actual last-tab policy, ordinary Firefox, closing survivors and unrelated hidden tabs remain native", () => {
  const closing = tab("first");
  for (const others of [[], [tab("second")], [tab("second", { hidden: true, isOpen: false })],
    [tab("first", { hidden: true })], [tab("deleted", { hidden: true })], [tab("", { hidden: true })]]) {
    assert.equal(decision.call({ tabs: [closing, ...others] }, window, closing, true), true);
  }
  assert.equal(decision.call({ tabs: [closing, tab("second", { hidden: true })] }, {}, closing, true), true);
  const unknown = tab("deleted");
  assert.equal(decision.call({ tabs: [unknown, tab("second", { hidden: true })] }, window, unknown, true), true);
});
