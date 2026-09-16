"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const settle = () => new Promise(resolve => setImmediate(resolve));
async function fixture() {
  const { UpdateCoordinator } = await import("../modules/FluxionUpdateCoordinatorCore.sys.mjs");
  let now = 1000, enabled = true, online = true, timerId = 0;
  const timers = new Map(), calls = [], commands = [];
  let result = { state: "available", latest: "0.70.2-preview.1", downloadURL: "https://example.test/update.dmg", evidence: { id: 1 } };
  let capability = { canInstall: true }, native = { state: "downloading", progress: .5, canCancel: true };
  const coordinator = new UpdateCoordinator({ installed: "0.70.1-preview.1", platform: "Darwin",
    checkRelease: (...args) => { calls.push(args); return typeof result === "function" ? result() : Promise.resolve(result); },
    installer: { prepare: async () => capability, command: async command => { commands.push(command); }, getState: async () => native },
    automatic: () => enabled, setAutomatic: value => { enabled = value; }, online: () => online, now: () => now,
    setTimer(fn, delay) { const id = ++timerId; timers.set(id, { fn, delay }); return id; }, clearTimer(id) { timers.delete(id); },
  });
  return { coordinator, timers, calls, commands, setResult: value => { result = value; },
    setNative: value => { native = value; }, setCapability: value => { capability = value; },
    setOnline: value => { online = value; }, advance: delta => { now += delta; },
    async fire(delay) { const entry = [...timers].find(([, timer]) => timer.delay === delay); assert.ok(entry, `No ${delay}ms timer`);
      timers.delete(entry[0]); await entry[1].fn(); await settle(); },
  };
}

