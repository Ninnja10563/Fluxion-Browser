const scope = {};
scope.globalThis = scope;
Services.scriptloader.loadSubScript("resource://fluxion/chrome/core/memory-search.js", scope);
export const FluxionMemorySearch = scope.FluxionMemorySearch;
