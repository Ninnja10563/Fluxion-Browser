"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Minimal tree DOM, rather than precomputed query responses. Native selectors
// use the backing tree separately from instrumented extraction DOM reads.
class Element {
  constructor(tag, attributes = {}, children = []) {
    this.tag = tag;
    this.attributes = attributes;
    this.children = [];
    this.reads = { visited: 0, firstChild: 0 };
    for (const child of children) this.append(child);
  }
  append(child) {
    if (typeof child === "string") child = new Text(child);
    if (this.children.length) this.children[this.children.length - 1].nextSibling = child;
    child.parent = this;
    child.nextSibling = null;
    this.children.push(child);
  }
  get textContent() { return this.children.map(child => child.textContent).join(""); }
  get nodeType() { return 1; }
  get localName() { this.reads.visited++; return this.tag; }
  getAttribute(name) { return this.attributes[name] ?? null; }
  get firstChild() { this.reads.firstChild++; return this.children[0] || null; }
  get content() { return this.attributes.content || ""; }
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
    const pending = [...this.children].reverse(), matches = [];
    while (pending.length) {
      const node = pending.pop();
      if (!(node instanceof Element)) continue;
      if (node.matches(selector)) matches.push(node);
      for (let i = node.children.length - 1; i >= 0; i--) pending.push(node.children[i]);
    }
    return matches;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  remove() { this.parent.children = this.parent.children.filter(child => child !== this); }
  cloneNode() { throw new Error("Extraction must not clone the DOM"); }
}
class Text {
  constructor(value) { this.value = value; this.reads = []; }
  get nodeType() { return 3; }
  get textContent() { throw new Error("Extraction must not read complete text node contents"); }
  substringData(offset, count) { this.reads.push({ offset, count }); return this.value.slice(offset, offset + count); }
  cloneNode() { throw new Error("Extraction must not clone text"); }
}
const el = (tag, attributes, ...children) => new Element(tag, attributes, children);
function extract(body, options = {}) {
  const documentElement = el("html", {}, el("head", {}, options.title || el("title", {}, "Fixture"),
    ...(options.description ? [el("meta", { name: "description", content: options.description })] : [])), body);
  documentElement.lang = "en";
  const document = {
    documentElement, body, designMode: options.designMode || "off",
    documentURI: "https://example.org/editor",
    get title() { throw new Error("Extraction must bound the title DOM read"); },
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
    assert.equal(body.children[0].children.length, 3, "extraction must not mutate the live page");
  }
});

test("normal paragraph, inline and heading boundaries remain readable", () => {
  const result = extract(el("body", {}, el("main", {},
    el("h1", {}, "Plants ", el("em", {}, "and light")),
    el("p", {}, "Photo", el("span", {}, "synthesis")),
    el("p", {}, "Stores energy"), el("div", {}, "Next block"))));
  assert.equal(result.text.replace(/\s+/g, " ").trim(), "Plants and light Photosynthesis Stores energy Next block");
  assert.deepEqual([...result.headings], ["Plants and light"]);
  assert.equal(result.title, "Fixture");
});

test("a huge text node uses one bounded native substring read and stops before following content", () => {
  const huge = new Text("x".repeat(1000000));
  const tail = el("p", {}, "Unvisited tail");
  const result = extract(el("body", {}, el("main", {}, huge, tail)));
  assert.equal(result.text.length, 24000);
  assert.equal(huge.reads.length, 1);
  assert.deepEqual(huge.reads[0], { offset: 0, count: 23999 });
  assert.equal(tail.reads.visited, 0);
});

test("wide trees stop at the node budget without walking later siblings", () => {
  const nodes = Array.from({ length: 10000 }, () => el("span", {}));
  const main = new Element("main", {}, nodes);
  const result = extract(el("body", {}, main));
  assert.equal(main.reads.visited + nodes.reduce((sum, node) => sum + node.reads.visited, 0), 4096);
  assert.equal(nodes[4095].reads.visited, 0);
  assert.equal(nodes.at(-1).reads.firstChild, 0);
  assert.ok(result.text.length <= 24000);
});

