"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const settingsWindow = require("./settings-window-fixture.js");
const settle = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const descendants = node => (node.children || []).flatMap(child => [child, ...descendants(child)]);
function fixture(initial = { provider: "openai-compatible", endpoint: "https://model.example/v1", model: "example" }) {
  let saved = initial;
  const clear = deferred(), save = deferred(), connection = deferred();
  const calls = [];
  const h = settingsWindow("about:preferences?fluxion=ai", [], { ai: {
    config: () => saved,
    setSecret(value, options) { calls.push({ value, options }); return clear.promise; },
    configure(value) { calls.push({ configuration: value }); return save.promise; },
    testConnection() { return connection.promise; },
  } });
  const all = descendants(h.root);
  const panel = all.find(node => node.dataset.section === "ai");
  const field = title => panel.children.find(row => row.children?.[0]?.children?.[0]?.textContent === title)?.children[1];
  const clearButton = all.find(node => node.getAttribute("aria-label") === "Clear this endpoint’s saved API key");
  return { ...h, clear, save, connection, calls, field, clearButton,
    testButton: all.find(node => node.textContent === "Test connection"),
    saved: value => { saved = value; }, saveButton: field("Save connection") };
}

test("endpoint key clearing is unavailable when disabled, unconfigured, or editing an unsaved destination", () => {
  for (const config of [{ provider: "disabled", endpoint: "", model: "" }, { provider: "openai-compatible", endpoint: "", model: "" }]) {
    const h = fixture(config);
    assert.equal(h.clearButton.disabled, true);
    h.clearButton.dispatchEvent({ type: "click" });
    assert.equal(h.calls.length, 0);
  }
  const h = fixture();
  assert.equal(h.clearButton.textContent, "Clear saved key");
  assert.equal(h.clearButton.title, "Clear this endpoint’s saved API key");
  assert.equal(h.clearButton.disabled, false);
  h.field("Endpoint").value = "https://other.example/v1";
  h.field("Endpoint").dispatchEvent({ type: "input" });
  assert.equal(h.clearButton.disabled, true);
  h.clearButton.dispatchEvent({ type: "click" });
  assert.equal(h.calls.length, 0);
});

test("clearing captures the saved endpoint and locks configuration until failure settles", async () => {
  const h = fixture();
  h.clearButton.dispatchEvent({ type: "click" });
  assert.equal(h.calls[0].value, "");
  assert.equal(h.calls[0].options.expectedEndpoint, "https://model.example/v1");
  assert.equal(h.clearButton.disabled, true);
  for (const title of ["Provider", "Endpoint", "Model", "API key", "Save connection"]) assert.equal(h.field(title).disabled, true);
  h.saveButton.dispatchEvent({ type: "click" });
  assert.equal(h.calls.length, 1, "save cannot race an outstanding deletion");
  h.saved({ provider: "openai-compatible", endpoint: "https://other.example/v1", model: "other" });
  h.clear.reject(new Error("configured endpoint changed"));
  await settle();
  assert.equal(h.saveButton.disabled, false);
  assert.equal(h.field("Endpoint").disabled, false);
  assert.equal(h.clearButton.disabled, true, "old draft must not clear a newly configured endpoint");
  assert.ok(descendants(h.root).some(node => node.textContent?.includes("Could not clear this endpoint’s key")));
});

test("saving locks key deletion and reconciles the latest saved configuration", async () => {
  const h = fixture();
  h.saveButton.dispatchEvent({ type: "click" });
  assert.equal(h.field("Provider").disabled, true);
  assert.equal(h.clearButton.disabled, true);
  h.clearButton.dispatchEvent({ type: "click" });
  assert.equal(h.calls.length, 1);
  h.saved({ provider: "disabled", endpoint: "", model: "" });
  h.save.resolve({ provider: "openai-compatible", endpoint: "https://model.example/v1", model: "old" });
  await settle();
  assert.equal(h.field("Provider").value, "disabled");
  assert.equal(h.field("Endpoint").value, "");
  assert.equal(h.clearButton.disabled, true);
  assert.equal(h.saveButton.disabled, false);
});

for (const failure of [false, true]) {
  test(`stale connection ${failure ? "failure" : "success"} cannot replace a newer key-clear result`, async () => {
    const h = fixture();
    h.testButton.dispatchEvent({ type: "click" });
    h.clearButton.dispatchEvent({ type: "click" });
    h.clear.resolve(); await settle();
    const note = descendants(h.root).find(node => node.textContent?.includes("Other endpoint keys are unchanged"));
    assert.ok(note);
    const savedMessage = note.textContent;
    if (failure) h.connection.reject(new Error("obsolete connection failure"));
    else h.connection.resolve({ detail: "obsolete connection success" });
    await settle();
    assert.equal(note.textContent, savedMessage);
    assert.equal(h.testButton.disabled, false);
  });
}

test("a late connection response cannot overwrite a newer saved provider status", async () => {
  const h = fixture();
  h.testButton.dispatchEvent({ type: "click" });
  h.saveButton.dispatchEvent({ type: "click" });
  h.saved({ provider: "disabled", endpoint: "", model: "" });
  h.save.resolve({ provider: "disabled", endpoint: "", model: "" });
  await settle();
  const note = descendants(h.root).find(node => node.textContent === "AI disabled.");
  assert.ok(note);
  h.connection.resolve({ detail: "old provider is available" });
  await settle();
  assert.equal(note.textContent, "AI disabled.");
  assert.equal(h.testButton.disabled, true);
});
