"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../chrome/fluxion-branding-verification.js"), "utf8");
function helper(start, end, extra = {}) {
  const first = source.indexOf(start), last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first);
  const sandbox = vm.createContext({ assert(value, message) { if (!value) throw Error(message); }, ...extra });
  vm.runInContext(source.slice(first, last), sandbox);
  return sandbox;
}
test("native branding evidence requires exact resolved product and safety wording, allowing Fluent isolation", () => {
  const report = { strings: {} }, h = helper("  function requireProductString(", "  const painted", {
    report, plain: value => String(value).replace(/[\u2066-\u2069]/g, ""),
  });
  h.requireProductString("quit", "Quit \u2068Fluxion\u2069", "Quit Fluxion");
  assert.equal(report.strings.quit, "Quit Fluxion");
  assert.throws(() => h.requireProductString("quit", "Quit Firefox", "Quit Fluxion"), /Native branded string/);
  assert.throws(() => h.requireProductString("warning", "Fluxion is on guard", "You turned off protections"), /lost meaning/);
  assert.throws(() => h.requireProductString("legal", "Fluxion trademark", "Firefox and the Firefox logos are trademarks of the Mozilla Foundation."), /lost meaning/);
});
test("native mark evidence rejects opaque app tiles, blank images and malformed pixel dimensions", () => {
  const h = helper("  function validateMarkPixels(", "  function validateNativeArt("), pixels = new Uint8ClampedArray(40 * 40 * 4);
  for (let y = 8; y < 32; y++) for (let x = 8; x < 32; x++) pixels[(y * 40 + x) * 4 + 3] = 255;
  const evidence = h.validateMarkPixels(pixels, 40, 40);
  assert.equal(evidence.visible, 576);
  assert.equal(evidence.transparent, 1024);
  const tile = pixels.slice(); tile[3] = 255;
  assert.throws(() => h.validateMarkPixels(tile, 40, 40), /opaque app-tile corner/);
  assert.throws(() => h.validateMarkPixels(new Uint8ClampedArray(pixels.length), 40, 40), /empty/);
  assert.throws(() => h.validateMarkPixels(pixels, 64, 64), /dimensions/);
  const mostlyOpaque = new Uint8ClampedArray(pixels.length).fill(255);
  for (const index of [3, 39 * 4 + 3, 39 * 40 * 4 + 3, pixels.length - 1]) mostlyOpaque[index] = 0;
  assert.throws(() => h.validateMarkPixels(mostlyOpaque, 40, 40), /transparent background/);
});
test("native resource evidence requires exact supplied mark bytes and separate security-state badges", () => {
  const h = helper("  function validateNativeArt(", "  async function artwork("), mark = "fixturePNG";
  const image = '<image href="data:image/png;base64,fixturePNG"/>';
  h.validateNativeArt("chrome://branding/content/about-logo.svg", `<svg>${image}</svg>`, mark);
  h.validateNativeArt("chrome://browser/skin/trustpanel-graphic-warning.svg", `<svg>${image}<path d="M0 0"/></svg>`, mark);
  h.validateNativeArt("chrome://browser/skin/trustpanel-graphic-disabled.svg", `<svg>${image}<circle r="3"/></svg>`, mark);
  assert.throws(() => h.validateNativeArt("about-logo.svg", '<svg><image href="wrong.png"/></svg>', mark), /exact|supplied/);
  assert.throws(() => h.validateNativeArt("about-logo.svg", `<svg aria-label="Firefox">${image}</svg>`, mark), /Firefox branding/);
  for (const state of ["warning", "disabled"]) {
    assert.throws(() => h.validateNativeArt(`trustpanel-graphic-${state}.svg`, `<svg>${image}</svg>`, mark), /status badge/);
  }
});
test("security evidence rejects detached or zero-size popup anchors while allowing native panel insets", () => {
  const h = helper("  function validateSecurityAnchor(", "  async function securityPanel(");
  const anchor = { left: 420, top: 28, bottom: 60, width: 28, height: 32 };
  const panel = { left: 416, top: 64, width: 400, height: 312 };
  const result = h.validateSecurityAnchor(anchor, panel);
  assert.equal(result.anchor.left, 420);
  assert.equal(result.panel.top, 64);
  assert.throws(() => h.validateSecurityAnchor(anchor, { ...panel, left: 4, top: 0 }), /detached/);
  assert.throws(() => h.validateSecurityAnchor(anchor, { ...panel, top: 130 }), /detached/);
  assert.throws(() => h.validateSecurityAnchor({ ...anchor, width: 0 }, panel), /painted bounds/);
  assert.throws(() => h.validateSecurityAnchor(anchor, { ...panel, height: 0 }), /painted bounds/);
});
test("branding location preparation uses only the native Escapes needed to restore the real security proxy", async () => {
  for (const scenario of ["first-ready", "second-needed", "untrusted-second", "still-invalid"]) {
    const report = { securityNavigation: { keys: [] } }, actions = [], listeners = new Map();
    const input = {}, document = { activeElement: null };
    let proxy = "invalid", typed = "https://example.org/", directMutation = false;
    const queryListeners = new Set();
    const gURLBar = { inputField: input, view: { isOpen: true }, lastQueryContextPromise: Promise.resolve(),
      controller: { addListener: value => queryListeners.add(value), removeListener: value => queryListeners.delete(value) } };
    for (const name of ["setURI", "handleRevert", "setAttribute"]) gURLBar[name] = () => { directMutation = true; throw Error("Native state forced"); };
    const window = { gURLBar, addEventListener: (name, callback) => listeners.set(name, callback),
      removeEventListener: name => listeners.delete(name) };
    const h = helper("  async function nativeLocationRevert(", "  async function securityPanel(", {
      window, document, report,
      async wait(condition, message) {
        for (let attempt = 0; attempt < 10; attempt++) { if (condition()) return; await Promise.resolve(); }
        throw Error(message);
      },
      async nativeKey(action) {
        actions.push(action);
        if (action === "branding-location") {
          document.activeElement = input;
          gURLBar.lastQueryContextPromise = Promise.resolve({ results: [{}] });
        }
        else if (action === "branding-location-escape") {
          gURLBar.view.isOpen = false;
          if (scenario === "first-ready") { proxy = "valid"; typed = null; }
        } else if (scenario === "first-ready") {
          // Reproduce the actual native artifact: an unnecessary second
          // Escape makes a previously valid location proxy invalid again.
          proxy = "invalid";
        } else if (scenario === "second-needed") { proxy = "valid"; typed = null; }
        listeners.get("keydown")({ key: action === "branding-location" ? "l" : "Escape",
          metaKey: action === "branding-location", isTrusted: action !== "branding-location-revert" || scenario !== "untrusted-second" });
      },
    });
    const run = h.nativeLocationRevert(() => ({ proxy, userTypedValue: typed }));
    if (scenario === "untrusted-second") await assert.rejects(run, /Second native Escape/);
    else if (scenario === "still-invalid") await assert.rejects(run, /valid unedited HTTPS security proxy/);
    else {
      await run;
      assert.equal(report.securityNavigation.afterDismiss.proxy, scenario === "first-ready" ? "valid" : "invalid");
      assert.equal(report.securityNavigation.afterRevert.proxy, "valid");
    }
    assert.equal(report.securityNavigation.revertNeeded, scenario !== "first-ready");
    assert.deepEqual(actions, scenario === "first-ready" ? ["branding-location", "branding-location-escape"] :
      ["branding-location", "branding-location-escape", "branding-location-revert"]);
    assert.equal(directMutation, false);
    assert.equal(listeners.size, 0);
    assert.equal(queryListeners.size, 0);
  }
});

