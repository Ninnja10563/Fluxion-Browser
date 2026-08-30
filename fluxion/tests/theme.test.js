"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  CHOICES,
  THEME_IDS,
  choiceForId,
  idForChoice,
  normaliseChoice,
} = require("../chrome/core/theme.js");

test("appearance choices map only to Gecko's supported built-in themes", () => {
  assert.deepEqual(CHOICES, ["system", "light", "dark"]);
  assert.equal(idForChoice("system"), "default-theme@mozilla.org");
  assert.equal(idForChoice("light"), "firefox-compact-light@mozilla.org");
  assert.equal(idForChoice("dark"), "firefox-compact-dark@mozilla.org");
  assert.equal(idForChoice("invented"), THEME_IDS.system);
  assert.equal(normaliseChoice("invented"), "system");
});

test("active extension themes remain distinguishable from built-in choices", () => {
  assert.equal(choiceForId(THEME_IDS.system), "system");
  assert.equal(choiceForId(THEME_IDS.light), "light");
  assert.equal(choiceForId(THEME_IDS.dark), "dark");
  assert.equal(choiceForId("third-party@example.test"), "custom");
});