test("five-minute metadata monitor is process-shared, delayed and absent in private-only or zero-window browsing", async () => {
  const h = await fixture();
  assert.equal(h.timers.size, 0);
  const privateStop = h.coordinator.watch(() => {}, false);
  assert.equal(h.timers.size, 0);
  const stopA = h.coordinator.watch(() => {}), stopB = h.coordinator.watch(() => {});
  assert.equal(h.timers.size, 1); assert.equal([...h.timers.values()][0].delay, 30000);
  await h.fire(30000);
  assert.equal(h.calls.length, 1); assert.equal(h.commands.length, 0, "Discovery must not download/install");
  assert.equal([...h.timers.values()][0].delay, 300000);
  stopA(); assert.equal(h.timers.size, 1);
  stopB(); assert.equal(h.timers.size, 0); privateStop();
});
test("concurrent manual and scheduled checks share one request and clear stale executable evidence on failure", async () => {
  const h = await fixture(); h.coordinator.watch(() => {});
  let resolve; h.setResult(() => new Promise(done => { resolve = done; }));
  const first = h.coordinator.check(), second = h.coordinator.check();
  assert.equal(first, second); await settle(); assert.equal(h.calls.length, 1);
  resolve({ state: "available", latest: "0.70.2-preview.1", downloadURL: "verified", evidence: { id: 1 } });
  await first; assert.equal(h.coordinator.getState().canInstall, true);
  h.setResult({ state: "unavailable", reason: "invalid-feed" }); await h.coordinator.check();
  assert.equal(h.coordinator.getState().state, "error");
  assert.equal(h.coordinator.getState().downloadURL, undefined);
  assert.equal(h.coordinator.getState().evidence, undefined);
  await h.coordinator.install(); assert.equal(h.commands.length, 0);
});
test("current candidate displays both installed and latest published versions without offering a downgrade", async () => {
  const h = await fixture();
  h.setResult({ state: "current", latest: "0.70.0-preview.1" });
  await h.coordinator.check();
  assert.match(h.coordinator.getState().detail, /Installed 0\.70\.1-preview\.1/);
  assert.match(h.coordinator.getState().detail, /Latest published: 0\.70\.0-preview\.1/);
  assert.equal(h.coordinator.getState().canInstall, false);
  await h.coordinator.install(); assert.equal(h.commands.length, 0);
});
test("an explicit click binds native consent to the displayed version; double clicks cannot start two installers", async () => {
  const h = await fixture(); h.coordinator.watch(() => {}); await h.coordinator.check();
  await Promise.all([h.coordinator.install(), h.coordinator.install()]);
  assert.deepEqual(h.commands, [{ action: "install", version: "0.70.2-preview.1", consent: true, channel: "preview" }]);
  assert.equal(h.coordinator.getState().canCheck, false);
  assert.equal([...h.timers.values()][0].delay, 250);
  await h.fire(250);
  assert.equal(h.coordinator.getState().progress, .5);
  assert.equal(h.coordinator.getState().canCancel, true);
  await h.coordinator.cancel(); assert.equal(h.commands[1].action, "cancel");
});
test("old offers require fresh displayed consent and custom-profile refusal retains only manual download", async () => {
  const h = await fixture(); h.coordinator.watch(() => {}); await h.coordinator.check();
  h.advance(600001); h.setResult({ state: "available", latest: "0.70.3-preview.1" });
  await h.coordinator.install();
  assert.equal(h.commands.length, 0); assert.equal(h.coordinator.getState().latest, "0.70.3-preview.1");
  h.setCapability({ canInstall: false, detail: "Custom profile: install manually." });
  h.setResult({ state: "available", latest: "0.70.3-preview.1", downloadURL: "verified" });
  await h.coordinator.check(); await h.coordinator.install();
  assert.equal(h.commands.length, 0); assert.equal(h.coordinator.getState().downloadURL, "verified");
  assert.match(h.coordinator.getState().detail, /Custom profile/);
});
test("cancelled quit uses an explicit retry and low-rate status monitoring without force termination", async () => {
  const h = await fixture(); h.coordinator.watch(() => {}); await h.coordinator.check(); await h.coordinator.install();
  h.setNative({ state: "retry", canRetry: true, detail: "Quit was canceled. Your tabs are still open." });
  await h.fire(250);
  assert.equal(h.timers.size, 1); assert.equal([...h.timers.values()][0].delay, 1000);
  await h.coordinator.check(); assert.equal(h.calls.length, 1);
  await h.coordinator.retry(); assert.equal(h.commands.at(-1).action, "retry");
  assert.equal(h.timers.size, 1);
  h.setNative({ state: "error", detail: "Installer failed while waiting for quit." });
  await h.fire(1000); assert.equal(h.coordinator.getState().state, "error");
  assert.equal([...h.timers.values()][0].delay, 300000);
});
test("opt-out, offline/backoff and server retry times do not produce background request storms", async () => {
  const h = await fixture(); h.coordinator.watch(() => {});
  h.coordinator.configureAutomatic(false); assert.equal(h.timers.size, 0);
  await h.coordinator.check(); assert.equal(h.calls.length, 1); assert.equal(h.timers.size, 0);
  h.coordinator.configureAutomatic(true); h.setOnline(false); await h.fire(30000);
  assert.equal(h.calls.length, 1); assert.equal([...h.timers.values()][0].delay, 600000);
  h.setOnline(true); h.setResult({ state: "unavailable", reason: "rate-limit", retryAt: 99999999 });
  await h.coordinator.check(); assert.equal([...h.timers.values()][0].delay, 99998999);
});
test("late requests and installer callbacks cannot update disposed windows or reschedule timers", async () => {
  const h = await fixture(); let emissions = 0; h.coordinator.watch(() => { emissions++; });
  let resolve; h.setResult(() => new Promise(done => { resolve = done; }));
  const check = h.coordinator.check(); await settle();
  h.coordinator.dispose(); const before = emissions;
  resolve({ state: "available", latest: "0.70.2-preview.1" }); await check;
  assert.equal(emissions, before); assert.equal(h.timers.size, 0); assert.equal(h.commands.length, 0);
});
