"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(require.resolve("../chrome/fluxion-palette.js"), "utf8");
const start = source.indexOf("      const verifyDialog = (attempt = 0) => {");
const end = source.indexOf("      window.setTimeout(() => verifyDialog(), 100);", start);
assert.ok(start >= 0 && end > start);
function fixture({ upgraded = true, categories = 5, result = "cancel", throws = false } = {}) {
  const prefs = new Map(), timers = new Map(), events = [], listeners = new Map();
  let timerId = 0, clicks = 0;
  const cancel = { click() {
    clicks++;
    if (result !== null) listeners.get("FluxionDataClearingDialogClosed")({ detail: { result } });
  } };
  const dialog = { localName: "dialog" };
  const upgrade = () => { dialog.getButton = name => {
    if (throws) throw new Error("Native button lookup failed");
    return name === "cancel" ? cancel : {};
  }; };
  if (upgraded) upgrade();
  const document = { documentURI: "chrome://browser/content/sanitize.xhtml", readyState: "loading",
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
  return { verify: context.verify, upgrade, prefs, timers, next, events, clicks: () => clicks };
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
  assert.match(f.prefs.get(errorKey), /sanitize.xhtml/);
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
