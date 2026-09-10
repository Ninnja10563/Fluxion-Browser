/* global Services, ChromeUtils, PathUtils, Ci, Cu */
(function verifyDefaultBookmarks(window) {
  "use strict";
  const phase = Services.env.get("FLUXION_DEFAULT_BOOKMARKS_TEST");
  if (!["seed", "restore"].includes(phase)) return;
  const prefix = "fluxion.defaults.verification";
  if (Services.prefs.getBoolPref(`${prefix}.${phase}.claimed`, false)) return;
  Services.prefs.setBoolPref(`${prefix}.${phase}.claimed`, true);
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const delay = ms => new Promise(resolve => window.setTimeout(resolve, ms));
  const record = item => ({ guid: item.guid, parentGuid: item.parentGuid, index: item.index,
    title: item.title, type: item.type, url: item.url?.href || "" });

  async function run() {
    assert(/\/fluxion-defaults-check\.[^/]+\/profile\/?$/.test(PathUtils.profileDir),
      "Default bookmark verification requires its isolated profile");
    assert(!Services.prefs.getStringPref("fluxion.defaults.error", ""), "Default bookmark resource registration failed");
    const { PlacesUtils } = ChromeUtils.importESModule("resource://gre/modules/PlacesUtils.sys.mjs");
    const { PlacesBrowserStartup } = ChromeUtils.importESModule("moz-src:///browser/components/places/PlacesBrowserStartup.sys.mjs");
    const deadline = Date.now() + 20000;
    while (!PlacesBrowserStartup._placesBrowserInitComplete) {
      assert(Date.now() < deadline, "Places default bookmark import did not finish");
      await delay(50);
    }
    const tree = await PlacesUtils.promiseBookmarksTree(PlacesUtils.bookmarks.rootGuid);
    const nodes = [];
    const walk = node => { nodes.push(node); for (const child of node.children || []) walk(child); };
    walk(tree);
    if (phase === "seed") {
      const own = nodes.find(node => node.title === "Fluxion" && node.children?.length);
      assert(own, "Fresh profile did not import the packaged Fluxion bookmark folder");
      assert(!nodes.some(node => node.title === "Mozilla Firefox" || node.title === "Customize Firefox"),
        "Fresh profile still imported inherited Firefox default bookmarks");
      const ownURLs = own.children.map(node => node.uri || node.url?.href || node.url || "");
      assert(ownURLs.includes("https://github.com/Ninnja10563/Fluxion-Browser/releases"),
        "Fluxion defaults omitted the real release page");
      const saved = [];
      for (const node of [own, ...own.children]) saved.push(record(await PlacesUtils.bookmarks.fetch(node.guid)));
      // These intentionally resemble inherited defaults: an upgrade must never
      // rename or delete user data merely because its title mentions Firefox.
      const userFolder = await PlacesUtils.bookmarks.insert({ parentGuid: PlacesUtils.bookmarks.toolbarGuid,
        type: PlacesUtils.bookmarks.TYPE_FOLDER, title: "Mozilla Firefox" });
      const userPage = await PlacesUtils.bookmarks.insert({ parentGuid: userFolder.guid,
        title: "Customize Firefox", url: "https://user-bookmarks-fixture.invalid/Private%20notes?reference=kept" });
      const nested = await PlacesUtils.bookmarks.insert({ parentGuid: userFolder.guid,
        type: PlacesUtils.bookmarks.TYPE_FOLDER, title: "Personal notes" });
      const nestedPage = await PlacesUtils.bookmarks.insert({ parentGuid: nested.guid,
        title: "My saved page", url: "https://user-bookmarks-fixture.invalid/saved#position" });
      saved.push(...[userFolder, userPage, nested, nestedPage].map(record));
      Services.prefs.setStringPref(`${prefix}.saved`, JSON.stringify(saved));
    } else {
      const saved = JSON.parse(Services.prefs.getStringPref(`${prefix}.saved`, "[]"));
      assert(saved.length >= 6, "Existing-profile bookmark fixture is missing");
      for (const before of saved) {
        const actual = await PlacesUtils.bookmarks.fetch(before.guid);
        assert(actual && JSON.stringify(record(actual)) === JSON.stringify(before),
          `Existing bookmark identity or content changed: ${before.guid}`);
      }
    }
    Services.prefs.setStringPref(`${prefix}.${phase}.health`, "native-defaults-and-user-bookmarks-verified");
  }
  run().catch(error => {
    Services.prefs.setStringPref(`${prefix}.${phase}.error`, `${error?.message || error}\n${error?.stack || ""}`);
    Cu.reportError(error);
  }).finally(async () => {
    Services.prefs.savePrefFile(null);
    await delay(100);
    Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit);
  });
})(window);
