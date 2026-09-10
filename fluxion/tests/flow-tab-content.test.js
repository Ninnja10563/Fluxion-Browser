"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Content = require("../chrome/core/flow-tab-content.js");
const Status = require("../chrome/core/tab-status.js");

function fixture() {
  class Element {
    constructor() {
      this.attributes = new Map(); this.dataset = {}; this.children = [];
      this.listeners = new Map(); this.classes = new Set(); this.replacements = 0; this.attributeWrites = 0;
      this.classList = { contains: name => this.classes.has(name), toggle: (name, on) => on ? this.classes.add(name) : this.classes.delete(name) };
    }
    setAttribute(name, value) { this.attributes.set(name, value); this.attributeWrites++; }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    addEventListener(name, callback) { this.listeners.set(name, callback); }
    replaceChildren(...children) { this.children = children; this.replacements++; }
    replaceWith(next) { this.replacement = next; }
  }
  const item = new Element();
  const parts = Object.fromEntries(["favicon", "title", "peek", "split", "indicators", "audio", "close"]
    .map(name => [name, new Element()]));
  parts.faviconURL = "";
  item._fluxionParts = parts;
  item.tabIndex = 0;
  const helpers = {
    create: () => new Element(), fallbackIcon: () => new Element(),
    statusGlyph: indicator => ({ kind: indicator.kind }), controlGlyph: kind => ({ kind }),
  };
  const state = {
    sleeping: false, status: Status.describe({}), label: "Original title", active: true,
    multiselected: false, url: "https://example.org/", faviconURL: "", peek: false, splitLabel: "",
  };
  const update = changes => { Object.assign(state, changes); Content.update(item, state, helpers); };
  update({});
  return { item, parts, state, update };
}

test("title and status updates preserve row, controls and keyboard focus position", () => {
  const h = fixture();
  const identities = { ...h.parts };
  h.update({ label: "Updated title", sleeping: true, status: Status.describe({ sleeping: true, soundPlaying: true }) });
  assert.equal(h.item.tabIndex, 0);
  for (const key of ["title", "audio", "close", "indicators"]) assert.equal(h.parts[key], identities[key]);
  assert.equal(h.parts.title.textContent, "Updated title");
  assert.equal(h.parts.close.attributes.get("aria-label"), "Close Updated title");
  assert.match(h.item.attributes.get("aria-label"), /Updated title.*Sleeping.*Playing audio/);
  assert.equal(h.parts.audio.attributes.get("aria-label"), "Mute tab");
  assert.equal(h.parts.audio.hidden, false);
  assert.equal(h.item.classes.has("is-sleeping"), true);
});

test("unrelated title updates do not recreate status or audio glyphs", () => {
  const h = fixture();
  h.update({ status: Status.describe({ busy: true, soundPlaying: true }) });
  const statusNode = h.parts.indicators.children[0];
  const audioNode = h.parts.audio.children[0];
  h.update({ label: "Loading a second title", status: Status.describe({ busy: true, soundPlaying: true }) });
  assert.equal(h.parts.indicators.children[0], statusNode);
  assert.equal(h.parts.audio.children[0], audioNode);
});

test("repeated identical content state does not mutate attributes or glyph children", () => {
  const h = fixture();
  const nodes = [h.item, ...Object.values(h.parts).filter(value => value && typeof value === "object")];
  const counts = () => nodes.map(node => [node.attributeWrites, node.replacements]);
  const before = counts();
  h.update({});
  assert.deepEqual(counts(), before);
});

test("a disappearing focused audio control returns focus to its stable tab row", () => {
  const h = fixture();
  h.update({ status: Status.describe({ soundPlaying: true }) });
  const document = { activeElement: h.parts.audio };
  h.parts.audio.ownerDocument = document;
  h.item.focus = options => {
    assert.equal(options.preventScroll, true);
    document.activeElement = h.item;
  };
  h.update({ status: Status.describe({}) });
  assert.equal(document.activeElement, h.item);
  assert.equal(h.item.tabIndex, 0);
});

test("stopped media and finished loading clear stale labels and hide controls", () => {
  const h = fixture();
  h.update({ status: Status.describe({ busy: true, muted: true }), peek: true, splitLabel: "Bottom pane" });
  h.update({ status: Status.describe({}), peek: false, splitLabel: "" });
  assert.equal(h.parts.audio.hidden, true);
  assert.equal(h.parts.audio.attributes.get("aria-label"), "");
  assert.equal(h.parts.indicators.hidden, true);
  assert.equal(h.parts.indicators.children.length, 0);
  assert.equal(h.parts.peek.hidden, true);
  assert.equal(h.parts.split.hidden, true);
  assert.equal(h.item.attributes.get("aria-label"), "Original title");
});

test("late failed favicon requests cannot replace a newer icon", () => {
  const h = fixture();
  h.update({ faviconURL: "https://example.org/old.ico" });
  const old = h.parts.favicon;
  h.update({ faviconURL: "https://example.org/new.ico" });
  const current = h.parts.favicon;
  old.listeners.get("error")();
  assert.equal(h.parts.favicon, current);
  current.listeners.get("error")();
  const fallback = h.parts.favicon;
  assert.notEqual(fallback, current);
  h.update({ label: "Changed title" });
  assert.equal(h.parts.favicon, fallback, "do not retry a failed icon on every title update");
});

test("audio activation reads live state after transitions without rebuilding its button", () => {
  let input = { mediaBlocked: true };
  const calls = [];
  const tab = { resumeDelayedMedia: () => calls.push("resume"), toggleMuteAudio: () => calls.push("mute") };
  const read = () => Status.describe(input);
  assert.equal(Content.activateAudio(tab, read), true);
  input = { soundPlaying: true };
  assert.equal(Content.activateAudio(tab, read), true);
  input = { muted: true };
  assert.equal(Content.activateAudio(tab, read), true);
  input = {};
  assert.equal(Content.activateAudio(tab, read), false);
  assert.deepEqual(calls, ["resume", "mute", "mute"]);
});
