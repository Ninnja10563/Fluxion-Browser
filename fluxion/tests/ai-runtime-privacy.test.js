"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const read = file => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const settle = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
const config = endpoint => ({ provider: "openai-compatible", endpoint, model: "fixture" });
const page = url => ({ url, title: "Fixture", text: "A sufficiently long readable article about botany and the natural world for this test." });
const browser = (url, extraction = Promise.resolve(page(url))) => ({
  currentURI: { spec: url },
  browsingContext: { currentWindowGlobal: { getActor: () => ({ sendQuery: () => extraction }) } },
});

function fixture({ legacy = false } = {}) {
  const prefs = new Map([
    ["fluxion.ai.provider", "openai-compatible"],
    ["fluxion.ai.endpoint", "https://provider-a.invalid/v1"],
    ["fluxion.ai.model", "fixture"],
  ]);
  const observers = new Map(), requests = [], logins = [];
  const state = { beforeLogin: null, beforeFetch: null, confirm: () => true };
  if (legacy) logins.push({ origin: "https://fluxion-ai.invalid", httpRealm: "Fluxion AI API key", password: "legacy-a-key" });
  const Services = {
    prefs: {
      getStringPref: (key, fallback) => prefs.get(key) ?? fallback,
      setStringPref(key, value) {
        prefs.set(key, value);
        for (const observer of observers.get(key) || []) observer.observe(null, "nsPref:changed", key);
      },
      addObserver(key, observer) { observers.set(key, [...(observers.get(key) || []), observer]); },
      prefHasUserValue: key => prefs.has(key), clearUserPref: key => prefs.delete(key), savePrefFile() {},
    },
    logins: {
      async searchLoginsAsync(query) {
        if (state.beforeLogin) await state.beforeLogin;
        return logins.filter(login => login.origin === query.origin && login.httpRealm === query.httpRealm);
      },
      async removeLoginAsync(login) { logins.splice(logins.indexOf(login), 1); },
      async addLoginAsync(login) { logins.push(login); },
    },
    prompt: { confirm: () => state.confirm() }, env: { get: () => "" },
  };
  const Cc = { "@mozilla.org/login-manager/loginInfo;1": { createInstance: () => ({
    init(origin, ignored, httpRealm, username, password) { Object.assign(this, { origin, httpRealm, username, password }); },
  }) } };
  const moduleContext = vm.createContext({ Services, Cc, Ci: { nsILoginInfo: {} } });
  // Evaluate the entire production ESM; only its export declaration is adapted
  // for Node 20's VM harness, not the credential/control implementation.
  vm.runInContext(read("modules/FluxionAIControl.sys.mjs").replace("export const FluxionAIControl", "globalThis.FluxionAIControl"), moduleContext);
  function createWindow(isPrivate = false) {
    const window = {
      AbortController, setTimeout, clearTimeout,
      async fetch(url, options) {
        requests.push({ url, options });
        if (state.beforeFetch) await state.beforeFetch;
        return { ok: true, json: async () => ({ data: [], choices: [{ message: { content: "Grounded answer" } }] }) };
      },
    };
    const context = vm.createContext({ window, Services, URL, Cc, Ci: {}, Cu: { reportError() {} },
      ChromeUtils: { importESModule: uri => uri.includes("FluxionAIControl")
        ? { FluxionAIControl: moduleContext.FluxionAIControl }
        : { PrivateBrowsingUtils: { isWindowPrivate: () => isPrivate } } },
    });
    for (const file of ["core/ai-providers.js", "core/memory-policy.js", "core/memory-content.js", "fluxion-ai.js"]) {
      vm.runInContext(read(`chrome/${file}`), context);
    }
    return window.FluxionAI;
  }
  return { api: createWindow(), createWindow, prefs, Services, requests, logins, state };
}

test("legacy key binds to old endpoint, never to a newly selected endpoint or path", async () => {
  const f = fixture({ legacy: true });
  await f.api.configure(config("https://provider-b.invalid/v1"));
  await f.api.testConnection();
  assert.equal(f.requests[0].options.headers.Authorization, undefined);
  assert.equal(f.logins.some(login => login.httpRealm === "Fluxion AI API key"), false);
  await f.api.configure(config("https://provider-a.invalid/v1"));
  await f.api.testConnection();
  assert.equal(f.requests[1].options.headers.Authorization, "Bearer legacy-a-key");
  await f.api.configure(config("https://provider-a.invalid/other"));
  await f.api.testConnection();
  assert.equal(f.requests[2].options.headers.Authorization, undefined);
});

test("cross-window configuration serializes migration and preserves distinct endpoint keys", async () => {
  const f = fixture({ legacy: true }), other = f.createWindow();
  await Promise.all([
    f.api.configure({ ...config("https://provider-b.invalid/v1"), secret: "b-key" }),
    other.configure(config("https://provider-a.invalid/v1")),
  ]);
  await other.testConnection();
  assert.equal(f.requests[0].options.headers.Authorization, "Bearer legacy-a-key");
  await f.api.configure(config("https://provider-b.invalid/v1"));
  await f.api.testConnection();
  assert.equal(f.requests[1].options.headers.Authorization, "Bearer b-key");
  await f.api.setSecret("");
  assert.equal((await f.api.status()).hasCredential, false);
  await f.api.configure(config("https://provider-a.invalid/v1"));
  assert.equal((await f.api.status()).hasCredential, true);
});

