const scope = { URL };
scope.globalThis = scope;
Services.scriptloader.loadSubScript("resource://fluxion/chrome/core/memory-policy.js", scope);
export const FluxionMemoryPolicy = scope.FluxionMemoryPolicy;
