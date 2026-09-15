"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const settingsWindow = require("./settings-window-fixture.js");
const colors = require("../chrome/core/colors.js");

function fixture() {
  let saved = colors.normalise(null);
  const windows = [], writes = [];
  const project = () => {
    for (const window of windows) window.dispatchEvent({ type: "FluxionColorsChanged" });
  };
  const service = {
    current: () => saved,
    setEnabled(value) { saved = { ...saved, enabled: value }; writes.push(["enabled", value]); project(); },
    setPalette(mode, palette) { saved = colors.normalise({ ...saved, [mode]: palette }); writes.push([mode, palette]); project(); },
    reset() { saved = colors.normalise(null); writes.push(["reset"]); project(); },
  };
  const open = () => {
    const window = settingsWindow("about:preferences?fluxion=appearance", [], { colors: service });
    windows.push(window.window);
    return { ...window, field: (mode, key, picker = false) => window.document.getElementById(`fluxion-color-${mode}-${key}${picker ? "-picker" : ""}`),
      enabled: window.document.getElementById("fluxion-colors-enabled"), reset: window.document.getElementById("fluxion-colors-reset") };
  };
  return { a: open(), b: open(), service, writes };
}

test("actual Appearance controls enable native pickers, save independent palettes and reset in both windows", async () => {
  const h = fixture();
  assert.equal(h.a.enabled.checked, false);
  assert.equal(h.a.field("dark", "base").disabled, true);
  h.a.enabled.checked = true;
  await h.a.enabled.dispatchEvent({ type: "change" });
  assert.equal(h.b.enabled.checked, true);
  assert.equal(h.b.field("dark", "base").disabled, false);
  const picker = h.a.field("dark", "base", true);
  assert.equal(picker.type, "color");
  assert.match(picker.getAttribute("aria-label"), /Pick dark base color/);
  assert.ok(h.a.document.getElementById(picker.getAttribute("aria-describedby")));
  picker.value = "#334455";
  await picker.dispatchEvent({ type: "change" });
  assert.equal(h.a.field("dark", "base").value, "#334455");
  assert.equal(h.b.field("dark", "base").value, "#334455");
  assert.deepEqual(h.service.current().light, colors.DEFAULTS.light);
  await h.b.reset.dispatchEvent({ type: "click" });
  assert.deepEqual(h.service.current(), colors.DEFAULTS);
  assert.equal(h.a.enabled.checked, false);
  assert.equal(h.a.field("dark", "base").disabled, true);
  assert.equal(h.a.field("dark", "base").value, colors.DEFAULTS.dark.base);
});

test("invalid hexadecimal drafts are announced, not persisted, and survive remote changes until Escape", async () => {
  const h = fixture();
  h.service.setEnabled(true);
  const field = h.a.field("light", "base");
  field.value = "#GG0000";
  await field.dispatchEvent({ type: "input" });
  await field.dispatchEvent({ type: "change" });
  assert.deepEqual(h.writes, [["enabled", true]]);
  assert.equal(field.getAttribute("aria-invalid"), "true");
  assert.match(field.validationMessage, /six hexadecimal/);
  assert.ok(field.validityReported);
  h.service.setPalette("light", { base: "#c0c0c0", accent: "#123456" });
  assert.equal(field.value, "#GG0000");
  assert.equal(h.b.field("light", "base").value, "#c0c0c0");
  let prevented = false;
  await field.dispatchEvent({ type: "keydown", key: "Escape", preventDefault() { prevented = true; }, stopPropagation() {} });
  assert.ok(prevented);
  assert.equal(field.value, "#c0c0c0");
  assert.equal(field.validationMessage, "");
  assert.equal(field.hasAttribute("aria-invalid"), false);
  h.a.unload();
  h.service.setPalette("light", { base: "#eeeeee", accent: "#123456" });
  assert.equal(field.value, "#c0c0c0", "unloaded Settings stops observing colors");
  assert.equal(h.b.field("light", "base").value, "#eeeeee");
});
