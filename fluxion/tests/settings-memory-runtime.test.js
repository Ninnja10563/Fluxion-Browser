"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../chrome/fluxion-settings.js"), "utf8");
// Execute the shipped Search & Memory construction and registered callbacks,
// without reconstructing unrelated Settings panels or copying handler logic.
const start = source.indexOf('  const search = section("search",');
const end = source.indexOf('  const ai = section("ai",', start);
if (start < 0 || end < 0) throw new Error("Settings Memory section boundaries changed");
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
function harness(overrides = {}, confirmed = true) {
  const notes = [], errors = [];
  class Control {
    constructor() { this.listeners = new Map(); this.disabled = false; }
    addEventListener(name, callback) { this.listeners.set(name, callback); }
    fire(name) { return this.listeners.get(name)?.(); }
  }
  const memory = { enabled: () => true, embeddingProvider: () => "gecko-local",
    excludedDomains: () => ["saved.example"], ...overrides };
  const context = vm.createContext({
    window: { FluxionMemory: memory, addEventListener() {} },
    Services: { prompt: { confirm: () => confirmed } }, Cu: { reportError: error => errors.push(error) },
    FluxionSettings: { excludedDomains: value => value.split(",").map(item => item.trim()).filter(Boolean) },
    section: () => ({}), row() {}, create: () => new Control(),
    setNote: (text, section) => notes.push({ text, section }),
    toggle: (_label, checked, callback) => {
      const input = { checked, disabled: false };
      return { querySelector: () => input, change: callback };
    },
    select: (_options, value, callback) => Object.assign(new Control(), { value, change: callback }),
  });
  vm.runInContext(source.slice(start, end) + "\nglobalThis.controls = { memoryToggle, embeddingChoice, domains, clearMemory, applyEmbeddingChoice, task: () => embeddingChoiceTask };", context);
  return { ...context.controls, notes, errors, memory,
    removeService: () => { context.window.FluxionMemory = undefined; } };
}

test("Memory disable failure restores actual checkbox state and never reports cleared data", async () => {
  const pending = deferred();
  const h = harness({ clearAndDisable: () => pending.promise });
  const task = h.memoryToggle.change(false);
  assert.equal(h.memoryToggle.querySelector().disabled, true);
  assert.equal(h.notes.length, 0);
  pending.reject(new Error("native vectors could not be deleted"));
  await task;
  assert.equal(h.memoryToggle.querySelector().checked, true);
  assert.equal(h.memoryToggle.querySelector().disabled, false);
  assert.deepEqual(h.notes, [{ text: "Could not update Browser Memory: native vectors could not be deleted", section: "search" }]);
});

test("Clear Memory failure reports partial failure and reflects disabled production state", async () => {
  const pending = deferred();
  let enabled = true;
  const h = harness({ enabled: () => enabled, clearAndDisable: () => pending.promise });
  const task = h.clearMemory.fire("click");
  assert.equal(h.clearMemory.disabled, true);
  enabled = false;
  pending.reject(new Error("native database locked"));
  await task;
  assert.equal(h.clearMemory.disabled, false);
  assert.equal(h.memoryToggle.querySelector().checked, false);
  assert.match(h.notes.at(-1).text, /^Could not finish clearing Browser Memory: native database locked$/);
});

test("Canceling clear does not call the data deletion operation", async () => {
  let calls = 0;
  const h = harness({ clearAndDisable: async () => { calls += 1; } }, false);
  await h.clearMemory.fire("click");
  assert.equal(calls, 0);
  assert.equal(h.notes.length, 0);
  assert.equal(h.clearMemory.disabled, false);
});

test("an unavailable Memory service cannot report successful deletion", async () => {
  const h = harness();
  h.removeService();
  await h.clearMemory.fire("click");
  assert.match(h.notes.at(-1).text, /^Could not finish clearing Browser Memory:/);
  assert.equal(h.clearMemory.disabled, false);
  await h.memoryToggle.change(false);
  assert.match(h.notes.at(-1).text, /^Could not update Browser Memory:/);
});

test("Embedding deletion rejection remains awaitable and restores actual provider selection", async () => {
  const pending = deferred();
  const h = harness({ setEmbeddingProvider: () => pending.promise });
  h.embeddingChoice.value = "disabled";
  h.embeddingChoice.change("disabled");
  assert.equal(h.embeddingChoice.disabled, true);
  const error = new Error("vector cleanup failed");
  pending.reject(error);
  await assert.rejects(h.task(), /vector cleanup failed/);
  assert.equal(h.embeddingChoice.value, "gecko-local");
  assert.equal(h.embeddingChoice.disabled, false);
  assert.equal(h.errors[0], error);
  assert.match(h.notes.at(-1).text, /^Could not change embedding mode:/);
});

test("Exclusion cleanup failure restores persisted domains and re-enables editing", async () => {
  const pending = deferred();
  let submitted;
  const h = harness({ setExcludedDomains: values => { submitted = values; return pending.promise; } });
  h.domains.value = "private.example, medical.example";
  const task = h.domains.fire("change");
  assert.equal(h.domains.disabled, true);
  assert.deepEqual(submitted, ["private.example", "medical.example"]);
  pending.reject(new Error("evidence database busy"));
  await task;
  assert.equal(h.domains.disabled, false);
  assert.equal(h.domains.value, "saved.example");
  assert.match(h.notes.at(-1).text, /^Could not finish removing excluded data:/);
});
