const ORIGIN = "https://fluxion-ai.invalid";
const LEGACY_REALM = "Fluxion AI API key";
const realmFor = endpoint => `${LEGACY_REALM}: ${endpoint}`;
let queue = Promise.resolve();
let revision = 0;
const operations = new Set();

function invalidate() {
  revision++;
  for (const controller of operations) controller.abort("AI privacy settings changed");
}

// One module instance coordinates every browser window, including direct pref
// changes. A disable followed by re-enable must still invalidate old requests.
const observer = { observe: invalidate };
for (const pref of ["fluxion.ai.provider", "fluxion.ai.endpoint", "fluxion.ai.model", "fluxion.memory.excludedDomains"]) {
  Services.prefs.addObserver(pref, observer);
}

async function matches(realm) {
  return Services.logins.searchLoginsAsync({ origin: ORIGIN, httpRealm: realm });
}

async function writeSecret(endpoint, value) {
  if (!endpoint) return false;
  const realm = realmFor(endpoint);
  for (const login of await matches(realm)) await Services.logins.removeLoginAsync(login);
  const next = String(value || "").trim();
  if (!next) return false;
  const login = Cc["@mozilla.org/login-manager/loginInfo;1"].createInstance(Ci.nsILoginInfo);
  login.init(ORIGIN, null, realm, "Fluxion", next, "", "");
  await Services.logins.addLoginAsync(login);
  return true;
}

export const FluxionAIControl = Object.freeze({
  get revision() { return revision; },
  invalidate,
  track(controller) { operations.add(controller); },
  untrack(controller) { operations.delete(controller); },
  runControl(callback) {
    const task = queue.then(callback);
    queue = task.catch(() => {});
    return task;
  },
  // Must run inside runControl, with the previous canonical endpoint captured
  // before changing prefs. Unbound legacy keys are removed, never guessed onto
  // a newly selected server. Existing endpoint-scoped keys take precedence.
  async migrateLegacy(endpoint) {
    const old = await matches(LEGACY_REALM);
    if (old.length && endpoint && !(await matches(realmFor(endpoint))).length) {
      await writeSecret(endpoint, old[0].password);
    }
    for (const login of old) await Services.logins.removeLoginAsync(login);
  },
  async readSecret(endpoint) {
    if (!endpoint) return "";
    return (await matches(realmFor(endpoint)))[0]?.password || "";
  },
  async setSecret(endpoint, value) {
    invalidate();
    return writeSecret(endpoint, value);
  },
});
