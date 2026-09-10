"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

async function fixture(t, options) {
  const module = await import("../scripts/browsing-fixture.mjs");
  const server = await module.start(options);
  t.after(() => server.close());
  return { ...module, ...server };
}

test("loopback fixture serves deterministic attachment bytes and real HTML form contracts", async t => {
  const server = await fixture(t);
  assert.match(server.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
  const page = await fetch(server.origin);
  const html = await page.text();
  assert.match(html, /id="download-link"/);
  assert.match(html, /id="upload-form"[^>]*enctype="multipart\/form-data"/);
  assert.match(html, /id="login-form"[^>]*method="post"/);
  assert.match(html, /dataset.fixtureScript="executed"/);
  assert.match(page.headers.get("content-security-policy"), /script-src 'nonce-fluxion-fixture'/);
  const download = await fetch(`${server.origin}/download`);
  assert.equal(download.headers.get("content-disposition"), `attachment; filename="${server.DOWNLOAD_FILENAME}"`);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), server.DOWNLOAD_BYTES);
  assert.equal((await (await fetch(`${server.origin}/state`)).json()).downloads, 1);
});

test("downloaded bytes survive multipart upload and mismatched bytes never pass", async t => {
  const server = await fixture(t);
  const bytes = await (await fetch(`${server.origin}/download`)).arrayBuffer();
  const form = new FormData();
  form.set("file", new Blob([bytes]), server.DOWNLOAD_FILENAME);
  const response = await fetch(`${server.origin}/upload`, { method: "POST", body: form });
  assert.equal(response.status, 200);
  assert.match(await response.text(), /<title>Fluxion upload complete<\/title>/);
  const state = await (await fetch(`${server.origin}/state`)).json();
  assert.deepEqual(state.upload, {
    verified: true, filename: server.DOWNLOAD_FILENAME,
    sha256: server.DOWNLOAD_SHA256, bytes: server.DOWNLOAD_BYTES.length,
  });
  const bad = new FormData();
  bad.set("file", new Blob(["different file"]), server.DOWNLOAD_FILENAME);
  assert.equal((await fetch(`${server.origin}/upload`, { method: "POST", body: bad })).status, 422);
  assert.equal((await (await fetch(`${server.origin}/state`)).json()).uploads, 1);
});

test("paced download exposes progress before delivering the same final file bytes", async t => {
  const server = await fixture(t, { slowDurationMs: 200 });
  const response = await fetch(`${server.origin}/download-slow`);
  const reader = response.body.getReader();
  const first = await reader.read();
  assert.equal(first.done, false);
  assert.ok(first.value.byteLength > 0 && first.value.byteLength < server.DOWNLOAD_BYTES.length);
  const chunks = [first.value];
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    chunks.push(next.value);
  }
  assert.deepEqual(Buffer.concat(chunks), server.DOWNLOAD_BYTES);
  assert.equal((await (await fetch(`${server.origin}/state`)).json()).slowDownloads, 1);
});

test("an interrupted download can resume with exact Range bytes and stable entity identity", async t => {
  const server = await fixture(t, { slowDurationMs: 200 });
  const response = await fetch(`${server.origin}/download-slow`);
  const reader = response.body.getReader();
  const { value: initial } = await reader.read();
  await reader.cancel();
  const resumed = await fetch(`${server.origin}/download-slow`, {
    headers: { Range: `bytes=${initial.byteLength}-`, "If-Range": response.headers.get("etag") },
  });
  assert.equal(resumed.status, 206);
  assert.equal(resumed.headers.get("content-range"), `bytes ${initial.byteLength}-${server.DOWNLOAD_BYTES.length - 1}/${server.DOWNLOAD_BYTES.length}`);
  assert.deepEqual(Buffer.concat([initial, Buffer.from(await resumed.arrayBuffer())]), server.DOWNLOAD_BYTES);
  assert.equal((await (await fetch(`${server.origin}/state`)).json()).rangeDownloads, 1);
  const unsatisfiable = await fetch(`${server.origin}/download`, { headers: { Range: "bytes=99999-" } });
  assert.equal(unsatisfiable.status, 416);
  assert.equal(unsatisfiable.headers.get("content-range"), `bytes */${server.DOWNLOAD_BYTES.length}`);
  const changedEntity = await fetch(`${server.origin}/download`, { headers: { Range: "bytes=1-", "If-Range": '"old-entity"' } });
  assert.equal(changedEntity.status, 200);
  assert.deepEqual(Buffer.from(await changedEntity.arrayBuffer()), server.DOWNLOAD_BYTES);
});

