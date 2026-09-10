"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../chrome/fluxion-memory-candidate-verification.js"), "utf8");

function fixture(options = {}) {
  const window = {}, candidates = [], consumed = [], embedded = [], queries = [], visits = new Map(), vectors = new Map();
  let recalculations = 0, drains = 0;
  const originalFind = async function (connection) {
    assert.equal(connection, db);
    if (options.lookupFailure) throw Error("candidate lookup failed");
    const results = candidates.splice(0);
    queries.push(results);
    return { results };
  };
  const originalEmbed = async function (texts) {
    embedded.push(...texts);
    if (options.embeddingFailure) throw Error("real embedding failed");
    return texts.map(() => [0, 1]);
  };
  const db = {};
  // Boundary simulation only: genuine packaged Gecko discovery/model execution
  // is covered by macOS CI, not by these verifier failure-path tests.
  const manager = { findAddsChunk: originalFind, embedder: { embedMany: originalEmbed },
    async updateVectorDB(connection, rows, removed) {
      assert.equal(connection, db); assert.equal(removed.length, 0);
      for (const row of rows) {
        consumed.push(row);
        const blocked = row.url.includes("list-privacy-fixture.invalid");
        const vector = blocked && !options.leakExcluded ? [1, 0] : (await this.embedder.embedMany([row.content]))[0];
        vectors.set(row.url, vector);
        if (blocked && options.starve) candidates.push(row);
      }
    } };
  const PlacesUtils = { history: { TRANSITIONS: { TYPED: 2 },
    async insert(page) {
      visits.set(page.url, page.visits);
      // Only this discovery stub creates candidate records. The shipped helper
      // must pass these exact records back to the native update API.
      candidates.push({ url: page.url, content: `Native candidate: ${page.title}`, opaque: {} });
    },
    async fetch(url) { return { visits: options.lostVisit ? [] : visits.get(url) }; },
  } };
  vm.runInNewContext(source, {
    window, Services: { env: { get: () => "1" } },
    PathUtils: { profileDir: options.wrongProfile ? "/private/tmp/user/profile" : "/private/tmp/fluxion-memory-privacy.unit/profile" },
    Cc: { "@mozilla.org/places/frecency-recalculator;1": { getService() {
      if (options.serviceFailure) throw Error("recalculator lookup failed");
      return { wrappedJSObject: { async recalculateSomeFrecencies() { recalculations++; } } };
    } } }, Ci: { nsIObserver: {} },
  });
  const args = { manager, connection: db, PlacesUtils, sentinel: [1, 0],
    async storedVector(url) {
      if (options.readFailure) throw Error("native vector read failed");
      return options.badVector && url.includes("list-privacy") ? [0, 1] : vectors.get(url);
    },
    async drain() { drains++; if (options.drainFailure) throw Error("native drain failed"); },
  };
  return { run: () => window.FluxionMemoryCandidateVerification.run(args), manager, originalFind, originalEmbed,
    candidates, consumed, embedded, queries, visits, mutations: () => recalculations + drains };
}
function restored(f) {
  assert.equal(f.manager.findAddsChunk, f.originalFind);
  assert.equal(f.manager.embedder.embedMany, f.originalEmbed);
}

test("complete native candidate verifier passes real discovered records through and observes the safe embed call", async () => {
  const f = fixture(); const result = await f.run();
  assert.equal(result.blockedEmbedInputs, 0);
  assert.equal(result.nextBatchNotStarved, true);
  assert.equal(result.placesRetained, true);
  assert.equal(f.embedded.length, 1);
  assert.match(f.embedded[0], /safe cold candidate/);
  assert.equal(f.queries.length, 3);
  assert.equal(f.queries[2].length, 0);
  assert.equal(f.consumed[0], f.queries[0][0]);
  assert.equal(f.consumed[1], f.queries[1][0]);
  assert.equal(f.visits.size, 2);
  restored(f);
});

test("candidate helper restores both native methods on lookup, embedding, read, and drain failures", async () => {
  for (const option of ["serviceFailure", "lookupFailure", "embeddingFailure", "readFailure", "drainFailure"]) {
    const f = fixture({ [option]: true });
    await assert.rejects(f.run(), /failed/, option);
    restored(f);
  }
});

test("excluded input leakage, derived blocked vectors, starvation and history loss fail rather than manufacture success", async () => {
  for (const [option, expected] of [["leakExcluded", /Excluded page content reached/], ["badVector", /derived native vector/],
    ["starve", /starve the next native batch/], ["lostVisit", /changed ordinary Places history/]]) {
    const f = fixture({ [option]: true });
    await assert.rejects(f.run(), expected, option);
    restored(f);
  }
});

test("wrong profile is rejected before hook installation, visits or native work", async () => {
  const f = fixture({ wrongProfile: true });
  await assert.rejects(f.run(), /isolated profile/);
  assert.equal(f.visits.size, 0); assert.equal(f.queries.length, 0); assert.equal(f.mutations(), 0);
  restored(f);
});
