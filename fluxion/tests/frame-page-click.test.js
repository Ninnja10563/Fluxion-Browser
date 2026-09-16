"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const source = fs.readFileSync(require.resolve("../chrome/fluxion-frame-verification.js"), "utf8");
const start = source.indexOf("  function clickNativePage("), end = source.indexOf("  const rows =", start);
function fixture(obscured = false) {
  const events = [], browser = { id: "real-page", contains: () => false }, blocker = { id: "popup" };
  const click = vm.runInNewContext(`${source.slice(start, end)}; clickNativePage`, {
    rect: () => ({ left: 7, right: 1916, top: 76, height: 1000, width: 1909 }),
    document: { elementFromPoint: () => obscured ? blocker : browser },
    assert(value, message) { if (!value) throw Error(message); },
    routePointer: (...args) => events.push(args),
  });
  return { events, run: () => click(browser) };
}
test("fullscreen page focus transfer routes a complete widget click at the actual visible page, never scripted blur", () => {
  const h = fixture(), result = h.run();
  assert.deepEqual(h.events, [[1856, 236], [1856, 236, "mousedown", 1], [1856, 236, "mouseup", 0]]);
  assert.equal(result.hit, "real-page");
  const region = source.slice(source.indexOf('      await action("fullscreen-location");'),
    source.indexOf('      await verifyPersistentNavigation("expanded");', source.indexOf('      await action("fullscreen-location");')));
  assert.match(region, /keyboardFocusRetainedOnPointerLeave = true/);
  assert.match(region, /clickNativePage\(browser\)/);
  assert.doesNotMatch(region, /browser\.focus\(|hideNavToolbox\(/);
});
test("fullscreen page click fails before dispatch if browser content is obscured", () => {
  const h = fixture(true); assert.throws(h.run, /obscured/); assert.deepEqual(h.events, []);
});
