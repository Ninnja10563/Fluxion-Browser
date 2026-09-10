"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const settingsWindow = require("./settings-window-fixture.js");

function descendants(node) {
  return (node.children || []).flatMap(child => [child, ...descendants(child)]);
}

test("shipped Settings names and describes General, Appearance, Tabs, Memory and AI fields", () => {
  const h = settingsWindow();
  const all = descendants(h.root);
  const panels = all.filter(node => ["general", "appearance", "tabs", "search", "ai"].includes(node.dataset.section));
  let checked = 0;
  const identifiers = [];
  for (const panel of panels) {
    for (const row of panel.children.filter(node => node.className === "fluxion-setting")) {
      const [copy, control] = row.children;
      const [label, description] = copy.children;
      identifiers.push(label.id, description.id);
      const field = control.tagName === "label" ? control.querySelector("input") : control;
      if (!["input", "select", "textarea"].includes(field.tagName)) continue;
      assert.equal(field.getAttribute("aria-labelledby"), label.id, `${panel.dataset.section}: ${label.textContent}`);
      assert.equal(field.getAttribute("aria-describedby"), description.id);
      assert.equal(h.document.getElementById(label.id)?.textContent, label.textContent);
      assert.ok(h.document.getElementById(description.id)?.textContent);
      checked += 1;
    }
  }
  assert.ok(checked >= 18, `Expected real fields across core sections, got ${checked}`);
  assert.equal(new Set(identifiers).size, identifiers.length, "DOM associations must use unique IDs");
  const memory = h.document.getElementById("fluxion-memory-enabled");
  assert.equal(h.document.getElementById(memory.getAttribute("aria-labelledby")).textContent, "Browser Memory");
});

test("native actions retain their distinct names while composites expose a labeled group", () => {
  const h = settingsWindow();
  const rows = descendants(h.root).filter(node => node.className === "fluxion-setting");
  const connection = rows.find(row => row.children[0].children[0].textContent === "Connection tools");
  const group = connection.children[1];
  assert.equal(group.getAttribute("role"), "group");
  assert.equal(h.document.getElementById(group.getAttribute("aria-labelledby")).textContent, "Connection tools");
  assert.ok(group.getAttribute("aria-describedby"));
  const actions = rows.map(row => row.children[1]).filter(control => control.tagName === "button");
  assert.ok(actions.length > 3);
  for (const action of actions) {
    assert.equal(action.getAttribute("aria-labelledby"), null, "row title must not overwrite a precise action name");
    assert.ok(action.textContent || action.getAttribute("aria-label"));
    assert.ok(action.getAttribute("aria-describedby"));
  }
  const updateGroup = rows.find(row => row.children[0].children[0].textContent === "Updates").children[1];
  const explicitlyNamed = descendants(updateGroup).filter(node => node.hasAttribute("aria-label"));
  assert.ok(explicitlyNamed.some(node => node.getAttribute("aria-label") === "Check for Fluxion updates"));
});