test("deep trees have bounded iterative traversal without recursion or reads past budget", () => {
  const main = el("main", {}), nodes = [main];
  let parent = main;
  for (let i = 0; i < 12000; i++) {
    const node = el("span", {});
    nodes.push(node);
    parent.append(node);
    parent = node;
  }
  parent.append("Unvisited deep secret");
  const result = extract(el("body", {}, main));
  assert.equal(nodes.reduce((sum, node) => sum + node.reads.visited, 0), 4096);
  assert.equal(nodes[4096].reads.firstChild, 0);
  assert.doesNotMatch(result.text, /secret/);
});

test("excluded wide/deep subtrees are pruned at their roots without spending traversal budget", () => {
  const hiddenChildren = Array.from({ length: 6000 }, () => el("span", {}, "Secret"));
  const form = new Element("form", {}, hiddenChildren);
  const editor = el("div", { contenteditable: "PlainText-Only" }, el("h2", {}, "Secret heading"));
  Object.defineProperty(form, "firstChild", { get() { throw new Error("Walk entered form"); } });
  Object.defineProperty(editor, "firstChild", { get() { throw new Error("Walk entered editor"); } });
  const result = extract(el("body", {}, el("main", {}, form, editor, el("p", {}, "Public text after skipped drafts"))));
  assert.match(result.text, /Public text after skipped drafts/);
  assert.doesNotMatch(JSON.stringify(result), /Secret/);
  assert.equal(hiddenChildren.reduce((sum, node) => sum + node.reads.visited, 0), 0);
});

test("heading count, heading text, title and description have independent hard bounds", () => {
  const headingNodes = Array.from({ length: 40 }, () => el("h2", {}, "h".repeat(500)));
  const titleText = new Text("t".repeat(100000));
  const result = extract(el("body", {}, new Element("main", {}, headingNodes)), {
    title: el("title", {}, titleText), description: "d".repeat(100000),
  });
  assert.equal(result.headings.length, 24);
  assert.ok(result.headings.every(heading => heading.length === 240));
  assert.equal(result.title.length, 300);
  assert.deepEqual(titleText.reads, [{ offset: 0, count: 300 }]);
  assert.equal(result.description.length, 1000);
});

test("editable root, editable ancestor and designMode yield no evidence", () => {
  assert.equal(extract(el("body", { contenteditable: "true" }, "Draft")), null);
  assert.equal(extract(el("body", {}, el("main", { contenteditable: "plaintext-only" }, "Draft"))), null);
  assert.equal(extract(el("body", { contenteditable: "true" }, el("main", { contenteditable: "false" }, "Draft island"))), null);
  assert.equal(extract(el("body", {}, "Draft"), { designMode: "ON" }), null);
});

test("choosing main/article inside excluded ancestors cannot bypass subtree privacy rules", () => {
  for (const tag of ["form", "nav", "footer", "button", "noscript"]) {
    for (const root of ["main", "article"]) {
      const source = el(root, {}, el("h1", {}, "Secret heading"), "Secret body");
      assert.equal(extract(el("body", {}, el(tag, {}, el("div", {}, source)))), null);
      assert.equal(source.reads.visited, 0, "excluded source must be rejected before reading evidence");
    }
  }
});

test("XHTML CDATA retains readable evidence with the same bounded text reads and exclusions", () => {
  class CDATA extends Text { get nodeType() { return 4; } }
  const heading = new CDATA("XHTML heading");
  const text = new CDATA("Readable XHTML article");
  const secret = new CDATA("Secret CDATA draft");
  const result = extract(el("body", {}, el("main", {}, el("h1", {}, heading),
    el("p", {}, text), el("form", {}, secret))));
  assert.deepEqual([...result.headings], ["XHTML heading"]);
  assert.match(result.text, /Readable XHTML article/);
  assert.doesNotMatch(result.text, /Secret/);
  assert.equal(secret.reads.length, 0);

  const huge = new CDATA("c".repeat(1000000)), tail = el("p", {}, "Unvisited tail");
  const bounded = extract(el("body", {}, el("main", {}, huge, tail)));
  assert.equal(bounded.text.length, 24000);
  assert.deepEqual(huge.reads, [{ offset: 0, count: 23999 }]);
  assert.equal(tail.reads.visited, 0);
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
