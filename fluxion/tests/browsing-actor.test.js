"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function fixture() {
  const origin = "http://127.0.0.1:49123";
  const scheduled = [];
  const fields = { username: {}, password: {}, file: {
    type: "file", files: [],
    mozSetFileArray(files) { this.files = files; },
    dispatchEvent() {},
  } };
  const forms = Object.fromEntries(["login", "upload", "logout"].map(name => [name, {
    action: `${origin}/${name}`, method: "post", enctype: "multipart/form-data",
    elements: { namedItem: id => fields[id] },
    submitted: false, requestSubmit() { this.submitted = true; },
  }]));
  const contentWindow = {
    location: { origin, pathname: "/" },
    Event: class { constructor(type) { this.type = type; } },
    setTimeout: callback => scheduled.push(callback),
  };
  const document = {
    documentURI: `${origin}/`, title: "Fixture", body: { textContent: "x".repeat(5000) },
    documentElement: { dataset: { fixtureScript: "executed" } }, cookie: "",
    querySelector: selector => forms[selector.replace(/^#/, "").replace(/-form$/, "")],
  };
  const context = vm.createContext({ JSWindowActorChild: class {} });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../actors/FluxionBrowsingVerificationChild.sys.mjs"), "utf8")
    .replace("export class FluxionBrowsingVerificationChild", "globalThis.Child = class FluxionBrowsingVerificationChild"), context);
  const actor = new context.Child();
  Object.assign(actor, { document, contentWindow });
  return { origin, actor, document, contentWindow, forms, fields, scheduled,
    send: (name, data = {}) => actor.receiveMessage({ name: `FluxionBrowsing:${name}`, data: { origin, ...data } }) };
}

test("browsing actor requires the exact loopback origin and bounds page evidence", () => {
  const h = fixture();
  const page = h.send("Read");
  assert.equal(page.text.length, 4000);
  assert.equal(page.script, "executed");
  assert.throws(() => h.send("Read", { origin: "http://127.0.0.1:49124" }), /origin mismatch/);
  h.contentWindow.location.origin = "https://example.org";
  assert.throws(() => h.send("Read"), /origin mismatch/);
});

test("login uses fixed fixture credentials and only submits the same-origin POST form", () => {
  const h = fixture();
  h.send("Login");
  assert.equal(h.fields.username.value, "fluxion");
  assert.equal(h.fields.password.value, "fixture-only");
  assert.equal(h.forms.login.submitted, false, "reply precedes navigation");
  h.scheduled[0]();
  assert.equal(h.forms.login.submitted, true);
  h.forms.login.action = "https://example.org/login";
  assert.throws(() => h.send("Login"), /Unexpected login/);
});

test("upload accepts only the fixture file through the native input setter", () => {
  const h = fixture();
  assert.throws(() => h.send("Upload", { file: { name: "arbitrary.txt" } }), /Unexpected upload/);
  const file = { name: "fluxion-download.txt", size: 84 };
  h.send("Upload", { file });
  assert.equal(h.fields.file.files[0], file);
  h.scheduled[0]();
  assert.equal(h.forms.upload.submitted, true);
  h.forms.upload.enctype = "text/plain";
  assert.throws(() => h.send("Upload", { file }), /Unexpected upload/);
});

test("logout requires the account document and unknown commands cannot execute", () => {
  const h = fixture();
  assert.throws(() => h.send("Logout"), /Unexpected fixture form document/);
  assert.throws(() => h.send("Evaluate", { script: "anything" }), /Unsupported/);
  h.contentWindow.location.pathname = "/account";
  h.send("Logout");
  h.scheduled[0]();
  assert.equal(h.forms.logout.submitted, true);
});
