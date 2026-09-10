"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Minimal tree DOM, rather than precomputed query responses: clone, selector
// traversal and removal change the actual text and heading evidence.
class Element {
  constructor(tag, attributes = {}, children = []) {
    this.tag = tag;
    this.attributes = attributes;
    this.children = [];
    for (const child of children) this.append(child);
  }
  append(child) {
    if (typeof child === "string") child = new Text(child);
    child.parent = this;
    this.children.push(child);
  }
  get textContent() { return this.children.map(child => child.textContent).join(""); }
  get isContentEditable() {
    const own = this.attributes.contenteditable?.toLowerCase();
    if (own === "false") return false;
    if (["", "true", "plaintext-only"].includes(own)) return true;
    return this.parent?.isContentEditable || false;
  }
  matches(selector) {
    return selector.split(",").some(part => {
      const rule = part.trim();
      if (rule === '[contenteditable]:not([contenteditable="false" i])') {
        return Object.hasOwn(this.attributes, "contenteditable") && this.attributes.contenteditable.toLowerCase() !== "false";
      }
      const attribute = rule.match(/^([a-z]+)\[([^=]+)="([^"]+)"(?: i)?\]$/);
      if (attribute) return this.tag === attribute[1] && this.attributes[attribute[2]]?.toLowerCase() === attribute[3].toLowerCase();
      return this.tag === rule;
    });
  }
  closest(selector) { return this.matches(selector) ? this : this.parent?.closest(selector) || null; }
  querySelectorAll(selector) {
    return this.children.flatMap(child => child instanceof Element
      ? [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)] : []);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  remove() { this.parent.children = this.parent.children.filter(child => child !== this); }
  cloneNode() { return new Element(this.tag, { ...this.attributes }, this.children.map(child => child.cloneNode(true))); }
}
class Text {
  constructor(value) { this.textContent = value; }
  cloneNode() { return new Text(this.textContent); }
}
const el = (tag, attributes, ...children) => new Element(tag, attributes, children);
function extract(body, options = {}) {
  const documentElement = el("html", {}, body);
  documentElement.lang = "en";
  const document = {
    documentElement, body, designMode: options.designMode || "off",
    documentURI: "https://example.org/editor", title: "Fixture",
    querySelector: selector => documentElement.querySelector(selector),
    createTextNode: value => new Text(value),
  };
  const context = vm.createContext({ JSWindowActorChild: class {} });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../actors/FluxionMemoryPageChild.sys.mjs"), "utf8")
    .replace("export class FluxionMemoryPageChild", "globalThis.Child = class FluxionMemoryPageChild"), context);
  const actor = new context.Child();
  Object.assign(actor, { document, contentWindow: { location: { protocol: "https:" } } });
  return actor.receiveMessage({ name: "FluxionMemory:Extract" });
}

test("rich-text and plaintext drafts never enter body or heading evidence", () => {
  for (const value of ["", "true", "TRUE", "plaintext-only", "PlainText-Only"]) {
    const body = el("body", {}, el("main", {},
      el("h1", {}, "Published heading"), el("p", {}, "Public article"),
      el("div", { contenteditable: value }, el("h2", {}, "Secret draft heading"), "Secret draft body",
        el("div", { contenteditable: "false" }, "Secret read-only editor island"))));
    const result = extract(body);
    assert.match(result.text, /Public article/);
    assert.doesNotMatch(JSON.stringify(result), /Secret/);
    assert.deepEqual([...result.headings], ["Published heading"]);
    assert.match(body.textContent, /Secret/, "extraction must not mutate the live page");
  }
});

test("editable root, editable ancestor and designMode yield no evidence", () => {
  assert.equal(extract(el("body", { contenteditable: "true" }, "Draft")), null);
  assert.equal(extract(el("body", {}, el("main", { contenteditable: "plaintext-only" }, "Draft"))), null);
  assert.equal(extract(el("body", { contenteditable: "true" }, el("main", { contenteditable: "false" }, "Draft island"))), null);
  assert.equal(extract(el("body", {}, "Draft"), { designMode: "ON" }), null);
});

test("non-editable content remains usable while original form and control stripping survives", () => {
  const result = extract(el("body", {}, el("main", {},
    el("div", { contenteditable: "FALSE" }, el("h2", {}, "Published section"), "Public text"),
    el("form", {}, el("h2", {}, "Secret form heading"), "Secret form"),
    el("textarea", {}, "Secret textarea"), el("input", { type: "password" }),
    el("script", {}, "Secret script"), el("button", {}, "Secret button"))));
  assert.match(result.text, /Public text/);
  assert.doesNotMatch(JSON.stringify(result), /Secret/);
  assert.deepEqual([...result.headings], ["Published section"]);
  assert.equal(result.hasPasswordField, true);
});
