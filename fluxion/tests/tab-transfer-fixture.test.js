"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

test("transfer fixture serves fixed live-state page and counts real document loads only", async t => {
  const { startFixture } = await import("../scripts/tab-transfer-fixture.mjs");
  const { server, origin } = await startFixture();
  t.after(() => { server.close(); server.closeAllConnections(); });
  const before = await (await fetch(`${origin}/state`)).json();
  assert.deepEqual(before, { loads: 0, requests: [], omittedRequests: 0 });
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
  assert.deepEqual(await (await fetch(`${origin}/state`)).json(), { loads: 1,
    requests: [{ sequence: 1, path: "/transfer", destination: "missing", mode: "cors" }], omittedRequests: 0 });
});

test("document request evidence distinguishes navigation and image loads without retaining private request fields", async t => {
  const { startFixture } = await import("../scripts/tab-transfer-fixture.mjs");
  const logged = [], { server, origin } = await startFixture(0, { onDocumentRequest: record => logged.push(record) });
  t.after(() => { server.close(); server.closeAllConnections(); });
  const request = (pathname, headers) => new Promise((resolve, reject) => {
    http.get(`${origin}${pathname}`, { headers }, response => { response.resume(); response.on("end", resolve); }).on("error", reject);
  });
  await request("/transfer?step=1", { "sec-fetch-dest": "document", "sec-fetch-mode": "navigate",
    Authorization: "Bearer secret-token", Cookie: "private-cookie=secret", Referer: "https://private.invalid/secret" });
  await request("/transfer?secret=private-query", { "sec-fetch-dest": "image", "sec-fetch-mode": "no-cors" });
  await request("/transfer", { "sec-fetch-dest": "private-header-value", "sec-fetch-mode": "private-mode-value" });
  const state = await (await fetch(`${origin}/state`)).json();
  assert.deepEqual(state, { loads: 3, omittedRequests: 0, requests: [
    { sequence: 1, path: "/transfer?step=1", destination: "document", mode: "navigate" },
    { sequence: 2, path: "/transfer?[redacted]", destination: "image", mode: "no-cors" },
    { sequence: 3, path: "/transfer", destination: "other", mode: "other" },
  ] });
  assert.deepEqual(logged, state.requests);
  assert.doesNotMatch(JSON.stringify([logged, state]), /secret|private/);
  logged[0].path = "mutated callback copy";
  assert.equal((await (await fetch(`${origin}/state`)).json()).requests[0].path, "/transfer?step=1");
});

test("request diagnostics are bounded while the exact document load counter remains authoritative", async t => {
  const { startFixture, MAX_REQUEST_RECORDS } = await import("../scripts/tab-transfer-fixture.mjs");
  const logged = [], { server, origin } = await startFixture(0, { onDocumentRequest: record => logged.push(record) });
  t.after(() => { server.close(); server.closeAllConnections(); });
  for (let index = 0; index < MAX_REQUEST_RECORDS + 3; index++) await (await fetch(`${origin}/transfer`)).text();
  const state = await (await fetch(`${origin}/state`)).json();
  assert.equal(state.loads, MAX_REQUEST_RECORDS + 3);
  assert.equal(state.requests.length, MAX_REQUEST_RECORDS);
  assert.equal(state.omittedRequests, 3);
  assert.deepEqual(state.requests.map(record => record.sequence), Array.from({ length: MAX_REQUEST_RECORDS }, (_, index) => index + 1));
  assert.deepEqual(logged, state.requests);
});

test("opt-in response evidence correlates reused connections and completed responses without changing load counts", async t => {
  const { startFixture, MAX_LIFECYCLE_RECORDS } = await import("../scripts/tab-transfer-fixture.mjs");
  const logged = [], { server, origin } = await startFixture(0, {
    diagnostics: true, onResponseLifecycle: record => logged.push(record),
  });
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  t.after(() => { agent.destroy(); server.close(); server.closeAllConnections(); });
  const request = () => new Promise((resolve, reject) => {
    http.get(`${origin}/transfer?secret=private`, { agent, headers: { Cookie: "secret-cookie" } }, response => {
      assert.equal(response.statusCode, 200);
      response.resume(); response.on("end", resolve);
    }).on("error", reject);
  });
  await request(); await request();
  const initial = await (await fetch(`${origin}/state`)).json();
  assert.equal(initial.loads, 2);
  for (const sequence of [1, 2]) {
    const events = initial.lifecycle.records.filter(record => record.sequence === sequence);
    assert.deepEqual(events.map(record => record.event), ["request", "finish", "close"]);
    assert.equal(events[1].responseFinished, true);
    assert.equal(events[1].requestComplete, true);
    assert.equal(events[1].status, 200);
    assert.ok(events.every(record => record.connection === 1), "native HTTP connection reuse remains observable");
  }
  assert.doesNotMatch(JSON.stringify(initial.lifecycle), /secret|private|cookie/);
  assert.deepEqual(logged, initial.lifecycle.records);
  logged[0].event = "mutated callback copy";
  for (let index = 0; index < MAX_LIFECYCLE_RECORDS / 3; index++) await request();
  const after = await (await fetch(`${origin}/state`)).json();
  assert.equal(after.loads, 2 + MAX_LIFECYCLE_RECORDS / 3);
  assert.equal(after.lifecycle.records.length, MAX_LIFECYCLE_RECORDS);
  assert.equal(after.lifecycle.omitted, 6);
  assert.equal(after.lifecycle.records[0].event, "request");
});