test("login requires correct form values and a returned cookie across the redirect", async t => {
  const server = await fixture(t);
  assert.equal((await fetch(`${server.origin}/account`)).status, 401);
  const rejected = await fetch(`${server.origin}/login`, {
    method: "POST", body: new URLSearchParams({ username: "fluxion", password: "wrong" }), redirect: "manual",
  });
  assert.equal(rejected.status, 401);
  assert.equal(rejected.headers.get("set-cookie"), null);
  const login = await fetch(`${server.origin}/login`, {
    method: "POST", body: new URLSearchParams(server.LOGIN), redirect: "manual",
  });
  assert.equal(login.status, 303);
  assert.equal(login.headers.get("location"), "/account");
  const cookie = login.headers.get("set-cookie");
  assert.match(cookie, /; HttpOnly; SameSite=Strict$/);
  const cookieHeader = cookie.split(";")[0];
  const account = await fetch(`${server.origin}/account`, { headers: { Cookie: cookieHeader } });
  assert.equal(account.status, 200);
  assert.match(await account.text(), /data-authenticated="true"/);
  const loggedOut = await fetch(`${server.origin}/logout`, { method: "POST", headers: { Cookie: cookieHeader }, redirect: "manual" });
  assert.equal(loggedOut.status, 303);
  assert.match(loggedOut.headers.get("set-cookie"), /Max-Age=0/);
  assert.equal((await fetch(`${server.origin}/account`, { headers: { Cookie: cookieHeader } })).status, 401);
});

test("malformed multipart, excessive body and cross-origin submissions are rejected", async t => {
  const server = await fixture(t);
  const malformed = await fetch(`${server.origin}/upload`, {
    method: "POST", headers: { "Content-Type": "multipart/form-data; boundary=missing" }, body: "not multipart",
  });
  assert.equal(malformed.status, 400);
  const oversized = await fetch(`${server.origin}/upload`, {
    method: "POST", body: Buffer.alloc(server.MAX_BODY_BYTES + 1),
  });
  assert.equal(oversized.status, 413);
  const crossOrigin = await fetch(`${server.origin}/login`, {
    method: "POST", headers: { Origin: "https://unrelated.example" }, body: new URLSearchParams(server.LOGIN),
  });
  assert.equal(crossOrigin.status, 403);
  assert.equal((await (await fetch(`${server.origin}/state`)).json()).uploads, 0);
});

test("chunked uploads enforce the body limit without a Content-Length header", async t => {
  const server = await fixture(t);
  const result = await new Promise((resolve, reject) => {
    const request = http.request(`${server.origin}/upload`, { method: "POST" }, response => {
      response.resume();
      response.on("end", () => resolve(response.statusCode));
    });
    request.on("error", reject);
    request.write(Buffer.alloc(server.MAX_BODY_BYTES));
    request.end(Buffer.alloc(1));
  });
  assert.equal(result, 413);
});

test("invalid ports fail before opening any socket and shutdown is idempotent", async t => {
  const server = await fixture(t);
  await assert.rejects(server.start({ port: -1 }), /Fixture port must be/);
  await server.close();
  await server.close();
  await assert.rejects(fetch(server.origin));
});

test("shutdown closes active paced downloads instead of leaving streaming timers alive", async t => {
  const server = await fixture(t, { slowDurationMs: 10000 });
  const response = await fetch(`${server.origin}/download-slow`);
  const reader = response.body.getReader();
  assert.equal((await reader.read()).done, false);
  await server.close();
  await assert.rejects(reader.read());
});
