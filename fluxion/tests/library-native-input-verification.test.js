"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../chrome/fluxion-library-verification.js"), "utf8");
const first = source.indexOf("  async function verifyNativeMenuEscape("), last = source.indexOf("  async function keyboardAndMenus(", first);
assert.ok(first >= 0 && last > first);

function fixture(options = {}) {
  const report = {}, requests = [], delivered = new Set(), listeners = new Map();
  const events = target => ({
    addEventListener(type, handler) { listeners.set(`${target}:${type}`, handler); },
    removeEventListener(type) { listeners.delete(`${target}:${type}`); },
  });
  const popup = { id: "owned-popup", state: "open", isNativeMenu: true, ...events("popup") };
  Object.defineProperty(popup, "activeChild", { set() { throw Error("No synthetic native selection"); } });
  popup.hidePopup = () => { throw Error("No programmatic dismissal"); };
  const anchor = { id: "anchor" }, document = { activeElement: anchor, hasFocus: () => true };
  const window = { document, ...events("window"), getComputedStyle: () => ({ display: "block", visibility: "visible" }) };
  const leaf = { localName: "menuitem", isConnected: true, parentNode: popup,
    disabled: Boolean(options.disabled), hidden: false, getAttribute: () => "Open" };
  if (options.foreign) leaf.parentNode = {};
  const Services = { focus: { activeWindow: window }, env: { get: key => key.includes("DOWN") ? "down" : "escape" }, prefs: {
    setStringPref(key) { requests.push(key.split(".").at(-1)); }, savePrefFile() {},
  } };
  const context = vm.createContext({ report, window, document, Services, prefix: "fixture",
    assert(value, message) { if (!value) throw Error(message); },
    async waitFor(predicate, message) { for (let i = 0; i < 3; i++) if (await predicate()) return; throw Error(message); },
    IOUtils: { async exists(action) {
      if (!delivered.has(action)) {
        delivered.add(action);
        if (action === "down" && !options.noHighlight) {
          listeners.get("popup:DOMMenuItemActive")?.({ target: leaf, isTrusted: !options.untrusted });
        }
        if (action === "escape" && !options.noClose) {
          popup.state = "closed";
          listeners.get("popup:popuphidden")?.({ target: popup, type: "popuphidden" });
          document.activeElement = options.wrongFocus ? {} : anchor;
        }
      }
      return !options.noAck;
    } },
  });
  vm.runInContext(source.slice(first, last), context);
  return { report, requests, listeners, run: () => context.verifyNativeMenuEscape(popup, anchor,
    () => ({ popupState: popup.state, expectedAnchorFocused: document.activeElement === anchor })) };
}

test("Library input preflight requires processed native leaf before Escape and captures both receipts", async () => {
  const f = fixture(); await f.run();
  assert.deepEqual(f.requests, ["down", "escape"]);
  assert.equal(f.report.nativeEscape.stage, "escape-processed");
  assert.equal(f.report.nativeEscape.nativeMenu, true);
  assert.equal(f.report.nativeEscape.acknowledgements.down, true);
  assert.equal(f.report.nativeEscape.acknowledgements.escape, true);
  assert.equal(f.report.nativeEscape.leaves[0].parent, "owned-popup");
  assert.equal(f.report.nativeEscape.transitions[0].type, "popuphidden");
  assert.equal(f.listeners.size, 0);
});

for (const options of [{ noAck: true }, { noHighlight: true }, { foreign: true }, { disabled: true }, { untrusted: true }]) {
  test(`Library cannot advance on missing receipt or invalid menu activation ${JSON.stringify(options)}`, async () => {
    const f = fixture(options);
    await assert.rejects(f.run(), /Native ArrowDown did not activate/);
    assert.deepEqual(f.requests, ["down"]);
    assert.equal(f.report.nativeEscape.stage, "down-requested");
    assert.equal(f.report.nativeEscape.acknowledgements.down, !options.noAck);
    assert.equal(f.listeners.size, 0);
  });
}

for (const options of [{ noClose: true }, { wrongFocus: true }]) {
  test(`Library preserves actual Escape dismissal and anchor-focus requirements ${JSON.stringify(options)}`, async () => {
    const f = fixture(options);
    await assert.rejects(f.run(), /Native Escape did not dismiss/);
    assert.deepEqual(f.requests, ["down", "escape"]);
    assert.equal(f.report.nativeEscape.acknowledgements.escape, true);
    assert.equal(f.report.nativeEscape.stage, "escape-requested");
    assert.equal(f.listeners.size, 0);
  });
}
