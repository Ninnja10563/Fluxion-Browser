/* global Services, SessionStore, Cu */
(function verifyAIPrivacy(window) {
  "use strict";
  if (Services.env.get("FLUXION_AI_PRIVACY_TEST") !== "1") return;
  const prefix = "fluxion.aiPrivacy";
  if (Services.prefs.getBoolPref(`${prefix}.claimed`, false)) return;
  Services.prefs.setBoolPref(`${prefix}.claimed`, true);
  const origin = Services.env.get("FLUXION_AI_PRIVACY_ORIGIN");
  const report = { credentials: [], races: [] };
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const write = (name, value) => { Services.prefs.setStringPref(`${prefix}.${name}`, value); Services.prefs.savePrefFile(null); };
  const pause = ms => new Promise(resolve => window.setTimeout(resolve, ms));
  async function run() {
    assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(origin), "AI fixture must use the isolated loopback server");
    await SessionStore.promiseAllWindowsRestored;
    const ai = window.FluxionAI;
    const config = endpoint => ({ provider: "openai-compatible", endpoint: `${origin}/${endpoint}/v1`, model: "fluxion-fixture" });
    const state = async () => {
      const response = await window.fetch(`${origin}/state`, { credentials: "omit", cache: "no-store" });
      assert(response.ok, "Could not read fixture evidence");
      return response.json();
    };
    const key = "fluxion-native-fixture-synthetic-only";
    await ai.configure({ ...config("a"), secret: key });
    assert((await ai.testConnection()).ok, "Endpoint A connection failed");
    await ai.configure(config("b"));
    assert(!(await ai.status()).hasCredential, "Endpoint B inherited A's credential");
    assert((await ai.testConnection()).ok, "Endpoint B connection failed");
    await ai.configure(config("a"));
    assert((await ai.status()).hasCredential, "Returning to A lost its endpoint credential");
    assert((await ai.testConnection()).ok, "Returning endpoint A connection failed");
    for (const endpoint of ["a", "b"]) {
      const records = await Services.logins.searchLoginsAsync({ origin: "https://fluxion-ai.invalid",
        httpRealm: `Fluxion AI API key: ${config(endpoint).endpoint}` });
      assert(endpoint === "a" ? records.length === 1 && records[0].password === key : records.length === 0,
        `Native LoginManager credential scope failed for ${endpoint}`);
      report.credentials.push({ endpoint, records: records.length });
    }
    const models = (await state()).models;
    assert(JSON.stringify(models) === JSON.stringify([
      { path: "/a/v1/models", headerPresent: true, expectedCredential: true },
      { path: "/b/v1/models", headerPresent: false, expectedCredential: false },
      { path: "/a/v1/models", headerPresent: true, expectedCredential: true },
    ]), `Provider request credential isolation failed: ${JSON.stringify(models)}`);
    report.models = models;
    const tab = window.gBrowser.addTrustedTab(`${origin}/article`, { skipAnimation: true });
    window.FluxionUI.setTabWorkspace(tab, window.FluxionUI.currentWorkspace());
    window.gBrowser.selectedTab = tab;
    const deadline = Date.now() + 20000;
    while ((tab.hasAttribute("busy") || tab.linkedBrowser.contentTitle !== "Fluxion local AI fixture") && Date.now() < deadline) await pause(50);
    assert(tab.linkedBrowser.contentTitle === "Fluxion local AI fixture" && !tab.hasAttribute("busy"), "Real fixture article failed to load");
    const answer = await ai.askCurrentPage("What does the article explain?", tab.linkedBrowser);
    assert(answer.text && answer.source?.url === `${origin}/article`, "Baseline page extraction and provider answer failed");
    const baseline = (await state()).posts;
    assert(baseline.length === 1 && baseline[0].hasPageContext && baseline[0].headerPresent && baseline[0].expectedCredential,
      "Server did not receive baseline real extracted page context");
    assert(baseline[0].hasEditableDraft === false,
      "Real page extraction transmitted editable draft body or heading evidence");
    report.baseline = baseline;
    for (const mode of ["disable", "exclude"]) {
      await ai.configure(config("a"));
      const result = ai.askCurrentPage("What does the article explain?", tab.linkedBrowser)
        .then(() => ({ rejected: false }), error => ({ rejected: true, reason: String(error.message) }));
      // Same turn, while the genuine actor extraction roundtrip is pending.
      const mutation = mode === "disable" ? ai.configure({ provider: "disabled" }) :
        Services.prefs.setStringPref("fluxion.memory.excludedDomains", JSON.stringify(["127.0.0.1"]));
      const outcome = await result;
      await mutation;
      assert(outcome.rejected && /cancel|excluded|disabled|configure/i.test(outcome.reason), `${mode} did not revoke the pending page request`);
      await pause(150);
      const posts = (await state()).posts.length;
      assert(posts === 1, `${mode} leaked a page POST after revocation`);
      report.races.push({ mode, rejected: outcome.rejected, additionalPosts: posts - baseline.length });
      write("report", JSON.stringify(report));
    }
    await ai.configure({ provider: "disabled" });
    write("health", "endpoint-credentials-and-sharing-revocation-verified");
  }
  run().catch(error => { write("error", `${error?.message || error}\n${error?.stack || ""}`); Cu.reportError(error); });
})(window);
