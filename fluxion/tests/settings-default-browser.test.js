"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const settingsWindow = require("./settings-window-fixture.js");
function fixture({ alreadyDefault = false, allowed = true, unavailable = false } = {}) {
  const calls = [], state = { isDefault: alreadyDefault, allowed, failRead: false, write: async () => {} };
  const shellService = unavailable ? undefined : {
    isDefaultBrowser(...args) { calls.push({ method: "read", args }); if (state.failRead) throw Error("Native query failed"); return state.isDefault; },
    setDefaultBrowser(...args) { calls.push({ method: "write", args }); return state.write(); },
  };
  const h = settingsWindow("about:preferences", [], { shellService, policies: { isAllowed: () => state.allowed } });
  return { ...h, calls, state, button: h.document.getElementById("fluxion-make-default-browser"),
    status: h.document.getElementById("fluxion-default-browser-status"),
    writes: () => calls.filter(call => call.method === "write"),
    activate: () => h.window.dispatchEvent({ type: "activate", target: h.window }) };
}
test("General reads actual default-browser state without a startup prompt or default mutation", async () => {
  for (const alreadyDefault of [false, true]) {
    const h = fixture({ alreadyDefault });
    assert.equal(h.writes().length, 0);
    assert.equal(h.button.textContent, "Make Fluxion Default");
    assert.equal(h.button.disabled, alreadyDefault);
    assert.equal(h.status.getAttribute("role"), "status");
    assert.match(h.status.textContent, alreadyDefault ? /is your default/ : /is not your default/);
    assert.ok(h.calls.every(call => call.args[0] === false && call.args[1] === true));
    if (alreadyDefault) { await h.button.dispatchEvent({ type: "click" }); assert.equal(h.writes().length, 0); }
  }
});
test("Make Default delegates once to native confirmation, never treats returned request as acceptance, and rechecks on activation", async () => {
  const h = fixture(); let resolve;
  h.state.write = () => new Promise(done => { resolve = done; });
  const task = h.button.dispatchEvent({ type: "click" });
  assert.equal(h.button.disabled, true);
  await h.button.dispatchEvent({ type: "click" });
  assert.equal(h.writes().length, 1);
  assert.deepEqual(h.writes()[0].args, [false]);
  resolve(); await task;
  assert.equal(h.button.disabled, false);
  assert.match(h.status.textContent, /If prompted, confirm/);
  h.state.isDefault = true; await h.activate();
  assert.equal(h.button.disabled, true);
  assert.equal(h.status.textContent, "Fluxion is your default browser.");
  h.state.isDefault = false; h.choose("Appearance"); h.choose("General");
  assert.equal(h.button.disabled, false);
  assert.match(h.status.textContent, /not your default/);
});
test("cancelled confirmation leaves an actionable button, and native failure does not claim success", async () => {
  const h = fixture();
  await h.button.dispatchEvent({ type: "click" }); await h.activate();
  assert.equal(h.button.disabled, false);
  assert.match(h.status.textContent, /not your default/);
  h.state.write = async () => { throw Error("OS denied request"); };
  await h.button.dispatchEvent({ type: "click" });
  assert.match(h.status.textContent, /Could not request/);
  assert.equal(h.button.disabled, false);
  h.state.failRead = true; await h.activate();
  assert.equal(h.button.disabled, true);
  assert.match(h.status.textContent, /status is unavailable/);
});
test("unavailable native service and live enterprise policy prevent default-browser writes", async () => {
  for (const options of [{ unavailable: true }, { allowed: false }]) {
    const h = fixture(options);
    assert.equal(h.button.disabled, true);
    await h.button.dispatchEvent({ type: "click" });
    assert.equal(h.writes().length, 0);
  }
  const h = fixture(); h.state.allowed = false;
  await h.button.dispatchEvent({ type: "click" });
  assert.equal(h.writes().length, 0);
  assert.match(h.status.textContent, /administrator/);
});
test("pending native requests cannot mutate destroyed Settings or leave activation listeners", async () => {
  const h = fixture(); let resolve;
  h.state.write = () => new Promise(done => { resolve = done; });
  const task = h.button.dispatchEvent({ type: "click" });
  h.unload(); const text = h.status.textContent, calls = h.calls.length;
  h.state.isDefault = true; resolve(); await task; await h.activate();
  assert.equal(h.status.textContent, text);
  assert.equal(h.calls.length, calls);
  assert.equal(h.window.listeners.get("activate").length, 0);
  assert.equal(h.timers.size, 0);
});
test("same-app consent is rechecked only after a request, stops at confirmation or 30 checks, and never polls hidden Settings", async () => {
  const h = fixture();
  assert.equal(h.timers.size, 0, "Opening General must not start idle polling");
  await h.button.dispatchEvent({ type: "click" });
  assert.equal(h.timers.size, 1);
  h.state.isDefault = true; h.flushTimers();
  assert.equal(h.status.textContent, "Fluxion is your default browser.");
  assert.equal(h.timers.size, 0);
  h.state.isDefault = false; await h.activate();
  await h.button.dispatchEvent({ type: "click" });
  for (let index = 0; index < 29; index++) { h.flushTimers(); assert.equal(h.timers.size, 1); }
  h.flushTimers(); assert.equal(h.timers.size, 0, "Unconfirmed requests cannot poll indefinitely");
  await h.button.dispatchEvent({ type: "click" });
  h.choose("Appearance"); const reads = h.calls.length; h.flushTimers();
  assert.equal(h.calls.length, reads);
  assert.equal(h.timers.size, 0);
  h.choose("General"); await h.button.dispatchEvent({ type: "click" });
  h.unload(); assert.equal(h.timers.size, 0);
});
