"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("the package policy blocks application replacement without disabling other update services", () => {
  const configuration = JSON.parse(fs.readFileSync(
    path.join(__dirname, "../runtime/distribution/policies.json"), "utf8",
  ));
  assert.deepEqual(configuration, { policies: { DisableAppUpdate: true } });
});
