"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const settingsFixture = require("./settings-window-fixture.js");

const descend = node => [node, ...node.children.flatMap(descend)];
const find = (node, predicate) => descend(node).find(predicate);
const button = (node, text) => find(node, item => item.tagName === "button" && item.textContent === text);
const fire = (node, type) => node.dispatchEvent({ type });
function harness(options = {}) {
  let state = { valid: true, version: 1, readOnly: false, revision: "0", directDomains: ["direct.example"],
    lists: [{ id: "research", name: "Research", enabled: true, domains: ["research.example"] }], ...options };
  const observers = new Set(), calls = [], confirmations = [];
  let confirmation = true, failure = null, pending = null;
  const snapshot = () => structuredClone(state);
  const publish = patch => {
    state = { ...state, ...patch, revision: String(Number(state.revision) + 1) };
    for (const observer of observers) observer.observe();
    return snapshot();
  };
  const check = revision => {
    if (state.readOnly) throw new Error("Private policy is read-only");
    if (revision !== state.revision) throw Object.assign(new Error("Exclusion policy changed in another window. Reload before saving."), { code: "POLICY_CONFLICT" });
    if (failure) throw failure;
  };
  const memory = {
    enabled: () => false, embeddingProvider: () => "disabled", exclusionPolicy: snapshot,
    excludedDomains: () => [...state.directDomains, ...state.lists.filter(item => item.enabled).flatMap(item => item.domains)],
    async saveExclusionList(value, revision) {
      calls.push(["save", structuredClone(value), revision]); check(revision);
      if (pending) await pending;
      const saved = { ...value, id: value.id || "created" };
      return publish({ lists: [...state.lists.filter(item => item.id !== saved.id), saved] });
    },
    async deleteExclusionList(id, revision) { calls.push(["delete", id, revision]); check(revision); return publish({ lists: state.lists.filter(item => item.id !== id) }); },
    async resetExclusionPolicy(revision) { calls.push(["reset", revision]); check(revision); return publish({ valid: true, lists: [], directDomains: [] }); },
    async setExcludedDomains(values, revision) { calls.push(["direct", [...values], revision]); check(revision); publish({ directDomains: [...values] }); return [...values]; },
    async enable() { calls.push(["enable"]); }, async clearAndDisable() { calls.push(["clear"]); },
    async setEmbeddingProvider() { calls.push(["embedding"]); },
  };
  const prefs = {
    addObserver(name, observer) { if (name === "fluxion.memory.exclusionPolicy") observers.add(observer); },
    removeObserver(name, observer) { if (name === "fluxion.memory.exclusionPolicy") observers.delete(observer); },
    getStringPref: (_key, fallback) => fallback, getIntPref: (_key, fallback) => fallback,
    getBoolPref: (_key, fallback) => fallback,
    setStringPref() {}, savePrefFile() {},
  };
  const h = settingsFixture("about:preferences#search", [], { memory, sharedPrefs: prefs, prompt: { confirm: (_window, title, message) => { confirmations.push({ title, message }); return confirmation; } } });
  const editor = h.document.getElementById("fluxion-memory-exclusion-lists");
  const row = id => find(editor, item => item.dataset.exclusionListId === id);
  const field = (row, name) => find(row, item => item.getAttribute("aria-label") === name);
  return { ...h, editor, row, field, calls, confirmations, snapshot, publish, observers,
    confirm: value => { confirmation = value; }, fail: value => { failure = value; }, pending: value => { pending = value; } };
}

test("actual Settings creates an explicitly saved named list with stable fields and accessible descriptions", async () => {
  const h = harness();
  assert.equal(h.document.getElementById("fluxion-memory-excluded-domains").value, "direct.example");
  await fire(button(h.editor, "New exclusion list"), "click");
  const row = h.row("new"), name = h.field(row, "List name"), domains = h.field(row, "Domains (comma or line separated)");
  assert.equal(h.document.activeElement, name);
  assert.ok(h.document.getElementById(name.getAttribute("aria-describedby")));
  name.value = "Health notes"; await fire(name, "input");
  domains.value = "health.example, notes.example"; await fire(domains, "input");
  assert.equal(h.calls.length, 0);
  await fire(button(row, "Save list"), "click");
  assert.equal(h.row("created"), row);
  assert.equal(h.field(row, "List name"), name);
  assert.equal(h.document.activeElement, name);
  assert.deepEqual(h.calls[0], ["save", { name: "Health notes", enabled: true, domains: ["health.example", "notes.example"] }, "0"]);
  assert.equal(h.row("new"), undefined);
});

