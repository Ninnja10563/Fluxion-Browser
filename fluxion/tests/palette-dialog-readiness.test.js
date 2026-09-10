"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(require.resolve("../chrome/fluxion-palette.js"), "utf8");
const start = source.indexOf("      const verifyDialog = (attempt = 0) => {");
const end = source.indexOf("      window.setTimeout(() => verifyDialog(), 100);", start);
assert.ok(start >= 0 && end > start);
function fixture({ upgraded = true, categories = 5, result = "cancel", throws = false, readyState = "complete" } = {}) {
  const prefs = new Map(), timers = new Map(), events = [], listeners = new Map();
  let timerId = 0, clicks = 0, lookups = 0;
  const cancel = { click() {
    clicks++;
    if (result !== null) listeners.get("FluxionDataClearingDialogClosed")({ detail: { result } });
  } };
  const dialog = { localName: "dialog" };
  const upgrade = () => { dialog.getButton = name => {
    lookups++;
    if (throws) throw new Error("Native button lookup failed");
    return name === "cancel" ? cancel : {};
  }; };
  if (upgraded) upgrade();
  const document = { documentURI: "chrome://browser/content/sanitize_v2.xhtml", readyState,
    querySelector: () => dialog, getElementById: id => id === "sanitizeDurationChoice" ? {} :
      categories === null ? null : { querySelectorAll: () => Array(categories).fill({}) } };
  const window = { gDialogBox: { isOpen: true, dialog: { frameContentWindow: { document } } },
    setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, delay }); return id; },
    clearTimeout: id => timers.delete(id), dispatchEvent: event => events.push(event.type),
    CustomEvent: class { constructor(type) { this.type = type; } } };
  const context = vm.createContext({ window, on: (_window, name, callback) => listeners.set(name, callback),
    Services: { prefs: { setStringPref: (key, value) => prefs.set(key, value), savePrefFile() {} } } });
  vm.runInContext(source.slice(start, end) + "\nglobalThis.verify = verifyDialog;", context);
  const next = () => { const [id, task] = timers.entries().next().value; timers.delete(id); task.fn(); };
  return { verify: context.verify, upgrade, prefs, timers, next, events, document, dialog,
    clicks: () => clicks, lookups: () => lookups };
}
const errorKey = "fluxion.dataClearing.visual.error";
const surfaceKey = "fluxion.dataClearing.surface.health";
const cancelKey = "fluxion.dataClearing.cancel.health";

test("unupgraded dialog retries readiness then verifies actual controls and cancel result", () => {
  const f = fixture({ upgraded: false }); f.verify();
  assert.equal(f.prefs.has(surfaceKey), false); assert.equal(f.clicks(), 0);
  assert.equal([...f.timers.values()][0].delay, 100);
  f.upgrade(); f.next();
  assert.equal(f.prefs.get(cancelKey), "native-dialog-cancelled-without-clearing");
  assert.equal(f.prefs.has(errorKey), false); assert.equal(f.clicks(), 1);
  assert.deepEqual(f.events, ["FluxionDataClearingVisualReady"]);
  assert.equal(f.timers.size, 0);
});
test("missing or insufficient categories exhaust the existing bound without passing", () => {
  for (const categories of [null, 0, 4]) {
    const f = fixture({ categories }); f.verify();
    for (let retry = 0; retry < 50; retry++) f.next();
    assert.equal(f.timers.size, 0); assert.equal(f.clicks(), 0);
    assert.equal(f.prefs.has(surfaceKey), false); assert.equal(f.prefs.has(cancelKey), false);
    assert.match(f.prefs.get(errorKey), /did not settle/);
    assert.match(f.prefs.get(errorKey), /"attempt":50/);
  }
});
test("native exceptions persist stack and safe readiness metadata instead of silently stopping", () => {
  const f = fixture({ throws: true }); f.verify();
  assert.match(f.prefs.get(errorKey), /Native button lookup failed/);
  assert.match(f.prefs.get(errorKey), /at dialog.getButton/);
  assert.match(f.prefs.get(errorKey), /sanitize_v2.xhtml/);
  assert.match(f.prefs.get(errorKey), /"getButtonType":"function"/);
  assert.equal(f.timers.size, 0); assert.equal(f.prefs.has(surfaceKey), false);
});
test("only genuine cancel completion releases downstream fixtures", () => {
  for (const result of ["accept", "", null]) {
    const f = fixture({ result }); f.verify();
    if (result === null) f.next();
    assert.equal(f.prefs.has(cancelKey), false);
    assert.equal(f.events.length, 0); assert.equal(f.prefs.has(errorKey), true);
  }
});

test("loading XUL prototype getter is never invoked before its button map initializes", () => {
  const f = fixture({ readyState: "loading" });
  f.document.documentURI = "chrome://browser/content/sanitize_v2.xhtml";
  let unsafeReads = 0;
  f.dialog.getButton = () => { unsafeReads++; throw Error("this._buttons is undefined"); };
  f.verify();
  assert.equal(unsafeReads, 0); assert.equal(f.clicks(), 0);
  assert.equal(f.prefs.has(errorKey), false);
  assert.match(f.prefs.get("fluxion.dataClearing.visual.stage"), /awaiting-loaded-dialog/);
  f.document.readyState = "interactive"; f.next();
  assert.equal(unsafeReads, 0);
  f.document.readyState = "complete"; f.upgrade(); f.next();
  assert.equal(f.lookups(), 2); assert.equal(f.clicks(), 1);
  assert.equal(f.prefs.get(cancelKey), "native-dialog-cancelled-without-clearing");
});

test("a document that never completes exhausts readiness without calling its native getter", () => {
  const f = fixture({ readyState: "loading", throws: true }); f.verify();
  for (let retry = 0; retry < 50; retry++) f.next();
  assert.equal(f.lookups(), 0); assert.equal(f.clicks(), 0); assert.equal(f.timers.size, 0);
  assert.match(f.prefs.get(errorKey), /"stage":"awaiting-loaded-dialog"/);
  assert.match(f.prefs.get(errorKey), /"attempt":50/);
  assert.equal(f.prefs.has(surfaceKey), false); assert.equal(f.prefs.has(cancelKey), false);
});

test("a fully loaded lookalike dialog never receives sanitizer control calls or clicks", () => {
  for (const uri of ["chrome://browser/content/sanitize.xhtml", "chrome://browser/content/sanitize_v2.xhtml?spoof",
    "https://example.org/sanitize_v2.xhtml"]) {
    const f = fixture(); f.document.documentURI = uri; f.verify();
    assert.match(f.prefs.get(errorKey), /Unexpected native sanitizer document/);
    assert.equal(f.lookups(), 0); assert.equal(f.clicks(), 0); assert.equal(f.timers.size, 0);
    assert.equal(f.prefs.has(surfaceKey), false); assert.equal(f.prefs.has(cancelKey), false);
  }
});
