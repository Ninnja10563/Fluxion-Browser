"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../modules/FluxionUrlbarMemory.sys.mjs"), "utf8")
  .replace("export const FluxionUrlbarMemory =", "globalThis.FluxionUrlbarMemory =");
const modernURI = "moz-src:///browser/components/urlbar/UrlbarProvidersManager.sys.mjs";
const legacyURI = "resource:///modules/UrlbarProvidersManager.sys.mjs";
function registry({ absent = false, refuses = false } = {}) {
  const semantic = { name: "SemanticHistorySearch", get semanticManager() { throw Error("Must not initialize ML"); },
    isActive() { throw Error("Must not activate provider"); }, startQuery() { throw Error("Must not run provider"); } };
  const ordinary = [{ name: "Places" }, { name: "InputHistory" }, { name: "SemanticHistorySearchOther" }, { name: "SearchSuggestions" }];
  const providers = [...ordinary, ...(absent ? [] : [semantic])];
  const notifications = new Set(providers), removed = [];
  return { providers, ordinary, semantic, notifications, removed,
    getProvider(name) { return providers.find(item => item.name === name); },
    unregisterProvider(provider) {
      assert.equal(provider, semantic, "Gecko removal requires the exact provider object");
      removed.push(provider);
      if (!refuses) { providers.splice(providers.indexOf(provider), 1); notifications.delete(provider); }
    } };
}
function load(importer) {
  const imports = [];
  const context = vm.createContext({ ChromeUtils: { importESModule(uri) { imports.push(uri); return importer(uri); } } });
  vm.runInContext(source, context);
  assert.equal(imports.length, 0, "Importing Fluxion wrapper must not initialize any native module");
  return { api: context.FluxionUrlbarMemory, imports };
}

test("pinned registries remove only semantic provider objects and retain ordinary providers and subscriptions", () => {
  const urlbar = registry(), smartbar = registry(), saps = [];
  const h = load(uri => {
    assert.equal(uri, modernURI);
    return { ProvidersManager: { getInstanceForSap(sap) { saps.push(sap); return { urlbar, smartbar }[sap]; } } };
  });
  assert.equal(h.api.ensurePolicyBoundary(), true);
  assert.deepEqual(saps, ["urlbar", "smartbar"]);
  for (const current of [urlbar, smartbar]) {
    assert.deepEqual(current.providers, current.ordinary);
    assert.deepEqual([...current.notifications], current.ordinary);
    assert.deepEqual(current.removed, [current.semantic]);
  }
  assert.equal(h.api.ensurePolicyBoundary(), true);
  assert.equal(urlbar.removed.length, 1); assert.equal(smartbar.removed.length, 1);
  urlbar.providers.push(urlbar.semantic);
  h.api.ensurePolicyBoundary(); assert.equal(urlbar.removed.length, 2, "recheck must not trust cached removal after re-registration");
  assert.deepEqual(h.imports, [modernURI, modernURI, modernURI]);
});

test("supported legacy singleton works on modern export or verified ESR resource path", () => {
  for (const fallback of [false, true]) {
    const manager = registry();
    const h = load(uri => {
      if (fallback && uri === modernURI) throw Error("URI unavailable on ESR");
      assert.equal(uri, fallback ? legacyURI : modernURI);
      return { UrlbarProvidersManager: manager };
    });
    assert.equal(h.api.ensurePolicyBoundary(), true);
    assert.deepEqual(manager.removed, [manager.semantic]);
    assert.deepEqual(h.imports, fallback ? [modernURI, legacyURI] : [modernURI]);
  }
});

test("missing semantic provider is safe but unsupported or incomplete registries fail explicitly", () => {
  const absent = registry({ absent: true });
  assert.equal(load(() => ({ UrlbarProvidersManager: absent })).api.ensurePolicyBoundary(), true);
  assert.equal(absent.removed.length, 0);
  for (const exports of [{}, { UrlbarProvidersManager: {} }]) {
    assert.throws(() => load(() => exports).api.ensurePolicyBoundary(), /Cannot isolate Browser Memory/);
  }
  const first = registry();
  const invalidSecond = load(() => ({ ProvidersManager: { getInstanceForSap: sap => sap === "urlbar" ? first : {} } }));
  assert.throws(() => invalidSecond.api.ensurePolicyBoundary(), /smartbar registry lacks/);
  assert.equal(first.removed.length, 0, "validate all registry APIs before removal");
});

test("refused removal, wrong lookup result, thrown initialization and import failure cannot report success", () => {
  const refuses = registry({ refuses: true });
  assert.throws(() => load(() => ({ UrlbarProvidersManager: refuses })).api.ensurePolicyBoundary(), /retained the semantic provider/);
  const wrong = { getProvider: () => ({ name: "Places" }), unregisterProvider() { assert.fail("Must not remove Places"); } };
  assert.throws(() => load(() => ({ UrlbarProvidersManager: wrong })).api.ensurePolicyBoundary(), /unexpected provider/);
  const broken = load(() => ({ ProvidersManager: { getInstanceForSap() { throw Error("initialization failed"); } } }));
  assert.throws(() => broken.api.ensurePolicyBoundary(), /initialization failed/);
  assert.equal(broken.imports.length, 1, "runtime failure must not fall back to a different registry");
  const missing = load(() => { throw Error("module unavailable"); });
  assert.throws(() => missing.api.ensurePolicyBoundary(), /provider module is unavailable/);
  assert.deepEqual(missing.imports, [modernURI, legacyURI]);
  const unknownFallback = load(uri => { if (uri === modernURI) throw Error("missing"); return { ProvidersManager: {} }; });
  assert.throws(() => unknownFallback.api.ensurePolicyBoundary(), /provider module is unavailable/);
});