test("saved list summary uses singular only for one domain and refreshes without replacing its disclosure", () => {
  const h = harness(), row = h.row("research"), summary = find(row, item => item.tagName === "summary");
  assert.equal(summary.textContent, "Research · Enabled · 1 domain");
  for (const [domains, enabled, expected] of [
    [[], false, "Research · Disabled · 0 domains"],
    [["first.example", "second.example"], true, "Research · Enabled · 2 domains"],
    [["only.example"], true, "Research · Enabled · 1 domain"],
  ]) {
    h.publish({ lists: [{ id: "research", name: "Research", domains, enabled }] });
    assert.equal(h.row("research"), row);
    assert.equal(find(row, item => item.tagName === "summary"), summary);
    assert.equal(summary.textContent, expected);
  }
});

test("draft toggle needs Save; cross-window edits preserve identity, focus and revision conflict until Cancel", async () => {
  const h = harness(), row = h.row("research"), name = h.field(row, "List name"), enabled = h.field(row, "Enable this list");
  name.focus(); name.value = "My draft"; name.selectionStart = 2; name.selectionEnd = 5; await fire(name, "input");
  enabled.checked = false; await fire(enabled, "change");
  assert.equal(h.calls.length, 0);
  h.publish({ lists: [{ id: "research", name: "Other window", domains: ["remote.example"], enabled: true }] });
  assert.equal(h.row("research"), row); assert.equal(name.value, "My draft");
  assert.equal(name.selectionStart, 2); assert.equal(h.document.activeElement, name);
  await fire(button(row, "Save list"), "click");
  assert.equal(h.snapshot().lists[0].name, "Other window");
  assert.match(find(row, item => item.getAttribute("role") === "status").textContent, /draft is retained/);
  await fire(button(row, "Cancel changes"), "click");
  assert.equal(name.value, "Other window"); assert.equal(enabled.checked, true);
  enabled.checked = false; await fire(enabled, "change"); await fire(button(row, "Save list"), "click");
  assert.equal(h.snapshot().lists[0].enabled, false);
});

test("removal requires confirmation and external deletion retains dirty drafts without allowing resurrection", async () => {
  const h = harness(), row = h.row("research"), name = h.field(row, "List name");
  h.confirm(false); await fire(button(row, "Remove list"), "click"); assert.equal(h.calls.length, 0);
  h.confirm(true); name.value = "Draft"; await fire(name, "input"); name.focus();
  h.publish({ lists: [] });
  assert.equal(h.row("research"), row); assert.equal(button(row, "Save list").disabled, true);
  await fire(button(row, "Cancel changes"), "click");
  assert.equal(h.row("research"), undefined);
  assert.equal(h.document.activeElement, button(h.editor, "New exclusion list"));
  const other = harness(); await fire(button(other.row("research"), "Remove list"), "click");
  assert.equal(other.snapshot().lists.length, 0); assert.equal(other.row("research"), undefined);
});

test("direct-domain conflicts retain drafts without flattening enabled lists and explicit Cancel reloads", async () => {
  const h = harness(), field = h.document.getElementById("fluxion-memory-excluded-domains");
  field.value = "draft.example"; await fire(field, "input");
  h.publish({ directDomains: ["new.example"] }); await fire(field, "change");
  assert.equal(field.value, "draft.example"); assert.deepEqual(h.snapshot().directDomains, ["new.example"]);
  await fire(button(h.root, "Cancel domain changes"), "click");
  assert.equal(field.value, "new.example");
});

