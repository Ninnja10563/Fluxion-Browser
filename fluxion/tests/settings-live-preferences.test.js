"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const settingsWindow = require("./settings-window-fixture.js");

function preferences(initial = []) {
  const values = new Map(initial), observers = new Map(), writes = [];
  function put(name, value) {
    values.set(name, value); writes.push({ name, value });
    for (const [prefix, listeners] of observers) if (name.startsWith(prefix)) {
      for (const listener of [...listeners]) listener.observe(null, "nsPref:changed", name);
    }
  }
  return { values, observers, writes,
    addObserver(name, observer) { if (!observers.has(name)) observers.set(name, new Set()); observers.get(name).add(observer); },
    removeObserver(name, observer) { observers.get(name)?.delete(observer); },
    getStringPref: (name, fallback) => values.get(name) ?? fallback,
    getBoolPref: (name, fallback) => values.get(name) ?? fallback,
    getIntPref: (name, fallback) => values.get(name) ?? fallback,
    setStringPref: put, setBoolPref: put, setIntPref: put, savePrefFile() {},
  };
}
const descendants = node => (node.children || []).flatMap(child => [child, ...descendants(child)]);
function fixture(sharedPrefs) {
  const h = settingsWindow("about:preferences", [], { sharedPrefs });
  h.window.FluxionUI.setSidebarState = value => sharedPrefs.setStringPref("fluxion.sidebar.state", value);
  h.window.FluxionUI.setTabDensity = value => sharedPrefs.setStringPref("fluxion.tabs.density", value);
  return { ...h, field(title) {
    const row = descendants(h.root).find(node => node.children?.[0]?.children?.[0]?.textContent === title);
    assert.ok(row, `Actual Settings row ${title} exists`);
    return row.children[1];
  } };
}

test("shipped General/Appearance controls reflect toolbar and another-window preference changes without writeback", () => {
  const prefs = preferences(), a = fixture(prefs), b = fixture(prefs);
  const change = (title, value) => { a.field(title).value = value; a.field(title).dispatchEvent({ type: "change" }); };
  change("When Fluxion starts", "3");
  change("Flow sidebar", "compact");
  change("Tab density", "roomy");
  const motion = a.field("Interface motion").querySelector("input");
  motion.checked = false; motion.dispatchEvent({ type: "change" });
  prefs.setIntPref("browser.link.open_newwindow", 2);
  for (const h of [a, b]) {
    assert.equal(h.field("When Fluxion starts").value, "3");
    assert.equal(h.field("Flow sidebar").value, "compact");
    assert.equal(h.field("Tab density").value, "roomy");
    assert.equal(h.field("Interface motion").querySelector("input").checked, false);
    assert.equal(h.field("Open links in tabs").querySelector("input").checked, false);
  }
  const before = prefs.writes.length;
  prefs.setStringPref("fluxion.sidebar.state", "focus");
  assert.equal(b.field("Flow sidebar").value, "focus");
  assert.equal(prefs.writes.length, before + 1, "synchronization must not save stale fields back to preferences");
});

test("homepage drafts survive remote edits and Settings tab changes until the user commits", () => {
  const prefs = preferences([["browser.startup.homepage", "https://saved.example/"]]);
  const a = fixture(prefs), b = fixture(prefs);
  a.document.activeElement = a.homepage;
  a.homepage.value = "https://my-unsaved.example/";
  a.homepage.dispatchEvent({ type: "input" });
  b.homepage.value = "https://other-window.example/";
  b.homepage.dispatchEvent({ type: "change" });
  assert.equal(a.homepage.value, "https://my-unsaved.example/");
  a.document.activeElement = null;
  a.select({ currentURI: { spec: "https://away.example/" } });
  a.select(a.firstBrowser);
  assert.equal(a.homepage.value, "https://my-unsaved.example/");
  assert.equal(prefs.values.get("browser.startup.homepage"), "https://other-window.example/");
  a.homepage.dispatchEvent({ type: "change" });
  assert.equal(b.homepage.value, "https://my-unsaved.example/");
  prefs.setStringPref("fluxion.newtab.url", "file:///fixture/newtab.html");
  prefs.setStringPref("browser.startup.homepage", "file:///fixture/newtab.html");
  assert.equal(a.homepage.value, "about:newtab");
  assert.equal(b.homepage.value, "about:newtab");
});

test("a focused unchanged homepage updates but a pending select choice is not overwritten", () => {
  const prefs = preferences(), h = fixture(prefs);
  h.document.activeElement = h.homepage;
  prefs.setStringPref("browser.startup.homepage", "https://fresh.example/");
  assert.equal(h.homepage.value, "https://fresh.example/");
  const startup = h.field("When Fluxion starts");
  h.document.activeElement = startup;
  startup.value = "3";
  prefs.setIntPref("browser.startup.page", 0);
  assert.equal(startup.value, "3");
  startup.dispatchEvent({ type: "change" });
  assert.equal(prefs.values.get("browser.startup.page"), 3);
  prefs.setIntPref("browser.startup.page", 1);
  assert.equal(startup.value, "1", "a committed focused select is no longer treated as a pending edit");
});

test("unload removes live observers and queued notifications cannot mutate destroyed Settings", () => {
  const prefs = preferences(), h = fixture(prefs);
  const observers = [...prefs.observers.get("fluxion.sidebar.state")];
  assert.equal(observers.length, 1);
  const before = h.field("Flow sidebar").value;
  h.unload();
  assert.equal(prefs.observers.get("fluxion.sidebar.state").size, 0);
  prefs.setStringPref("fluxion.sidebar.state", "compact");
  observers[0].observe(null, "nsPref:changed", "fluxion.sidebar.state");
  assert.equal(h.field("Flow sidebar").value, before);
});
