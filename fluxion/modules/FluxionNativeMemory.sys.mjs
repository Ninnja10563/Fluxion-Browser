import { setTimeout, clearTimeout } from "resource://gre/modules/Timer.sys.mjs";

const PENDING_PREF = "fluxion.memory.nativePendingRemoval";
const activeWrites = new Set();
let manager;
let purgePromise;
let controlPromise = Promise.resolve();
let quarantined = Services.prefs.getBoolPref(PENDING_PREF, false);

function pending() {
  return quarantined || Services.prefs.getBoolPref(PENDING_PREF, false);
}

function mayIndex() {
  return !pending() && Services.prefs.getBoolPref("fluxion.memory.enabled", false) &&
    Services.prefs.getStringPref("fluxion.memory.embeddingProvider", "gecko-local") !== "disabled";
}

function getManager() {
  if (!manager) {
    const { getPlacesSemanticHistoryManager } = ChromeUtils.importESModule(
      "resource://gre/modules/PlacesSemanticHistoryManager.sys.mjs"
    );
    manager = getPlacesSemanticHistoryManager({ rowLimit: 10000, samplingAttrib: "frecency",
      changeThresholdCount: 1, distanceThreshold: 0.68 });
    const update = manager.updateVectorDB;
    if (typeof update !== "function" || typeof manager.semanticDB?.getConnection !== "function") {
      manager = null;
      throw new Error("This Gecko runtime does not support safe native Memory cleanup");
    }
    // Install before Fluxion opens the manager connection and arms native
    // background indexing. Track the whole embed→transaction operation, not
    // just its SQLite write, so deleting cannot race a late model response.
    manager.updateVectorDB = function (...args) {
      return runMutation(() => update.apply(this, args));
    };
  }
  return manager;
}

function runMutation(operation) {
  if (!mayIndex()) return Promise.resolve();
  const task = Promise.resolve().then(() => mayIndex() ? operation() : undefined);
  activeWrites.add(task);
  const release = () => activeWrites.delete(task);
  task.then(release, release);
  return task;
}

function runControl(operation) {
  const result = controlPromise.then(operation);
  // Serialize whole user actions across windows, not only their SQL purge.
  // A failed deletion stays quarantined, but a subsequent retry can execute.
  controlPromise = result.catch(() => {});
  return result;
}

async function bounded(task) {
  let timer;
  try {
    return await Promise.race([task, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("Native Memory cleanup is still waiting for background work; try clearing again.")), 15000);
    })]);
  } finally { clearTimeout(timer); }
}

async function storageConnection() {
  const native = getManager();
  // Gecko awaits its startup database removal/schema lifecycle BEFORE its
  // feature-gate check. The null result when disabled is not an empty DB.
  await native.getConnection();
  // Storage-only access does not reopen the ML gate or schedule model work.
  return native.semanticDB.getConnection();
}

function purge() {
  if (purgePromise) return purgePromise;
  quarantined = true;
  purgePromise = (async () => {
    Services.prefs.setBoolPref(PENDING_PREF, true);
    Services.prefs.setBoolPref("browser.ml.enable", false);
    Services.prefs.setBoolPref("places.semanticHistory.featureGate", false);
    Services.prefs.setBoolPref("places.semanticHistory.removeOnStartup", true);
    Services.prefs.savePrefFile(null);
    const native = getManager();
    // A timeout fails closed. The tracked operation stays in activeWrites;
    // a later retry must drain it too, rather than forgetting late writes.
    await bounded(Promise.allSettled([...activeWrites]));
    const connection = await bounded(storageConnection());
    await connection.executeTransaction(async () => {
      await connection.execute("DELETE FROM vec_history");
      await connection.execute("DELETE FROM vec_history_mapping");
    });
    native.enoughEntries = false;
    Services.prefs.setBoolPref(PENDING_PREF, false);
    Services.prefs.savePrefFile(null);
    quarantined = false;
  })().catch(error => {
    // Do not let an unsuccessful save or deletion clear the durable barrier.
    try { Services.prefs.setBoolPref(PENDING_PREF, true); Services.prefs.savePrefFile(null); }
    catch (persistenceError) { Cu.reportError(persistenceError); }
    throw error;
  }).finally(() => { purgePromise = null; });
  return purgePromise;
}

export const FluxionNativeMemory = Object.freeze({
  getManager,
  storageConnection,
  pending,
  purge,
  runControl,
  runMutation,
  async recover() { if (pending()) await purge(); },
  async vectorCount() {
    const connection = await storageConnection();
    const rows = await connection.execute("SELECT count(*) AS count FROM vec_history");
    return Number(rows[0]?.getResultByName("count") || 0);
  },
});