test("branding Escape waits for the new current native query and real open view, not stale results or focus alone", async () => {
  for (const scenario of ["delayed-open", "already-open", "replaced-query", "stale-promise", "query-rejected", "never-opens"]) {
    const report = { securityNavigation: { keys: [] } }, actions = [], listeners = new Map(), queryListeners = new Set(), steps = [];
    const input = {}, document = { activeElement: null };
    let proxy = "invalid", typed = "https://example.org/", resolvedCurrent = false;
    const urlbar = { inputField: input, view: { isOpen: scenario === "already-open" }, lastQueryContextPromise: Promise.resolve({ results: ["previous"] }),
      controller: { addListener: value => queryListeners.add(value), removeListener: value => queryListeners.delete(value) } };
    const notify = (name, context = { results: [] }) => { for (const observer of queryListeners) observer[name]?.(context); };
    const window = { gURLBar: urlbar, addEventListener: (type, fn) => listeners.set(type, fn),
      removeEventListener: type => listeners.delete(type) };
    const h = helper("  async function nativeLocationRevert(", "  async function securityPanel(", {
      window, document, report,
      async wait(condition, message) {
        for (let attempt = 0; attempt < 25; attempt++) {
          if (condition()) return;
          steps.shift()?.();
          await Promise.resolve();
        }
        throw Error(message);
      },
      async nativeKey(action) {
        actions.push(action);
        if (action === "branding-location") {
          document.activeElement = input;
          listeners.get("keydown")({ key: "l", metaKey: true, isTrusted: true });
          if (scenario === "already-open") { resolvedCurrent = true; return; }
          if (scenario === "stale-promise") { urlbar.view.isOpen = true; return; }
          let resolveFirst, rejectFirst;
          urlbar.lastQueryContextPromise = new Promise((resolve, reject) => { resolveFirst = resolve; rejectFirst = reject; });
          notify("onQueryStarted");
          if (scenario === "query-rejected") { steps.push(() => rejectFirst(Error("fixture query failure"))); return; }
          steps.push(() => {
            if (scenario !== "never-opens") { urlbar.view.isOpen = true; notify("onViewOpen"); }
          });
          if (scenario === "replaced-query") {
            let resolveNext;
            steps.push(() => {
              urlbar.lastQueryContextPromise = new Promise(resolve => { resolveNext = resolve; });
              notify("onQueryCancelled"); notify("onQueryStarted");
            });
            steps.push(() => resolveFirst({ results: ["superseded"] }));
            steps.push(() => {
              assert.deepEqual(actions, ["branding-location"], "Old promise resolution must not trigger Escape");
              resolvedCurrent = true; notify("onQueryFinished"); resolveNext({ results: ["current"] });
            });
          } else steps.push(() => { resolvedCurrent = true; notify("onQueryFinished"); resolveFirst({ results: ["current"] }); });
        } else {
          assert.equal(action, "branding-location-escape", "Readiness must not add retries or extra native Escapes");
          assert.ok(resolvedCurrent && urlbar.view.isOpen, "Escape was sent before actual current query and view readiness");
          listeners.get("keydown")({ key: "Escape", metaKey: false, isTrusted: true });
          urlbar.view.isOpen = false; proxy = "valid"; typed = null; notify("onViewClose");
        }
      },
    });
    const promise = h.nativeLocationRevert(() => ({ proxy, userTypedValue: typed }));
    if (["delayed-open", "already-open", "replaced-query"].includes(scenario)) {
      await promise;
      assert.deepEqual(actions, ["branding-location", "branding-location-escape"]);
      assert.equal(report.securityNavigation.queryReadiness.watchedQueries, scenario === "replaced-query" ? 2 : 1);
      assert.equal(report.securityNavigation.queryReadiness.settled, true);
      assert.equal(report.securityNavigation.queryReadiness.initiallyOpen, scenario === "already-open");
      assert.equal(report.securityNavigation.queryReadiness.reusedInitialQuery, scenario === "already-open");
      assert.equal(report.securityNavigation.keys.at(-1).viewOpen, true);
      assert.equal(report.securityNavigation.afterRevert.viewOpen, false);
      assert.ok(report.securityNavigation.lifecycle.some(event => event.stage === "ready-before-first-escape" && event.viewOpen));
    } else {
      await assert.rejects(promise, scenario === "query-rejected" ? /query rejected/ : /current query and open before Escape/);
      assert.deepEqual(actions, ["branding-location"], "Failed readiness cannot send Escape or force browser state");
    }
    assert.ok(report.securityNavigation.lifecycle.length <= 32);
    assert.equal(listeners.size, 0); assert.equal(queryListeners.size, 0);
  }
});
