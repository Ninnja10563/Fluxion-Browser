"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../chrome/fluxion-migration-verification.js"), "utf8");
const assertNative = (ok, message) => { if (!ok) throw Error(message); };

test("migration pointer actions hit the real owned control and reject hidden, disabled or foreign targets", () => {
  const events = [], dialog = { document: { defaultView: { getComputedStyle: () => ({ visibility: "visible" }) } },
    windowUtils: { DEFAULT_MOUSE_POINTER_ID: 1 }, MouseEvent: { MOZ_SOURCE_MOUSE: 1 },
    synthesizeMouseEvent: (...args) => events.push(args) };
  const target = { isConnected: true, disabled: false, ownerDocument: dialog.document,
    getBoundingClientRect: () => ({ x: 10, y: 20, width: 40, height: 24 }) };
  const context = vm.createContext({ dialog, target, assert: assertNative });
  vm.runInContext(source.slice(source.indexOf("  const visible ="), source.indexOf("  const requestDriver =")), context);
  vm.runInContext("click(target)", context);
  assert.deepEqual(events.map(args => args.slice(0, 3)), [["mousemove", 30, 32], ["mousedown", 30, 32], ["mouseup", 30, 32]]);
  for (const [type, , , options, routing] of events) {
    assert.deepEqual(JSON.parse(JSON.stringify(options)), { identifier: 1, button: 0,
      buttons: type === "mousedown" ? 1 : 0, clickCount: type === "mousemove" ? 0 : 1, modifiers: 0, inputSource: 1 });
    assert.deepEqual(JSON.parse(JSON.stringify(routing)), {
      isDOMEventSynthesized: true, isWidgetEventSynthesized: false, isAsyncEnabled: false, toWindow: true,
    });
  }
  for (const change of [() => { target.disabled = true; }, () => { target.isConnected = false; },
    () => { target.getBoundingClientRect = () => ({ width: 0, height: 24 }); },
    () => { target.ownerDocument = { defaultView: dialog.document.defaultView }; }]) {
    target.disabled = false; target.isConnected = true; target.ownerDocument = dialog.document;
    target.getBoundingClientRect = () => ({ x: 10, y: 20, width: 40, height: 24 });
    change(); assert.throws(() => vm.runInContext("click(target)", context), /hidden, disabled or foreign/);
  }
  assert.equal(events.length, 3);
});

async function openFixture({ settingsNavigation = false, disabled = false, loadingViews = [] } = {}) {
  const selectedTab = {}, browser = { tabs: [selectedTab], selectedTab }, events = [];
  let loadingChecks = 0;
  const shadow = { querySelector: () => ({ getAttribute: () => {
    loadingChecks++; return loadingViews.length ? loadingViews.shift() : "page-selection";
  } }) };
  const dialog = { closed: false, document: {
    documentURI: "chrome://browser/content/migration/migration-dialog-window.html", hasFocus: () => true,
    getElementById: () => ({ shadowRoot: shadow }),
  }, customElements: { whenDefined: async () => {} } };
  const command = { getAttribute: () => disabled ? "true" : "false", dispatchEvent(event) {
    events.push(event.type); if (settingsNavigation) browser.tabs.push({});
  } };
  const context = vm.createContext({ dialog: null, assert: assertNative,
    window: { gBrowser: browser, document: { getElementById: () => command }, Event: class { constructor(type) { this.type = type; } } },
    Services: { wm: { getEnumerator: () => [dialog] }, focus: { activeWindow: dialog } },
    wait: async (predicate, message) => {
      for (let attempt = 0; attempt < 16; attempt++) { const value = await predicate(); if (value) return value; }
      throw Error(message);
    },
  });
  const start = source.indexOf("  async function openWizard()"), end = source.indexOf("  async function run()", start);
  await vm.runInContext(`${source.slice(start, end)}\nopenWizard();`, context);
  return { events, context, loadingChecks };
}
test("migration gate invokes the existing native command and requires a loaded focused standalone wizard", async () => {
  const result = await openFixture(); assert.deepEqual(result.events, ["command"]);
  assert.equal(result.context.Services.focus.focusedWindow, result.context.dialog);
});
test("migration gate fails if import remains a preferences navigation or its native command is disabled", async () => {
  await assert.rejects(openFixture({ settingsNavigation: true }), /hidden preferences destination/);
  await assert.rejects(openFixture({ disabled: true }), /Native import command unavailable/);
});

test("migration wizard waits through missing view state and loading instead of treating undefined as loaded", async () => {
  const result = await openFixture({ loadingViews: [undefined, "page-loading", "page-selection"] });
  assert.equal(result.loadingChecks, 3);
});

async function settleFixture(sequence) {
  const report = {}, selector = { id: "browser-profile-selector", contains: node => node === child }, child = {};
  let sample = sequence[0], attempt = 0;
  selector.getBoundingClientRect = () => ({ x: 24, y: 64, width: 320, height: 50 });
  const dialog = { screenX: 400, screenY: 300, outerHeight: 300, innerWidth: 360, innerHeight: 280,
    document: { readyState: "complete", hasFocus: () => sample.focus !== false }, windowUtils: {} };
  const shadow = {
    querySelector: id => id === "#browser-profile-selector" ? selector : { getAttribute: () => sample.view || "page-selection" },
    elementFromPoint: () => sample.occluded ? {} : child,
  };
  const context = vm.createContext({ report, dialog, shadow, Services: { focus: { activeWindow: dialog } }, visible: () => true,
    wait: async (predicate, message) => {
      for (const state of sequence) {
        sample = state; attempt++; dialog.outerWidth = state.width || 380;
        dialog.windowUtils.isMozAfterPaintPending = Boolean(state.paint);
        const value = await predicate(); if (value) return value;
      }
      throw Error(message);
    },
  });
  const start = source.indexOf("  async function settledSelector("), end = source.indexOf("  function traceSelection(", start);
  const value = await vm.runInContext(`${source.slice(start, end)}\nsettledSelector(shadow)`, context);
  return { value, selector, report, attempt };
}

test("selector readiness waits for pending paint and resets stability after native resize or failed hit testing", async () => {
  const result = await settleFixture([{ view: "page-loading" }, { paint: true }, { width: 380 },
    { width: 420 }, { width: 420, occluded: true }, { width: 420 }, { width: 420 }, { width: 420 }]);
  assert.equal(result.value, result.selector); assert.equal(result.attempt, 8);
  assert.equal(result.report.selectionReadiness.geometryChanges, 1);
  assert.equal(result.report.selectionReadiness.pendingPaintSamples, 1);
  assert.equal(result.report.selectionReadiness.last.stable, 3);
});

test("persistent selector occlusion, focus loss or paint never passes the bounded readiness gate", async () => {
  for (const state of [{ occluded: true }, { focus: false }, { paint: true }, { view: "page-loading" }]) {
    await assert.rejects(settleFixture(Array(12).fill(state)), /stable painted, focused, hit-testable geometry/);
  }
});
