"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../chrome/core/browser-preferences.js");
const settingsFixture = require("./settings-window-fixture.js");

function preferences() {
  const defaults = new Map(core.DEFINITIONS.map((item, index) => [item.pref, index % 2 === 0]));
  const user = new Map(), metadata = new Map(), locked = new Set(), observers = new Map();
  let saves = 0;
  const events = [];
  const notify = name => { for (const [key, entries] of observers) if (name.startsWith(key)) for (const entry of entries) entry.observe(null, "nsPref:changed", name); };
  return {
    defaults, user, locked, events, observers,
    getBoolPref(name, fallback) { return (!locked.has(name) && user.has(name) ? user.get(name) : defaults.get(name)) ?? fallback; },
    getIntPref: (_name, fallback) => fallback, getStringPref: (name, fallback) => metadata.get(name) ?? fallback,
    setStringPref(name, value) { metadata.set(name, value); },
    setBoolPref(name, value) { assert.equal(typeof value, "boolean"); assert.equal(locked.has(name), false); events.push(["write", name, value]); user.set(name, value); notify(name); },
    clearUserPref(name) { assert.equal(locked.has(name), false); events.push(["reset", name]); user.delete(name); notify(name); },
    prefHasUserValue: name => user.has(name), prefIsLocked: name => locked.has(name),
    savePrefFile() { saves++; }, get saves() { return saves; },
    addObserver(name, observer) { if (!observers.has(name)) observers.set(name, new Set()); observers.get(name).add(observer); },
    removeObserver(name, observer) { observers.get(name)?.delete(observer); },
    lock(name) { locked.add(name); notify(name); }, unlock(name) { locked.delete(name); notify(name); },
  };
}

test("browser boolean bindings retain exact Gecko defaults without writes, including both inverse controls", () => {
  const prefs = preferences(), service = core.create(prefs);
  for (const item of core.DEFINITIONS) {
    assert.equal(service.read(item.id).checked, item.inverse ? !prefs.defaults.get(item.pref) : prefs.defaults.get(item.pref));
    assert.equal(service.read(item.id).modified, false);
    assert.equal(service.read(item.id).locked, false);
  }
  assert.deepEqual(prefs.events, []);
  assert.equal(core.DEFINITIONS.find(item => item.id === "hardware-acceleration").restart, true);
});

test("typed writes and resets synchronize subscribers and remove only the selected user preference", () => {
  const prefs = preferences(), service = core.create(prefs), notifications = [];
  const stopA = service.subscribe(() => notifications.push("a")), stopB = service.subscribe(() => notifications.push("b"));
  prefs.user.set("unrelated.setting", true);
  for (const item of core.DEFINITIONS) {
    assert.equal(service.write(item.id, true), true);
    assert.equal(prefs.user.get(item.pref), !item.inverse);
    assert.equal(service.read(item.id).modified, true);
    assert.equal(service.reset(item.id), true);
    assert.equal(prefs.user.has(item.pref), false);
  }
  assert.equal(notifications.length, 24);
  assert.equal(prefs.user.get("unrelated.setting"), true);
  stopA(); stopA(); stopB();
  service.write("smooth-scrolling", false);
  assert.equal(notifications.length, 24);
  assert.ok([...prefs.observers.values()].every(entries => entries.size === 0));
});

test("policy locks, missing values, unknown names and nonboolean writes cannot mutate native preferences", () => {
  const prefs = preferences(), service = core.create(prefs), item = core.DEFINITIONS[0];
  prefs.user.set(item.pref, !prefs.defaults.get(item.pref));
  prefs.lock(item.pref);
  assert.equal(service.read(item.id).checked, prefs.defaults.get(item.pref));
  assert.equal(service.write(item.id, false), false);
  assert.equal(service.reset(item.id), false);
  assert.throws(() => service.write(item.id, "false"), TypeError);
  assert.throws(() => service.write("arbitrary.secret", true), TypeError);
  const missing = core.DEFINITIONS[1]; prefs.defaults.delete(missing.pref);
  assert.equal(service.read(missing.id).available, false);
  assert.equal(service.write(missing.id, true), false);
  assert.deepEqual(prefs.events, []);
});

test("actual Settings controls write exact native preferences across windows and section reset retains unrelated choices", async () => {
  const prefs = preferences(), a = settingsFixture("about:preferences#general", [], { sharedPrefs: prefs });
  const b = settingsFixture("about:preferences#privacy", [], { sharedPrefs: prefs });
  assert.equal(a.section(), "general"); assert.equal(b.section(), "privacy");
  assert.deepEqual(prefs.events, [], "Opening both custom Settings surfaces must not tune browser defaults");
  const field = (owner, id) => owner.document.getElementById(`fluxion-browser-${id}`);
  const originals = new Map(core.DEFINITIONS.map(item => [item.id, field(a, item.id).checked]));
  for (const item of core.DEFINITIONS) {
    const input = field(a, item.id); input.focus(); input.checked = !input.checked;
    await input.dispatchEvent({ type: "change" });
    assert.equal(prefs.user.get(item.pref), item.inverse ? !input.checked : input.checked);
    assert.equal(field(b, item.id).checked, input.checked);
    assert.equal(a.document.activeElement, input);
    assert.ok(input.getAttribute("aria-labelledby")); assert.ok(input.getAttribute("aria-describedby"));
  }
  await a.document.getElementById("fluxion-browser-reset-general").dispatchEvent({ type: "click" });
  for (const item of core.DEFINITIONS) {
    assert.equal(prefs.user.has(item.pref), item.section === "privacy");
    if (item.section === "general") assert.equal(field(b, item.id).checked, originals.get(item.id));
  }
  await b.document.getElementById("fluxion-browser-reset-privacy").dispatchEvent({ type: "click" });
  assert.equal(prefs.user.size, 0);
  for (const item of core.DEFINITIONS) assert.equal(field(a, item.id).checked, originals.get(item.id));
  a.unload(); b.unload();
  for (const item of core.DEFINITIONS) assert.equal(prefs.observers.get(item.pref).size, 0);
});

test("actual Settings follows live policy locks and rejects a forged change event without stealing focus", async () => {
  const prefs = preferences(), h = settingsFixture("about:preferences#privacy", [], { sharedPrefs: prefs });
  const item = core.DEFINITIONS.find(item => item.id === "save-passwords");
  const input = h.document.getElementById(`fluxion-browser-${item.id}`), external = {};
  h.document.activeElement = external;
  prefs.lock(item.pref); assert.equal(input.disabled, true);
  input.checked = !input.checked;
  await input.dispatchEvent({ type: "change" });
  assert.equal(input.checked, prefs.defaults.get(item.pref));
  assert.equal(prefs.user.has(item.pref), false); assert.deepEqual(prefs.events, []);
  assert.equal(h.document.activeElement, external);
  prefs.unlock(item.pref); assert.equal(input.disabled, false);
});
