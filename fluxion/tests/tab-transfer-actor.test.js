"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

async function harness() {
  global.JSWindowActorChild = class {};
  const { FluxionTabTransferVerificationChild } = await import("../actors/FluxionTabTransferVerificationChild.sys.mjs");
  const actor = new FluxionTabTransferVerificationChild();
  const origin = "http://127.0.0.1:42222";
  const draft = { localName: "textarea", value: "" };
  const state = { transferFixtureCounter: 0 };
  const location = { origin, pathname: "/transfer", href: `${origin}/transfer` };
  const history = { length: 1, pushState(_value, _title, query) { location.href = `${origin}/transfer${query}`; this.length++; } };
  actor.contentWindow = { location, history, wrappedJSObject: state };
  actor.document = {
    title: "Fluxion transfer fixture", documentElement: { dataset: { nonce: "fixed-unit-document" } },
    getElementById(id) {
      if (id === "draft") return draft;
      if (id === "increment") return { localName: "button", click() { state.transferFixtureCounter++; } };
      throw new Error("Unapproved selector");
    },
  };
  return { actor, origin, draft, state, location };
}

test("fixed transfer actor commands retain observable draft/history/JS identity without arbitrary evaluation", async () => {
  const h = await harness();
  const seed = h.actor.receiveMessage({ name: "FluxionTabTransfer:Seed", data: { origin: h.origin } });
  assert.equal(seed.draft, "Unsaved transfer draft — café");
  assert.equal(seed.counter, 1);
  assert.equal(seed.historyLength, 2);
  assert.equal(seed.url, `${h.origin}/transfer?step=1`);
  assert.deepEqual(h.actor.receiveMessage({ name: "FluxionTabTransfer:Read", data: { origin: h.origin } }), seed);
  assert.throws(() => h.actor.receiveMessage({ name: "FluxionTabTransfer:Eval", data: { origin: h.origin, code: "anything" } }), /Unsupported/);
  assert.equal(h.state.transferFixtureCounter, 1);
});

test("actor rejects other ports, origins, paths and documents before mutation", async () => {
  for (const alter of [
    h => { h.origin = "http://127.0.0.1:42223"; },
    h => { h.location.origin = "https://example.org"; },
    h => { h.location.pathname = "/not-transfer"; },
    h => { h.actor.document.title = "Another page"; },
  ]) {
    const h = await harness(); alter(h);
    assert.throws(() => h.actor.receiveMessage({ name: "FluxionTabTransfer:Seed", data: { origin: h.origin } }), /mismatch/);
    assert.equal(h.draft.value, ""); assert.equal(h.state.transferFixtureCounter, 0);
  }
});
