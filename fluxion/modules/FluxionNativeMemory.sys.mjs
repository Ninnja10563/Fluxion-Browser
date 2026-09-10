import { setTimeout, clearTimeout } from "resource://gre/modules/Timer.sys.mjs";
import { FluxionMemoryPolicy } from "resource://fluxion/modules/FluxionMemoryPolicy.sys.mjs";

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
  return FluxionMemoryPolicy.readPolicy(Services.prefs).valid && !pending() && Services.prefs.getBoolPref("fluxion.memory.enabled", false) &&
    Services.prefs.getStringPref("fluxion.memory.embeddingProvider", "gecko-local") !== "disabled";
}

function getManager() {
  if (mayIndex()) {
    try {
      const { FluxionUrlbarMemory } = ChromeUtils.importESModule("resource://fluxion/modules/FluxionUrlbarMemory.sys.mjs");
      FluxionUrlbarMemory.ensurePolicyBoundary();
    } catch (error) {
      Services.prefs.setBoolPref("browser.ml.enable", false);
      Services.prefs.setBoolPref("places.semanticHistory.featureGate", false);
      Services.prefs.clearUserPref("places.semanticHistory.initialized");
      throw error;
    }
  }
  if (!manager) {
    // A newly constructed disabled Gecko manager may remove an initialized
    // database even without removeOnStartup. Corrupt policy is not deletion
    // consent; only a genuine pending explicit purge may bypass this guard.
    if (!FluxionMemoryPolicy.readPolicy(Services.prefs).valid && !pending()) {
      throw new Error("Repair the exclusion policy before opening native Browser Memory.");
    }
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
    manager.updateVectorDB = function (connection, additions = [], deletions = []) {
      return runMutation(() => updateAllowedCandidates(this, update, connection, additions, deletions));
    };
  }
  return manager;
}

async function updateAllowedCandidates(native, update, connection, additions, deletions) {
  if (!Array.isArray(additions) || additions.length > 1000) throw new Error("Unsupported native Memory candidate batch");
  if (!additions.length) return update.call(native, connection, additions, deletions);
  const hashes = [...new Set(additions.map(row => row.url_hash).filter(value =>
    (typeof value === "number" && Number.isSafeInteger(value)) ||
    (typeof value === "string" && /^-?\d{1,20}$/.test(value))))];
  if (!hashes.length) return deletions.length ? update.call(native, connection, [], deletions) : undefined;
  const params = Object.fromEntries(hashes.map((value, index) => [`hash${index}`, value]));
  const rows = await connection.execute(`SELECT url_hash, url FROM places.moz_places
    WHERE url_hash IN (${hashes.map((_, index) => `:hash${index}`).join(",")})`, params);
  if (!mayIndex()) return;
  const urlsByHash = new Map();
  for (const row of rows) {
    const key = String(row.getResultByName("url_hash"));
    if (!urlsByHash.has(key)) urlsByHash.set(key, []);
    urlsByHash.get(key).push(row.getResultByName("url"));
  }
  let filter = FluxionMemoryPolicy.createPageFilter(
    FluxionMemoryPolicy.effectiveDomains(FluxionMemoryPolicy.readPolicy(Services.prefs)));
  const allowed = candidate => {
    const urls = urlsByHash.get(String(candidate.url_hash));
    // URL hashes are not unique: every matching real URL must be safe. Unknown
    // hashes cannot establish consent and never reach the native embedder.
    return urls?.length && urls.every(url => filter({ url }));
  };
  const blocked = hashes.filter(hash => urlsByHash.has(String(hash)) && !allowed({ url_hash: hash }));
  if (blocked.length) {
    const { PlacesUtils } = ChromeUtils.importESModule("resource://gre/modules/PlacesUtils.sys.mjs");
    const sentinel = new Array(native.getEmbeddingSize()).fill(0);
    sentinel[0] = 1;
    const vector = PlacesUtils.tensorToSQLBindable(sentinel);
    await connection.executeTransaction(async () => {
      for (const hash of blocked) {
        if (!mayIndex()) throw new Error("Memory policy changed during candidate exclusion");
        const mappings = await connection.executeCached(`INSERT INTO vec_history_mapping(url_hash) VALUES(:hash)
          ON CONFLICT(url_hash) DO UPDATE SET url_hash=:hash RETURNING rowid`, { hash });
        if (!mayIndex()) throw new Error("Memory policy changed during candidate exclusion");
        await connection.executeCached("INSERT OR REPLACE INTO vec_history(rowid,embedding) VALUES(:id,:vector)",
          { id: mappings[0].getResultByName("rowid"), vector });
        if (!mayIndex()) throw new Error("Memory policy changed during candidate exclusion");
      }
    });
  }
  if (!mayIndex()) return;
  filter = FluxionMemoryPolicy.createPageFilter(
    FluxionMemoryPolicy.effectiveDomains(FluxionMemoryPolicy.readPolicy(Services.prefs)));
  const safe = additions.filter(allowed);
  // Keep Gecko's candidate counts unchanged. Content-free mappings prevent
  // excluded candidates from starving subsequent batches without embedding them.
  if (safe.length || deletions.length) return update.call(native, connection, safe, deletions);
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

async function drainWrites() {
  await bounded(Promise.all([...activeWrites]));
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
  drainWrites,
  search,
  async recover() { if (pending()) await purge(); },
  async vectorCount() {
    const connection = await storageConnection();
    const rows = await connection.execute("SELECT count(*) AS count FROM vec_history");
    return Number(rows[0]?.getResultByName("count") || 0);
  },
});
