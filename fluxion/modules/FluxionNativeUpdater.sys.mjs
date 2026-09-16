// Main-process chrome only. No page actor exposes this module or its commands.
let bridge;
let initialization;
function native() {
  if (bridge) return bridge;
  if (Services.appinfo.OS !== "Darwin") throw new Error("Native updates require macOS");
  const { ctypes } = ChromeUtils.importESModule("resource://gre/modules/ctypes.sys.mjs");
  const resources = Services.dirsvc.get("GreD", Ci.nsIFile);
  const contents = resources.parent;
  if (resources.leafName !== "Resources" || contents.leafName !== "Contents") throw new Error("Unsupported application layout");
  const path = contents.clone(); path.append("Frameworks"); path.append("libFluxionUpdater.dylib");
  if (!path.exists() || !path.isFile()) throw new Error("This build has no native updater");
  // Keep the library loaded for the process lifetime: Sparkle owns asynchronous
  // Objective-C blocks that may outlive an individual browser window.
  const library = ctypes.open(path.path);
  const start = library.declare("FluxionUpdaterStart", ctypes.default_abi, ctypes.int, ctypes.char.ptr);
  const command = library.declare("FluxionUpdaterCommand", ctypes.default_abi, ctypes.int, ctypes.char.ptr);
  const copy = library.declare("FluxionUpdaterCopyState", ctypes.default_abi, ctypes.char.ptr);
  const free = library.declare("FluxionUpdaterFree", ctypes.default_abi, ctypes.void_t, ctypes.char.ptr);
  bridge = { library, start, command, copy, free };
  bridge.start(Services.dirsvc.get("ProfD", Ci.nsIFile).path);
  return bridge;
}
function snapshot() {
  const api = native(), pointer = api.copy();
  if (pointer.isNull()) throw new Error("Native updater has no status");
  try {
    const text = pointer.readString();
    if (text.length > 16384) throw new Error("Native updater status exceeded its bound");
    const value = JSON.parse(text);
    if (!value || typeof value.state !== "string") throw new Error("Invalid native updater state");
    const state = ({ "awaiting-quit": "retry", cancelled: "canceled", installed: "current", unavailable: "unsupported" })[value.state] || value.state;
    const progress = value.state === "downloading" && Number.isSafeInteger(value.received) && Number.isSafeInteger(value.total) && value.total > 0
      ? value.received / value.total : value.state === "extracting" && Number.isFinite(value.extraction) ? value.extraction : null;
    return { ...value, state, detail: String(value.message || ""), progress };
  } finally { api.free(pointer); }
}
export const FluxionNativeUpdater = Object.freeze({
  prepare() {
    if (!initialization) initialization = Promise.resolve().then(() => {
      const api = native();
      // A second instance or unsupported launch may have gone away since the
      // last check. The native bridge revalidates the current host each time.
      api.start(Services.dirsvc.get("ProfD", Ci.nsIFile).path);
      return snapshot();
    }).then(state => ({
      canInstall: state.available === true, detail: state.detail || "",
    })).catch(() => ({ canInstall: false, detail: "Automatic installation is unavailable for this build. Download the DMG manually." }))
      .finally(() => { initialization = null; });
    return initialization;
  },
  command(value) {
    if (!value || !["install", "cancel", "retry", "dismiss"].includes(value.action)) throw new Error("Invalid updater command");
    const json = JSON.stringify(value);
    if (json.length > 1024 || native().command(json) !== 0) throw new Error("Native updater refused the action");
  },
  getState: snapshot,
});
