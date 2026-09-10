"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const settingsWindow = require("./settings-window-fixture.js");
const Policy = require("../chrome/core/permissions.js");
const descendants = node => (node.children || []).flatMap(child => [child, ...descendants(child)]);

function fixture() {
  // Feed actual production-normalized permission records to the full Settings
  // script. The backing service is a test double, not native Gecko persistence.
  let records = [
    { origin: "https://meet.example", type: "camera", capability: 1 },
    { origin: "https://meet.example", type: "microphone", capability: 2 },
    { origin: "https://meet.example", type: "camera", capability: 2, originAttributes: "^userContextId=2" },
    { origin: "http://meet.example", type: "camera", capability: 1 },
    { origin: "https://other.example", type: "geo", capability: 1 },
  ].map(record => Policy.normalise(record));
  const initial = [...records], calls = [], confirmations = [];
  const listeners = new Set();
  let accepted = true;
  const notify = () => { for (const listener of listeners) listener([...records]); };
  const service = {
    list: () => [...records],
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    remove(id) {
      calls.push({ action: "decision", id });
      const found = records.some(record => record.id === id);
      records = records.filter(record => record.id !== id); notify(); return found;
    },
    removeSite(siteKey) {
      calls.push({ action: "site", siteKey });
      const count = records.filter(record => record.siteKey === siteKey).length;
      records = records.filter(record => record.siteKey !== siteKey); notify(); return count;
    },
  };
  const h = settingsWindow("about:preferences?fluxion=permissions", [], {
    permissions: service,
    prompt: { confirm(_window, title, text) { confirmations.push({ title, text }); return accepted; } },
  });
  h.choose("Permissions");
  const all = () => descendants(h.root);
  return { ...h, initial, calls, confirmations, listeners, service, records: () => records,
    accept(value) { accepted = value; },
    button(label) { const found = all().find(node => node.tagName === "button" && node.getAttribute("aria-label") === label); assert.ok(found, label); return found; },
    siteButtons: () => all().filter(node => node.textContent === "Reset site"),
    search: () => all().find(node => node.getAttribute("aria-label") === "Search saved site permissions"),
  };
}

test("identical visible Reset site labels have distinct origin/container accessible names", () => {
  const h = fixture();
  const labels = h.siteButtons().map(button => button.getAttribute("aria-label"));
  assert.equal(labels.length, 4);
  assert.equal(new Set(labels).size, 4);
  assert.ok(labels.includes("Reset all saved permissions for https://meet.example (Container 2)"));
  assert.ok(labels.includes("Reset all saved permissions for https://meet.example (Standard profile)"));
  assert.ok(labels.includes("Reset all saved permissions for http://meet.example (Standard profile)"));
  h.button("Reset Camera for https://meet.example (Container 2)");
  h.button("Reset Camera for https://meet.example (Standard profile)");
});

test("site reset cancellation has no mutation; acceptance removes only the exact origin-attributes group", () => {
  const h = fixture();
  const target = h.initial.find(record => record.context === "Container 2");
  const label = "Reset all saved permissions for https://meet.example (Container 2)";
  h.accept(false); h.button(label).dispatchEvent({ type: "click" });
  assert.deepEqual(h.calls, []); assert.equal(h.records().length, 5);
  h.accept(true); h.button(label).dispatchEvent({ type: "click" });
  assert.deepEqual(h.calls, [{ action: "site", siteKey: target.siteKey }]);
  assert.equal(h.records().length, 4);
  assert.ok(h.records().some(record => record.origin === target.origin && record.context === "Standard profile"));
  assert.ok(!h.siteButtons().some(button => button.getAttribute("aria-label") === label));
  assert.equal(h.confirmations.length, 2);
  for (const confirmation of h.confirmations) {
    assert.equal(confirmation.text,
      "Remove all saved permission decisions for https://meet.example (Container 2)?");
  }
});

test("filtered decision reset retains exact permission identity and leaves other types/origins intact", () => {
  const h = fixture();
  const target = h.initial.find(record => record.origin === "https://meet.example" && record.type === "camera" && record.context === "Standard profile");
  h.search().value = "meet camera";
  h.search().dispatchEvent({ type: "input" });
  h.button("Reset Camera for https://meet.example (Standard profile)").dispatchEvent({ type: "click" });
  assert.deepEqual(h.calls, [{ action: "decision", id: target.id }]);
  assert.equal(h.records().length, 4);
  assert.ok(h.records().some(record => record.type === "microphone"));
  assert.ok(h.records().some(record => record.context === "Container 2"));
  assert.ok(h.records().some(record => record.origin === "http://meet.example"));
  assert.equal(h.confirmations.length, 0);
  h.unload();
  assert.equal(h.listeners.size, 0);
});
