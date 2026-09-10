"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Exercise the shipped chrome script with controlled provider completion order.
// The DOM stand-in only supplies the browser operations used by this dialog.
function harness(environment = {}) {
  const elements = [];
  let document;
  class Element {
    constructor() {
      this.children = [];
      this.attributes = new Map();
      this.listeners = new Map();
      this.isConnected = true;
      elements.push(this);
    }
    setAttribute(key, value) { this.attributes.set(key, value); }
    getAttribute(key) { return this.attributes.get(key) ?? null; }
    removeAttribute(key) { this.attributes.delete(key); }
    append(...children) { this.children.push(...children); }
    appendChild(child) { this.append(child); return child; }
    replaceChildren(...children) { this.children = children; }
    addEventListener(type, fn) {
      this.listeners.set(type, [...(this.listeners.get(type) || []), fn]);
    }
    removeEventListener() {}
    dispatch(type, key) {
      for (const fn of this.listeners.get(type) || []) {
        fn({ key, target: this, preventDefault() {}, stopPropagation() {} });
      }
    }
    focus() { document.activeElement = this; }
    scrollIntoView() {}
    querySelectorAll() {
      return this.children.filter(child => child.className === "fluxion-palette-result");
    }
    remove() { this.isConnected = false; }
  }
  document = {
    createElementNS: () => new Element(),
    getElementById: id => elements.find(element => element.id === id),
    documentElement: new Element(), body: new Element(), activeElement: new Element(),
  };
  const originalFocus = document.activeElement;
  const memory = [];
  const ai = [];
  const opened = [];
  const errors = [];
  const timers = new Map();
  const frames = [];
  let timerId = 0;
  const deferred = collection => (...args) => new Promise((resolve, reject) => {
    collection.push({ args, resolve, reject });
  });
  const window = Object.assign(new Element(), {
    document, AbortController,
    setTimeout(fn) { const id = ++timerId; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
    requestAnimationFrame(fn) { frames.push(fn); },
    FluxionUI: { currentWorkspace: () => "work", setTabWorkspace() {} },
    FluxionSplitViews: { SIDE_BY_SIDE: "side-by-side" },
    FluxionMemory: {
      enabled: () => true, embeddingProvider: () => "disabled", search: deferred(memory),
    },
    FluxionAI: { config: () => ({ provider: "local" }), askCurrentPage: deferred(ai) },
  });
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../chrome/fluxion-palette.js"), "utf8"), {
    window, AbortController,
    gBrowser: { selectedBrowser: {}, addTrustedTab(url) { opened.push(url); return {}; } },
    ChromeUtils: { importESModule: () => ({}) },
    Cu: { reportError: error => errors.push(error) },
    Services: { env: { get: name => environment[name] || "" }, prefs: { setStringPref() {}, savePrefFile() {} } },
  });
  const input = document.getElementById("fluxion-palette-input");
  const results = document.getElementById("fluxion-palette-results");
  return {
    window, document, originalFocus, input, results, memory, ai, opened, errors,
    type(value) { input.value = value; input.dispatch("input"); },
    flushTimers() { const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()); },
    flushFrames() { frames.splice(0).forEach(fn => fn()); },
    text() {
      const collect = node => [node.textContent || "", ...node.children.map(collect)].join(" ");
      return collect(results);
    },
  };
}

const settle = () => new Promise(resolve => setImmediate(resolve));
const response = title => ({ state: "keyword-only", results: [{ title, url: `https://example.org/${title}` }] });

test("Memory text matches are usable before semantic completion", async () => {
  const h = harness();
  h.window.FluxionPalette.open("memory");
  h.type("query"); h.flushTimers();
  h.memory[0].args[2].onPartial({ ...response("text-match"), state: "searching" });
  assert.match(h.text(), /text-match/);
  h.input.dispatch("keydown", "Enter");
  assert.deepEqual(h.opened, ["https://example.org/text-match"]);
  h.memory[0].resolve(response("late-semantic")); await settle();
  assert.deepEqual(h.opened, ["https://example.org/text-match"]);
});

test("late semantic ranking preserves the selected text match by URL", async () => {
  const h = harness();
  h.window.FluxionPalette.open("memory");
  h.type("query"); h.flushTimers();
  const first = response("first").results[0], second = response("second").results[0];
  h.memory[0].args[2].onPartial({ state: "searching", results: [first, second] });
  h.input.dispatch("keydown", "ArrowDown");
  h.memory[0].resolve({ state: "ready", results: [second, first] }); await settle();
  h.input.dispatch("keydown", "Enter");
  assert.deepEqual(h.opened, [second.url]);
});

test("stale and post-completion partial Memory responses cannot replace current results", async () => {
  const h = harness();
  h.window.FluxionPalette.open("memory");
  h.type("old"); h.flushTimers();
  h.type("new"); h.flushTimers();
  h.memory[0].args[2].onPartial(response("obsolete"));
  assert.doesNotMatch(h.text(), /obsolete/);
  h.memory[1].resolve(response("final")); await settle();
  h.memory[1].args[2].onPartial(response("late-partial"));
  assert.match(h.text(), /final/);
  assert.doesNotMatch(h.text(), /late-partial/);
});