test("unbound legacy key is not assigned to the first newly configured server", async () => {
  const f = fixture({ legacy: true });
  f.Services.prefs.setStringPref("fluxion.ai.provider", "disabled");
  f.Services.prefs.setStringPref("fluxion.ai.endpoint", "");
  await f.api.configure(config("https://new-provider.invalid/v1"));
  await f.api.testConnection();
  assert.equal(f.requests[0].options.headers.Authorization, undefined);
  assert.equal(f.logins.length, 0);
});

test("disable and re-enable in another window cancel preparation before any page transmission", async () => {
  const f = fixture(), other = f.createWindow(), extraction = deferred();
  const pending = f.api.askCurrentPage("Summarise this", browser("https://example.org/article", extraction.promise));
  const rejected = assert.rejects(pending, /cancelled/);
  await other.configure({ provider: "disabled" });
  await other.configure(config("https://provider-a.invalid/v1"));
  extraction.resolve(page("https://example.org/article"));
  await rejected;
  assert.equal(f.requests.length, 0);
});

test("excluding an already extracted comparison page cancels the entire pending comparison", async () => {
  const f = fixture(), extraction = deferred();
  const pending = f.api.comparePages("Compare these", [browser("https://first.example/article"), browser("https://second.example/article", extraction.promise)]);
  const rejected = assert.rejects(pending, /cancelled/);
  await settle();
  f.Services.prefs.setStringPref("fluxion.memory.excludedDomains", '["first.example"]');
  extraction.resolve(page("https://second.example/article"));
  await rejected;
  assert.equal(f.requests.length, 0);
});

test("settings changes during credential lookup cannot dispatch a stale request", async () => {
  const f = fixture(), credentials = deferred();
  f.state.beforeLogin = credentials.promise;
  const pending = f.api.askCurrentPage("Summarise this", browser("https://example.org/article"));
  const rejected = assert.rejects(pending, /cancelled/);
  await settle();
  f.Services.prefs.setStringPref("fluxion.ai.provider", "disabled");
  credentials.resolve();
  await rejected;
  assert.equal(f.requests.length, 0);
});

test("in-flight fetch aborts on privacy edits and its late response is not displayed", async () => {
  const f = fixture(), response = deferred();
  f.state.beforeFetch = response.promise;
  const pending = f.api.askCurrentPage("Summarise this", browser("https://example.org/article"));
  const rejected = assert.rejects(pending, /cancelled/);
  await settle();
  assert.equal(f.requests.length, 1);
  f.Services.prefs.setStringPref("fluxion.memory.excludedDomains", '["example.org"]');
  assert.equal(f.requests[0].options.signal.aborted, true);
  response.resolve();
  await rejected;
});

test("queued disable aborts active fetch immediately even while credential store is blocked", async () => {
  const f = fixture(), response = deferred(), credentials = deferred();
  f.state.beforeFetch = response.promise;
  const pending = f.api.askCurrentPage("Summarise this", browser("https://example.org/article"));
  const rejected = assert.rejects(pending, /cancelled/);
  await settle();
  f.state.beforeLogin = credentials.promise;
  const status = f.api.status();
  await settle();
  const disable = f.api.configure({ provider: "disabled" });
  assert.equal(f.requests[0].options.signal.aborted, true);
  credentials.resolve();
  response.resolve();
  await Promise.all([status, disable, rejected]);
});

test("key action rejects endpoint changed ahead of its queued operation", async () => {
  const f = fixture({ legacy: true });
  const change = f.api.configure({ ...config("https://provider-b.invalid/v1"), secret: "b-key" });
  const clear = assert.rejects(f.api.setSecret("", { expectedEndpoint: "https://provider-a.invalid/v1" }), /endpoint changed/);
  await Promise.all([change, clear]);
  await f.api.testConnection();
  assert.equal(f.requests[0].options.headers.Authorization, "Bearer b-key");
});

test("consent-time changes, private windows and excluded pages never transmit", async () => {
  const f = fixture();
  f.state.confirm = () => { f.Services.prefs.setStringPref("fluxion.ai.provider", "disabled"); return true; };
  await assert.rejects(f.api.askCurrentPage("Summarise this", browser("https://example.org/article")), /cancelled/);
  await f.api.configure(config("https://provider-a.invalid/v1"));
  await assert.rejects(f.createWindow(true).askCurrentPage("Summarise this", browser("https://example.org/article")), /private/);
  f.Services.prefs.setStringPref("fluxion.memory.excludedDomains", '["example.org"]');
  await assert.rejects(f.api.askCurrentPage("Summarise this", browser("https://example.org/article")), /excluded/);
  assert.equal(f.requests.length, 0);
});

test("unchanged allowed request retains real provider dispatch and grounded source", async () => {
  const f = fixture();
  const answer = await f.api.askCurrentPage("Summarise this", browser("https://example.org/article"));
  assert.equal(answer.text, "Grounded answer");
  assert.equal(answer.source.url, "https://example.org/article");
  assert.equal(f.requests.length, 1);
  assert.match(f.requests[0].options.body, /botany/);
});
