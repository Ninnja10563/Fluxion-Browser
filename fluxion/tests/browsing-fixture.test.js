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

test("partial-file fixture delivers buffered-file-sized chunks and resumes its exact binary payload", async t => {
  const server = await fixture(t, { partialDurationMs: 200 });
  assert.equal(server.partialDownload.bytes, 512 * 1024);
  const response = await fetch(`${server.origin}/download-partial`);
  assert.equal(response.headers.get("content-length"), String(server.PARTIAL_BYTES.length));
  assert.equal(response.headers.get("content-disposition"), `attachment; filename="${server.PARTIAL_FILENAME}"`);
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  while (received < 64 * 1024) {
    const next = await reader.read();
    assert.equal(next.done, false);
    chunks.push(next.value);
    received += next.value.length;
  }
  assert.ok(received < server.PARTIAL_BYTES.length);
  await reader.cancel();
  const resumed = await fetch(`${server.origin}/download-partial`, {
    headers: { Range: `bytes=${received}-`, "If-Range": response.headers.get("etag") },
  });
  assert.equal(resumed.status, 206);
  chunks.push(Buffer.from(await resumed.arrayBuffer()));
  assert.deepEqual(Buffer.concat(chunks), server.PARTIAL_BYTES);
  const state = await (await fetch(`${server.origin}/state`)).json();
  assert.equal(state.downloads, 2);
  assert.equal(state.partialDownloads, 2);
  assert.equal(state.slowDownloads, 0);
  assert.equal(state.rangeDownloads, 1);
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

test("Basic authentication challenges use distinct realms and deterministic unauthorized documents", async t => {
  const server = await fixture(t);
  for (const route of ["cancel", "accept"]) {
    const response = await fetch(`${server.origin}/basic-${route}/`);
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("www-authenticate"), `Basic realm="Fluxion fixture ${route}", charset="UTF-8"`);
    assert.match(await response.text(), new RegExp(`<title>Fluxion basic ${route} challenge</title>`));
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  const state = await (await fetch(`${server.origin}/state`)).json();
  assert.deepEqual(state.basicAuth, {
    cancel: { challenged: 1, authorized: 0, credentialPresent: 0 },
    accept: { challenged: 1, authorized: 0, credentialPresent: 0 },
  });
});

test("Basic authentication rejects wrong credentials, accepts only fixture credentials and retains no secrets", async t => {
  const server = await fixture(t);
  const token = Buffer.from(`${server.LOGIN.username}:${server.LOGIN.password}`).toString("base64");
  for (const route of ["cancel", "accept"]) {
    for (const authorization of ["Basic not-base64!", "Bearer synthetic-private-token", `Basic ${Buffer.from("fluxion:wrong-secret").toString("base64")}`]) {
      const rejected = await fetch(`${server.origin}/basic-${route}/`, { headers: { Authorization: authorization } });
      assert.equal(rejected.status, 401);
      assert.doesNotMatch(await rejected.text(), /synthetic-private-token|wrong-secret|not-base64/);
    }
    const accepted = await fetch(`${server.origin}/basic-${route}/`, { headers: { Authorization: `Basic ${token}` } });
    assert.equal(accepted.status, 200);
    assert.match(await accepted.text(), new RegExp(`<title>Fluxion basic ${route} authenticated</title>`));
    assert.equal(accepted.headers.get("www-authenticate"), null);
    assert.equal(accepted.headers.get("set-cookie"), null);
  }
  const stateText = await (await fetch(`${server.origin}/state`)).text();
  assert.doesNotMatch(stateText, /fixture-only|wrong-secret|synthetic-private-token|Authorization|Basic /);
  assert.equal(stateText.includes(token), false);
  const state = JSON.parse(stateText);
  assert.deepEqual(state.basicAuth, {
    cancel: { challenged: 3, authorized: 1, credentialPresent: 4 },
    accept: { challenged: 3, authorized: 1, credentialPresent: 4 },
  });
  assert.equal(state.logins, 0);
  assert.equal(state.authenticatedVisits, 0);
  assert.equal((await fetch(`${server.origin}/account`, { headers: { Authorization: `Basic ${token}` } })).status, 401,
    "Basic auth must not establish a cookie-authenticated session");
});

test("Basic routes enforce methods and fixture provenance before changing counters", async t => {
  const server = await fixture(t);
  const authorization = `Basic ${Buffer.from(`${server.LOGIN.username}:${server.LOGIN.password}`).toString("base64")}`;
  for (const route of ["cancel", "accept"]) {
    for (const method of ["POST", "PUT", "HEAD", "DELETE"]) {
      const response = await fetch(`${server.origin}/basic-${route}/`, { method, headers: { Authorization: authorization } });
      assert.equal(response.status, 405);
      assert.equal(response.headers.get("www-authenticate"), null);
      await response.text();
    }
  }
  const foreignHost = await new Promise((resolve, reject) => {
    const request = http.get(`${server.origin}/basic-accept/`, { headers: { Host: "unrelated.example", Authorization: authorization } }, response => {
      response.resume();
      response.on("end", () => resolve(response.statusCode));
    });
    request.on("error", reject);
  });
  assert.equal(foreignHost, 400);
  const state = await (await fetch(`${server.origin}/state`)).json();
  assert.deepEqual(state.basicAuth, {
    cancel: { challenged: 0, authorized: 0, credentialPresent: 0 },
    accept: { challenged: 0, authorized: 0, credentialPresent: 0 },
  });
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
