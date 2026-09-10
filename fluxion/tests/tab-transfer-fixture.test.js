"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

test("transfer fixture serves fixed live-state page and counts real document loads only", async t => {
  const { startFixture } = await import("../scripts/tab-transfer-fixture.mjs");
  const { server, origin } = await startFixture();
  t.after(() => { server.close(); server.closeAllConnections(); });
  const before = await (await fetch(`${origin}/state`)).json();
  assert.deepEqual(before, { loads: 0 });
  const response = await fetch(`${origin}/transfer`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const html = await response.text();
  assert.match(html, /crypto.randomUUID\(\)/);
  assert.match(html, /window.transferFixtureCounter\+\+/);
  assert.match(html, /textarea id="draft"/);
  assert.equal((await fetch(`${origin}/transfer`, { method: "POST" })).status, 405);
  assert.equal((await fetch(`${origin}/not-a-fixture`)).status, 404);
  const badHost = await new Promise((resolve, reject) => {
    const request = http.get(`${origin}/transfer`, { headers: { Host: "other.invalid" } }, response => {
      response.resume(); resolve(response.statusCode);
    }); request.on("error", reject);
  });
  assert.equal(badHost, 400);
  assert.deepEqual(await (await fetch(`${origin}/state`)).json(), { loads: 1 });
});