test("invalid policy has explicit confirmed recovery; private controls cannot write even via dispatched clicks", async () => {
  const h = harness({ valid: false, error: "bad JSON", lists: [] });
  assert.equal(button(h.editor, "New exclusion list").disabled, true);
  assert.equal(h.document.getElementById("fluxion-memory-enabled").disabled, true);
  assert.equal(h.document.getElementById("fluxion-memory-embedding-provider").disabled, true);
  h.confirm(false); await fire(button(h.editor, "Reset exclusion policy"), "click"); assert.equal(h.calls.length, 0);
  h.confirm(true); await fire(button(h.editor, "Reset exclusion policy"), "click"); assert.equal(h.snapshot().valid, true);
  assert.match(h.confirmations.at(-1).message, /Previously enabled Browser Memory and page AI can become available immediately/);
  assert.match(find(h.editor, item => item.getAttribute("role") === "status").textContent, /can now resume with no user-defined domain exclusions/);
  assert.equal(h.document.getElementById("fluxion-memory-enabled").disabled, false);
  const p = harness({ readOnly: true });
  await fire(button(p.editor, "New exclusion list"), "click");
  await fire(button(p.row("research"), "Remove list"), "click");
  await fire(button(p.row("research"), "Save list"), "click");
  await fire(button(p.root, "Clear Browser Memory"), "click");
  assert.equal(p.calls.length, 0);
});

test("cleanup failure preserves draft and controls stay disabled across pending preference notifications", async () => {
  const h = harness(), row = h.row("research"), name = h.field(row, "List name");
  name.value = "New name"; await fire(name, "input");
  h.fail(new Error("database busy")); await fire(button(row, "Save list"), "click");
  assert.equal(name.value, "New name"); assert.equal(name.disabled, false);
  assert.match(find(row, item => item.getAttribute("role") === "status").textContent, /database busy/);
  assert.match(find(row, item => item.getAttribute("role") === "status").textContent, /policy may already be saved even if cleanup did not finish/);
  h.fail(null); let release; h.pending(new Promise(resolve => { release = resolve; }));
  const task = fire(button(row, "Save list"), "click");
  assert.equal(name.disabled, true);
  for (const observer of h.observers) observer.observe(); assert.equal(name.disabled, true);
  release(); await task; assert.equal(name.disabled, false);
  h.unload(); assert.equal(h.observers.size, 0);
});

test("twenty-list limit blocks creation and over-limit domain input reaches backend without truncation", async () => {
  const full = harness({ lists: Array.from({ length: 20 }, (_, index) => ({ id: `list-${index}`, name: `List ${index}`, enabled: false, domains: [] })) });
  assert.equal(button(full.editor, "New exclusion list").disabled, true);
  await fire(button(full.editor, "New exclusion list"), "click"); assert.equal(full.row("new"), undefined);
  const h = harness(), row = h.row("research"), values = h.field(row, "Domains (comma or line separated)");
  values.value = Array.from({ length: 201 }, (_, index) => `site${index}.example`).join("\n"); await fire(values, "input");
  h.fail(new Error("At most 200 domain entries are allowed")); await fire(button(row, "Save list"), "click");
  assert.equal(h.calls[0][1].domains.length, 201);
  assert.match(find(row, item => item.getAttribute("role") === "status").textContent, /200 domain entries/);
  assert.equal(values.value.split("\n").length, 201);
});

test("reset failure stays visible and closing Settings prevents pending list save from changing disposed DOM", async () => {
  const invalid = harness({ valid: false, lists: [] }); invalid.fail(new Error("storage unavailable"));
  await fire(button(invalid.editor, "Reset exclusion policy"), "click");
  assert.match(find(invalid.editor, item => item.getAttribute("role") === "status").textContent, /storage unavailable/);
  const h = harness(); await fire(button(h.editor, "New exclusion list"), "click");
  const row = h.row("new"), name = h.field(row, "List name"); name.value = "Pending"; await fire(name, "input");
  let release; h.pending(new Promise(resolve => { release = resolve; }));
  const task = fire(button(row, "Save list"), "click"); h.unload();
  release(); await task;
  assert.equal(row.dataset.exclusionListId, "new");
  assert.equal(h.observers.size, 0);
});
