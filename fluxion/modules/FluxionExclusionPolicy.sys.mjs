import { FluxionMemoryPolicy } from "resource://fluxion/modules/FluxionMemoryPolicy.sys.mjs";
import { FluxionNativeMemory } from "resource://fluxion/modules/FluxionNativeMemory.sys.mjs";

let generation = 0;
let observed;
const listeners = new Set();
function token() {
  try {
    const type = Services.prefs.getPrefType(FluxionMemoryPolicy.POLICY_PREF);
    if (type === 0) return `legacy:${Services.prefs.getStringPref(FluxionMemoryPolicy.LEGACY_PREF, "[]")}`;
    return type === 32 ? `canonical:${Services.prefs.getStringPref(FluxionMemoryPolicy.POLICY_PREF)}` : `invalid-type:${type}`;
  } catch (_) { return "unreadable-policy"; }
}
function reconcile(force = false) {
  const next = token();
  if (force || next !== observed) {
    observed = next;
    generation++;
    for (const listener of listeners) {
      try { listener(); } catch (error) { Cu.reportError(error); }
    }
  }
}
for (const key of [FluxionMemoryPolicy.POLICY_PREF, FluxionMemoryPolicy.LEGACY_PREF]) {
  Services.prefs.addObserver(key, { observe: () => reconcile(true) });
}
function snapshot() {
  reconcile();
  return { ...FluxionMemoryPolicy.readPolicy(Services.prefs), revision: String(generation) };
}
function conflict() {
  const error = new Error("Exclusion policy changed in another window. Reload before saving.");
  error.code = "POLICY_CONFLICT";
  return error;
}

export const FluxionExclusionPolicy = Object.freeze({
  snapshot,
  subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  async update(transform, expectedRevision, cleanup, { reset = false } = {}) {
    return FluxionNativeMemory.runControl(async () => {
      const before = snapshot();
      if (expectedRevision !== undefined && expectedRevision !== before.revision) throw conflict();
      if (!before.valid && !reset) throw new Error(`Exclusion policy needs recovery: ${before.error}`);
      const base = reset ? { version: 1, directDomains: [], lists: [] } : before;
      const next = FluxionMemoryPolicy.validatePolicy(transform(base));
      // One authoritative preference write: readers never see a category edit
      // without its direct domains. Keep the legacy value as migration record.
      Services.prefs.setStringPref(FluxionMemoryPolicy.POLICY_PREF, JSON.stringify(next));
      reconcile();
      Services.prefs.savePrefFile(null);
      const committed = snapshot();
      await cleanup(FluxionMemoryPolicy.effectiveDomains({ ...next, valid: true }));
      return committed;
    });
  },
});
