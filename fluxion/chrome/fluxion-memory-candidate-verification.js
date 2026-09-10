/* global Services, PathUtils, Cc, Ci */
(function exposeNativeCandidateVerification(window) {
  "use strict";
  if (Services.env.get("FLUXION_MEMORY_PRIVACY_TEST") !== "1") return;
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  async function run({ manager, connection, PlacesUtils, storedVector, sentinel, drain }) {
    assert(/\/fluxion-memory-privacy\.[^/]+\/profile\/?$/.test(PathUtils.profileDir), "Cold candidate check requires its isolated profile");
    const fixtures = [
      { url: "https://list-privacy-fixture.invalid/cold-visit", title: "Fluxion excluded cold candidate boundary" },
      { url: "https://cold-safe-fixture.invalid/article", title: "Fluxion safe cold candidate boundary" },
    ];
    const originalFind = manager.findAddsChunk;
    const originalEmbed = manager.embedder.embedMany;
    assert(typeof originalFind === "function" && typeof originalEmbed === "function", "Native candidate APIs are unavailable");
    const seen = new Set(), inputs = [];
    manager.findAddsChunk = async function (...args) {
      const batch = await originalFind.apply(this, args);
      for (const item of batch.results) for (const fixture of fixtures) {
        if (item.content.includes(fixture.title)) seen.add(fixture.title);
      }
      return batch;
    };
    manager.embedder.embedMany = function (texts, ...args) {
      inputs.push(...texts);
      return originalEmbed.call(this, texts, ...args);
    };
    try {
      const recalculator = Cc["@mozilla.org/places/frecency-recalculator;1"]
        .getService(Ci.nsIObserver).wrappedJSObject;
      for (const fixture of fixtures) {
        await PlacesUtils.history.insert({ ...fixture, visits: [{ date: new Date(), transition: PlacesUtils.history.TRANSITIONS.TYPED }] });
        await recalculator.recalculateSomeFrecencies({ chunkSize: -1 });
        const batch = await manager.findAddsChunk(connection);
        // Background Gecko work may already have consumed this same real
        // batch. The observer above records both paths; never fake candidates.
        if (batch.results.length) await manager.updateVectorDB(connection, batch.results, []);
        await drain();
      }
      assert(seen.size === fixtures.length, "Native discovery did not observe both cold candidates");
      assert(!inputs.some(text => text.includes(fixtures[0].title)), "Excluded page content reached the native embedder");
      assert(inputs.some(text => text.includes(fixtures[1].title)), "Safe neighboring content never reached the real embedder");
      const blocked = await storedVector(fixtures[0].url);
      assert(blocked.every((value, i) => value === sentinel[i]), "Cold excluded candidate retained a derived native vector");
      const safe = await storedVector(fixtures[1].url);
      assert(safe.every(Number.isFinite) && safe.some((value, i) => value !== sentinel[i]), "Safe cold candidate did not retain a real model vector");
      const remaining = await manager.findAddsChunk(connection);
      assert(!remaining.results.some(row => row.content.includes(fixtures[0].title)), "Excluded candidate would starve the next native batch");
      for (const fixture of fixtures) assert((await PlacesUtils.history.fetch(fixture.url, { includeVisits: true }))?.visits?.length > 0,
        "Cold candidate filtering changed ordinary Places history");
      return { label: "cold-native-candidates-filtered-before-real-embedding", blockedEmbedInputs: 0,
        safeModelInputObserved: true, blockedSentinelRetained: true, nextBatchNotStarved: true, placesRetained: true };
    } finally {
      manager.findAddsChunk = originalFind;
      manager.embedder.embedMany = originalEmbed;
    }
  }
  window.FluxionMemoryCandidateVerification = Object.freeze({ run });
})(window);
