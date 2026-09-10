"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "../chrome/fluxion-tab-transfer-verification.js"), "utf8");
const first = source.indexOf("  async function keyboardMenu("), last = source.indexOf("  async function move(", first);
assert.ok(first > 0 && last > first);

function fixture({ wrongLeaf = false, unopenedSubmenu = false } = {}) {
  const pending = [], sent = [], report = {}, nodes = new Map();
  let listener, index = -1, turns = 0;
  const item = (id, label, localName = "menuitem") => ({ id, localName, hidden: false, disabled: false,
    getAttribute: name => name === "label" ? label : null,
  });
  const context = item("context", "Root", "menupopup"), submenu = item("submenu", "Sub", "menupopup");
  const menu = item("move", "Move to Window", "menu");
  const duplicate = item("duplicate", "Duplicate"), reload = item("reload", "Reload");
  context.children = [duplicate, reload, menu];
  for (const child of context.children) child.parentNode = context;
  submenu.parentNode = menu; submenu.children = [item("new-window", "New Window")];
  submenu.children[0].parentNode = submenu;
  context.state = submenu.state = "closed"; context.isNativeMenu = true;
  context.querySelectorAll = () => [submenu];
  context.addEventListener = (_type, handler) => { listener = handler; };
  context.removeEventListener = () => { listener = null; };
  context.hidePopup = () => { context.state = submenu.state = "closed"; };
  for (const popup of [context, submenu]) Object.defineProperty(popup, "activeChild", {
    set() { throw Error("Fixture must never fake native menu selection"); },
  });
  const anchor = { id: "anchor", isConnected: true, scrollIntoView() {}, focus() { document.activeElement = anchor; } };
  const document = { activeElement: anchor, getElementById: id => nodes.get(id), hasFocus: () => true };
  for (const node of [context, submenu, menu]) nodes.set(node.id, node);
  const window = { document, focus() {}, getComputedStyle: () => ({ display: "block", visibility: "visible" }),
    setTimeout(callback) { turns++; queueMicrotask(callback); },
  };
  const activate = target => listener?.({ isTrusted: true, target });
  const sandbox = vm.createContext({ window, report, Services: { focus: { activeWindow: window } },
    assert(value, message) { if (!value) throw Error(message); }, write() {},
    async waitFor(predicate, message) {
      if (predicate()) return true;
      while (pending.length) pending.shift()();
      if (!predicate()) throw Error(message);
      return true;
    },
    async nativeKey(action) {
      sent.push(action);
      if (action === "open") context.state = "open";
      if (action === "down") {
        if (submenu.state === "open") pending.push(() => activate(submenu.children[0]));
        else {
          index++;
          if (index < 2) pending.push(() => activate(index === 1 && wrongLeaf ? duplicate : context.children[index]));
        }
      }
      if (action === "right" && !unopenedSubmenu) submenu.state = "open";
      if (action === "escape") {
        if (submenu.state === "open") submenu.state = "closed";
        else { context.state = "closed"; anchor.focus(); }
      }
    },
  });
  vm.runInContext(source.slice(first, last), sandbox);
  return { run: () => sandbox.keyboardMenu(anchor, "context", "move", "submenu", "tab"),
    report, sent, turns: () => turns };
}

test("native menu fixture waits for processed leaf events and distinguishes header injection", async () => {
  const h = fixture(); await h.run();
  const evidence = h.report.nativeKeyboard[0];
  assert.deepEqual(Array.from(evidence.navigation.items, item => item.label), ["Duplicate", "Reload", "Move to Window"]);
  assert.equal(evidence.navigation.from, 0); assert.equal(evidence.navigation.target, 2);
  const leaf = evidence.keys.find(key => key.expected === "Reload");
  assert.equal(leaf.afterInjection.highlighted.label, "Duplicate");
  assert.equal(leaf.after.highlighted.label, "Reload");
  assert.match(leaf.acknowledgement, /trusted DOMMenuItemActive/);
  const header = evidence.keys.find(key => key.expected === "Move to Window");
  assert.match(header.acknowledgement, /unacknowledged/);
  assert.equal(h.turns(), 2);
  assert.equal(evidence.restoredAnchorFocus, true);
  assert.equal(evidence.final.context, "closed");
});

test("successful injection cannot conceal a wrong processed leaf or skip ahead", async () => {
  const h = fixture({ wrongLeaf: true });
  await assert.rejects(h.run(), /did not highlight expected leaf Reload/);
  assert.equal(h.sent.includes("right"), false);
  const entry = h.report.nativeKeyboard[0].keys.at(-1);
  assert.equal(entry.injectionAcknowledged, true);
  assert.equal(entry.after.highlighted.label, "Duplicate");
});

test("header settling never substitutes for the native submenu-open assertion", async () => {
  const h = fixture({ unopenedSubmenu: true });
  await assert.rejects(h.run(), /Native ArrowRight did not open Move to Window/);
  const evidence = h.report.nativeKeyboard[0];
  assert.equal(evidence.keys.at(-1).action, "right");
  assert.equal(evidence.final.submenu, "closed");
  assert.equal(evidence.restoredAnchorFocus, undefined);
});