test("losing the selected Memory evidence requires a fresh selection before Return", async () => {
  const h = harness();
  h.window.FluxionPalette.open("memory");
  h.type("query"); h.flushTimers();
  h.memory[0].args[2].onPartial(response("original"));
  h.memory[0].args[2].onPartial(response("replacement"));
  h.input.dispatch("keydown", "Enter");
  assert.deepEqual(h.opened, []);
  assert.equal(h.input.getAttribute("aria-activedescendant"), null);
  h.memory[0].resolve(response("replacement")); await settle();
  h.input.dispatch("keydown", "Enter");
  assert.deepEqual(h.opened, []);
  h.input.dispatch("keydown", "ArrowDown");
  h.input.dispatch("keydown", "Enter");
  assert.deepEqual(h.opened, ["https://example.org/replacement"]);
});

test("Memory removes stale keyboard targets immediately, including during debounce", async () => {
  const h = harness();
  h.window.FluxionPalette.open("memory");
  h.type("first"); h.flushTimers();
  h.memory[0].resolve(response("first")); await settle();
  assert.ok(h.input.getAttribute("aria-activedescendant"));
  h.type("second");
  h.input.dispatch("keydown", "Enter");
  assert.deepEqual(h.opened, []);
  assert.equal(h.input.getAttribute("aria-activedescendant"), null);
  h.flushTimers();
  h.input.dispatch("keydown", "Enter");
  assert.deepEqual(h.opened, []);
  h.memory[1].resolve(response("second")); await settle();
  h.input.dispatch("keydown", "Enter");
  assert.deepEqual(h.opened, ["https://example.org/second"]);
});

test("a stale Memory failure cannot replace a newer successful query", async () => {
  const h = harness();
  h.window.FluxionPalette.open("memory");
  h.type("old"); h.flushTimers();
  h.type("new"); h.flushTimers();
  h.memory[1].resolve(response("new")); await settle();
  h.memory[0].reject(new Error("old request failed")); await settle();
  assert.match(h.text(), /new/);
  assert.doesNotMatch(h.text(), /could not be searched/);
  assert.deepEqual(h.errors, []);
});

test("closing and reopening Memory invalidates old failures even for the same query", async () => {
  const h = harness();
  h.window.FluxionPalette.open("memory");
  h.type("same"); h.flushTimers();
  h.window.FluxionPalette.close();
  h.window.FluxionPalette.open("memory");
  h.type("same"); h.flushTimers();
  h.memory[1].resolve(response("current")); await settle();
  h.memory[0].reject(new Error("previous dialog")); await settle();
  assert.match(h.text(), /current/);
});

test("an older successful Memory request cannot replace the current result", async () => {
  const h = harness();
  h.window.FluxionPalette.open("memory");
  h.type("old"); h.flushTimers();
  h.type("new"); h.flushTimers();
  h.memory[1].resolve(response("current")); await settle();
  h.memory[0].resolve(response("obsolete")); await settle();
  assert.match(h.text(), /current/);
  assert.doesNotMatch(h.text(), /obsolete/);
});

test("current Memory failures are visible and leave no selectable result", async () => {
  const h = harness();
  h.window.FluxionPalette.open("memory");
  h.type("query"); h.flushTimers();
  h.memory[0].reject(new Error("database unavailable")); await settle();
  assert.match(h.text(), /could not be searched/);
  assert.equal(h.errors.length, 1);
  h.input.dispatch("keydown", "Enter");
  assert.deepEqual(h.opened, []);
});

test("editing an AI question cancels its request and suppresses late answers", async () => {
  const h = harness();
  h.window.FluxionPalette.open("ask");
  h.type("first question"); h.input.dispatch("keydown", "Enter");
  const signal = h.ai[0].args[2].signal;
  h.type("revised question");
  assert.equal(signal.aborted, true);
  h.ai[0].resolve({ text: "obsolete answer", provider: "local", source: { title: "page", url: "https://example.org" } });
  await settle();
  assert.doesNotMatch(h.text(), /obsolete answer/);
  assert.match(h.text(), /Type a question/);
});

test("switching modes keeps the original focus target and closed dialogs cannot steal focus", () => {
  const h = harness();
  h.window.FluxionPalette.open("memory"); h.flushFrames();
  assert.equal(h.document.activeElement, h.input);
  h.window.FluxionPalette.open("ask");
  h.window.FluxionPalette.close(); h.flushFrames();
  assert.equal(h.document.activeElement, h.originalFocus);
});

test("opening another AI page invalidates the former page's request", async () => {
  const h = harness();
  h.window.FluxionPalette.open("ask", {});
  h.type("question"); h.input.dispatch("keydown", "Enter");
  h.window.FluxionPalette.open("ask", {});
  assert.equal(h.ai[0].args[2].signal.aborted, true);
  h.ai[0].reject(new Error("obsolete failure")); await settle();
  assert.match(h.text(), /Type a question/);
  assert.doesNotMatch(h.text(), /obsolete failure/);
});

test("packaged grounding waits until the embedding settings fixture restores its provider", () => {
  const h = harness({
    FLUXION_VISUAL_GROUNDING_TEST: "1",
    FLUXION_VISUAL_EMBEDDING_SETTINGS_TEST: "1",
  });
  h.window.dispatch("FluxionMemoryVisualReady");
  assert.equal(h.memory.length, 0);
  h.window.dispatch("FluxionMemoryEmbeddingSettingsVisualReady");
  assert.equal(h.memory.length, 1);
  assert.equal(h.memory[0].args[0], "example");
});

test("packaged grounding runs directly after extraction when embedding settings are not exercised", () => {
  const h = harness({ FLUXION_VISUAL_GROUNDING_TEST: "1" });
  h.window.dispatch("FluxionMemoryVisualReady");
  assert.equal(h.memory.length, 1);
});
