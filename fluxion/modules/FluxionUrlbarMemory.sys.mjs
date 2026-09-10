const PROVIDER_NAME = "SemanticHistorySearch";
const MODERN_URI = "moz-src:///browser/components/urlbar/UrlbarProvidersManager.sys.mjs";
const LEGACY_URI = "resource:///modules/UrlbarProvidersManager.sys.mjs";

function incompatible(detail, cause) {
  return new Error(`Cannot isolate Browser Memory from native address-bar semantic search: ${detail}`, { cause });
}

function registries() {
  let module;
  try {
    module = ChromeUtils.importESModule(MODERN_URI);
  } catch (modernError) {
    try {
      module = ChromeUtils.importESModule(LEGACY_URI);
      if (!module.UrlbarProvidersManager) throw new Error("Legacy singleton export is missing");
    } catch (legacyError) {
      throw incompatible("URL-bar provider module is unavailable", new AggregateError([modernError, legacyError]));
    }
  }
  if (typeof module.ProvidersManager?.getInstanceForSap === "function") {
    return ["urlbar", "smartbar"].map(sap => ({ sap, manager: module.ProvidersManager.getInstanceForSap(sap) }));
  }
  if (module.UrlbarProvidersManager) return [{ sap: "legacy", manager: module.UrlbarProvidersManager }];
  throw incompatible("unsupported URL-bar provider registry exports");
}

function ensurePolicyBoundary() {
  try {
    const targets = registries();
    // Validate every registry before mutating any. Never disable the ordinary
    // Places provider or flip shared Gecko ML preferences to suppress results.
    for (const { sap, manager } of targets) {
      if (typeof manager?.getProvider !== "function" || typeof manager?.unregisterProvider !== "function") {
        throw incompatible(`${sap} registry lacks provider lookup or removal`);
      }
    }
    for (const { sap, manager } of targets) {
      const provider = manager.getProvider(PROVIDER_NAME);
      if (provider) {
        if (provider.name !== PROVIDER_NAME) throw incompatible(`${sap} returned an unexpected provider`);
        manager.unregisterProvider(provider);
      }
      if (manager.getProvider(PROVIDER_NAME)) throw incompatible(`${sap} retained the semantic provider after removal`);
    }
    return true;
  } catch (error) {
    if (error.message?.startsWith("Cannot isolate Browser Memory")) throw error;
    throw incompatible(error.message || "provider registry failed", error);
  }
}

// Firefox 155: browser/components/urlbar/UrlbarProvidersManager.sys.mjs.
// Call after profile startup, before queries. No semantic-manager getter or
// provider activation is invoked here; Fluxion's own filtered Memory UI stays.
export const FluxionUrlbarMemory = Object.freeze({ ensurePolicyBoundary });
