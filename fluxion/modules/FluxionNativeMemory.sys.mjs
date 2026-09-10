import { setTimeout, clearTimeout } from "resource://gre/modules/Timer.sys.mjs";

const PENDING_PREF = "fluxion.memory.nativePendingRemoval";
const activeWrites = new Set();
let manager;
let storagePromise;
let purgePromise;
let controlPromise = Promise.resolve();
let searchTask;
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

async function search(query) {
  if (!mayIndex()) return { state: "disabled", results: [] };
  // Gecko has no per-inference cancellation. A timed-out query keeps its slot
  // until the underlying operation settles, preventing a backlog of models.
  if (searchTask) return { state: "busy", results: [] };
  const task = Promise.resolve().then(async () => {
    if (!mayIndex()) return { state: "disabled", results: [] };
    const native = getManager();
    const connection = await native.getConnection();
    if (!connection) return { state: "lexical", results: [] };
    if (!mayIndex()) return { state: "disabled", results: [] };
    if (!(await native.hasSufficientEntriesForSearching())) return { state: "building", results: [] };
    if (!mayIndex()) return { state: "disabled", results: [] };
    const result = await native.infer({ searchString: query });
    return mayIndex() ? { state: "ready", results: result.results || [] } : { state: "disabled", results: [] };
  });
  searchTask = task;
  const release = () => { if (searchTask === task) searchTask = null; };
  task.then(release, release);
  let timer;
  try {
    return await Promise.race([task, new Promise(resolve => {
      timer = setTimeout(() => resolve({ state: "timed-out", results: [] }), 1200);
    })]);
  } finally { clearTimeout(timer); }
}

async function bounded(task) {
  let timer;
  try {
    return await Promise.race([task, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("Native Memory cleanup is still waiting for background work; try clearing again.")), 15000);
    })]);
  } finally { clearTimeout(timer); }
}

function storageConnection() {
  if (!storagePromise) {
    storagePromise = (async () => {
      const native = getManager();
      // Gecko awaits its startup database removal/schema lifecycle BEFORE its
      // feature-gate check. The null result when disabled is not an empty DB.
      const active = await native.getConnection();
      // Gecko's storage-only getter does not single-flight opening/schema
      // initialization. Share the complete operation across Fluxion windows;
      // concurrent opens can otherwise close each other's live connection.
      return active || await native.semanticDB.getConnection();
    })().catch(error => {
      storagePromise = null;
      throw error;
    });
  }
  return storagePromise;
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
  search,
  async recover() { if (pending()) await purge(); },
  async vectorCount() {
    const connection = await storageConnection();
    const rows = await connection.execute("SELECT count(*) AS count FROM vec_history");
    return Number(rows[0]?.getResultByName("count") || 0);
  },
});
