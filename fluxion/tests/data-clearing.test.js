"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createController,
  normaliseScope,
  sanitizerMode,
} = require("../chrome/core/data-clearing.js");

test("data-clearing scopes map only to supported Gecko dialog modes", () => {
  assert.equal(normaliseScope("siteData"), "siteData");
  assert.equal(normaliseScope("unexpected"), "browsingData");
  assert.equal(sanitizerMode("siteData"), "clearSiteData");
  assert.equal(sanitizerMode("browsingData"), undefined);
});

test("data-clearing controller keeps one native dialog in flight", async () => {
  let resolveDialog;
  const calls = [];
  const opened = [];
  const results = [];
  const controller = createController({
    showUI(mode) {
      calls.push(mode);
      return new Promise(resolve => { resolveDialog = resolve; });
    },
    onOpen: scope => opened.push(scope),
    onResult: (scope, result) => results.push([scope, result]),
  });

  const first = controller.open("siteData");
  const duplicate = controller.open("browsingData");
  assert.equal(first, duplicate);
  assert.equal(controller.isOpen(), true);
  assert.deepEqual(calls, ["clearSiteData"]);
  assert.deepEqual(opened, ["siteData"]);

  resolveDialog("accept");
  assert.equal(await first, "accept");
  assert.equal(controller.isOpen(), false);
  assert.deepEqual(results, [["siteData", "accept"]]);
});

test("unknown native outcomes are treated as cancellation and unlock the controller", async () => {
  const calls = [];
  const controller = createController({
    showUI(mode) {
      calls.push(mode);
      return Promise.resolve("dismissed");
    },
  });
  assert.equal(await controller.open(), "cancel");
  assert.equal(await controller.open(), "cancel");
  assert.deepEqual(calls, [undefined, undefined]);
});
