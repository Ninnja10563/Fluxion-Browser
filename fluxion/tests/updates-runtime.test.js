"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const URL = "https://raw.githubusercontent.com/Ninnja10563/Fluxion-Browser/update-channel/releases.json";
const NOW = Date.UTC(2026, 8, 10, 12);
function manifest(version = "0.49.0-preview.1") {
  const root = "https://github.com/Ninnja10563/Fluxion-Browser", tag = `v${version}`;
  const filename = `Fluxion-${version}-macOS-universal.dmg`;
  return { schemaVersion: 1, repository: "Ninnja10563/Fluxion-Browser", generatedAt: new Date(NOW).toISOString(),
    expiresAt: new Date(NOW + 86400000).toISOString(), releases: [{ id: 1, tag_name: tag, draft: false,
      prerelease: version.includes("preview"), html_url: `${root}/releases/tag/${tag}`,
      published_at: new Date(NOW - 86400000).toISOString(), verifiedAt: new Date(NOW).toISOString(),
      sourceCommit: "a".repeat(40), assets: [filename, `${filename}.sha256`].map((name, index) => ({
        id: 10 + index, name, state: "uploaded", size: 100, digest: `sha256:${"b".repeat(64)}`,
        browser_download_url: `${root}/releases/download/${tag}/${name}` })) }] };
}
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const settle = () => new Promise(resolve => setImmediate(resolve));

function fixture(fetchImpl, { realValidation = false } = {}) {
  const calls = [], timers = new Map(), selections = [];
  let timerId = 0;
  let now = Date.UTC(2026, 8, 10, 12);
  class Clock extends Date { static now() { return now; } }
  const context = vm.createContext({ AbortController, TextDecoder, Date: Clock,
    fetch: (url, options) => { calls.push({ url, options }); return fetchImpl(url, options); },
    setTimeout(callback, delay) { assert.equal(delay, 10000); timers.set(++timerId, callback); return timerId; },
    clearTimeout(id) { timers.delete(id); },
    FluxionRelease: { select(releases, installed, platform) {
      selections.push({ releases, installed, platform });
      return { state: platform === "Darwin" ? "current" : "unsupported", installed };
    } },
  });
  {
    const selectionSpy = context.FluxionRelease;
    const validation = fs.readFileSync(path.join(__dirname, "../modules/FluxionRelease.sys.mjs"), "utf8")
      .replace("export const FluxionRelease", "globalThis.FluxionRelease");
    vm.runInContext(`(() => { ${validation} })()`, context);
    const feedValidation = fs.readFileSync(path.join(__dirname, "../modules/FluxionReleaseFeed.sys.mjs"), "utf8")
      .replace(/^import .*;\n/gm, "").replace("export const FluxionReleaseFeed", "globalThis.FluxionReleaseFeed");
    vm.runInContext(`(() => { const FluxionRelease = globalThis.FluxionRelease; ${feedValidation} })()`, context);
    if (!realValidation) context.FluxionRelease = selectionSpy;
  }
  const source = fs.readFileSync(path.join(__dirname, "../modules/FluxionUpdates.sys.mjs"), "utf8")
    .replace(/^import .*;\n/gm, "").replace("export const FluxionUpdates", "globalThis.FluxionUpdates");
  vm.runInContext(source, context);
  return { check: context.FluxionUpdates.check, calls, selections, timers,
    now: () => now, advance(ms) { now += ms; },
    expire() { for (const timer of [...timers.values()]) timer(); } };
}
function response(text = JSON.stringify(manifest()), options = {}) {
  const encoder = new TextEncoder();
  const body = options.body || new ReadableStream({ start(controller) { controller.enqueue(encoder.encode(text)); controller.close(); } });
  return { status: 200, url: URL, redirected: false,
    headers: new Headers({ "content-type": "application/json; charset=utf-8", ...options.headers }),
    ...options, body };
}

test("explicit checks only use fixed credential-free GitHub request and share in-flight work", async () => {
  const pending = deferred();
  const f = fixture(() => pending.promise);
  assert.equal(f.calls.length, 0, "import must not contact GitHub");
  const first = f.check("0.49.0-preview.1"), second = f.check("0.49.0-preview.1");
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, URL);
  const options = f.calls[0].options;
  assert.equal(options.credentials, "omit"); assert.equal(options.redirect, "error");
  assert.equal(options.referrer, ""); assert.equal(options.referrerPolicy, "no-referrer");
  assert.equal(options.cache, "no-store"); assert.equal(options.method, "GET");
  assert.deepEqual(Object.keys(options.headers), ["Accept"]);
  pending.resolve(response());
  assert.equal((await first).state, "current"); assert.equal((await second).state, "current");
  assert.equal(f.selections[0].releases[0].tag_name, "v0.49.0-preview.1");
  assert.equal(f.timers.size, 0);
});

test("actual network module and release validator expose only the verified newer DMG pair", async () => {
  const feed = manifest("0.50.0-preview.1"), release = feed.releases[0];
  const f = fixture(async () => response(JSON.stringify(feed)), { realValidation: true });
  const result = await f.check("0.49.0-preview.1");
  assert.equal(result.state, "available");
  assert.equal(result.downloadURL, release.assets[0].browser_download_url);
  assert.equal(result.checksumURL, release.assets[1].browser_download_url);
  assert.equal(result.evidence.sourceCommit, release.sourceCommit);
  assert.equal(result.evidence.assets[0].digest, release.assets[0].digest);
  assert.equal(f.calls.length, 1, "checking never downloads app or checksum bytes");
});

for (const [label, makeResponse, reason] of [
  ["server failure", () => response("[]", { status: 500 }), "http"],
  ["redirected response", () => response("[]", { redirected: true }), "http"],
  ["different final URL", () => response("[]", { url: "https://evil.test/releases" }), "http"],
  ["HTML payload", () => response("[]", { headers: new Headers({ "content-type": "text/html" }) }), "invalid-response"],
  ["oversized declared response", () => response("[]", { headers: new Headers({ "content-type": "application/json", "content-length": "65537" }) }), "too-large"],
  ["oversized streamed response", () => response(" ".repeat(65537)), "too-large"],
  ["legacy release array", () => response(JSON.stringify(Array.from({ length: 101 }, () => ({})))), "invalid-feed"],
  ["empty manifest", () => response("{}"), "invalid-feed"],
]) {
  test(`${label} never reports current or feeds validation and is not cached`, async () => {
    const f = fixture(async () => makeResponse());
    const result = await f.check("0.49.0-preview.1");
    assert.equal(result.state, "unavailable"); assert.equal(result.reason, reason);
    assert.equal(f.selections.length, 0);
    await f.check("0.49.0-preview.1"); assert.equal(f.calls.length, 2);
  });
}

test("raw text/plain JSON is validated and expired or tampered feeds never report current", async () => {
  const f = fixture(async () => response(undefined, { headers: new Headers({ "content-type": "text/plain; charset=utf-8" }) }), { realValidation: true });
  assert.equal((await f.check("0.48.0-preview.1")).state, "available");
  f.advance(86400000);
  assert.equal((await f.check("0.48.0-preview.1")).reason, "invalid-feed");
  assert.equal(f.calls.length, 2, "expired feeds cannot trigger an API fallback");
  for (const mutate of [
    x => { x.releases[0].assets[0].digest = "not a digest"; },
    x => { x.releases[0].sourceCommit = "main"; },
    x => { x.releases[0].assets[0].browser_download_url += "?token=x"; },
    x => { x.generatedAt = new Date(NOW + 300001).toISOString(); },
    x => { x.releases.push(x.releases[0]); },
  ]) {
    const value = manifest(); mutate(value);
    const bad = fixture(async () => response(JSON.stringify(value)), { realValidation: true });
    assert.equal((await bad.check("0.48.0-preview.1")).reason, "invalid-feed");
    assert.equal(bad.calls.length, 1);
  }
});

test("shared response retains independent stable and preview channel selection", async () => {
  const pending = deferred(); const f = fixture(() => pending.promise, { realValidation: true });
  const stable = f.check("0.48.0"), preview = f.check("0.48.0-preview.1");
  const value = manifest("0.49.0-preview.1"), older = manifest("0.48.1").releases[0];
  older.id = 2; older.assets.forEach((asset, i) => { asset.id = 20 + i; });
  value.releases.push(older); pending.resolve(response(JSON.stringify(value)));
  assert.equal((await stable).latest, "0.48.1"); assert.equal((await preview).latest, "0.49.0-preview.1");
  assert.equal(f.calls.length, 1);
});

test("whole-body deadline aborts stalled streaming without releasing the fetch slot early", async () => {
  const pendingRead = deferred();
  let cancelled = false;
  const f = fixture(async () => response("", { body: { getReader: () => ({
    read: () => pendingRead.promise, cancel: async () => { cancelled = true; }, releaseLock() {},
  }) } }));
  const first = f.check("0.49.0-preview.1"); await settle();
  f.expire();
  assert.equal(f.calls[0].options.signal.aborted, true);
  const second = f.check("0.49.0-preview.1");
  assert.equal(f.calls.length, 1, "abort alone cannot free unsettled underlying work");
  pendingRead.reject(new Error("aborted reader"));
  assert.equal((await first).reason, "timeout"); assert.equal((await second).reason, "timeout");
  assert.equal(cancelled, true); assert.equal(f.timers.size, 0);
});

test("fetch-stage timeout and unsupported platforms never imply a latest release", async () => {
  const pending = deferred(); const f = fixture(() => pending.promise);
  assert.equal((await f.check("0.49.0-preview.1", "Linux")).state, "unsupported");
  assert.equal(f.calls.length, 0);
  const first = f.check("0.49.0-preview.1"); f.expire();
  const second = f.check("0.49.0-preview.1"); assert.equal(f.calls.length, 1);
  pending.reject(new Error("abort"));
  assert.equal((await first).reason, "timeout"); assert.equal((await second).reason, "timeout");
});

for (const status of [403, 429]) {
  test(`${status} applies shared fallback cooldown with no automatic retry`, async () => {
    const f = fixture(async () => response("[]", { status }));
    const first = await f.check("0.49.0-preview.1");
    assert.equal(first.reason, "rate-limit"); assert.equal(first.status, status);
    assert.equal(first.retryAt, f.now() + 60000);
    const second = await f.check("0.48.0-preview.1");
    assert.equal(second.retryAt, first.retryAt); assert.equal(second.installed, "0.48.0-preview.1");
    assert.equal(f.calls.length, 1); assert.equal(f.timers.size, 0);
    f.advance(59999); await f.check("0.49.0-preview.1"); assert.equal(f.calls.length, 1);
    f.advance(1); await settle(); assert.equal(f.calls.length, 1, "expiry cannot fetch automatically");
    await f.check("0.49.0-preview.1"); assert.equal(f.calls.length, 2);
  });
}

for (const [label, headers, milliseconds] of [
  ["seconds", { "retry-after": "120" }, 120000],
  ["HTTP date", { "retry-after": "Thu, 10 Sep 2026 12:03:00 GMT" }, 180000],
  ["later exhausted quota reset", { "retry-after": "120", "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(Date.UTC(2026, 8, 10, 12, 5) / 1000) }, 300000],
  ["nonexhausted quota ignored", { "x-ratelimit-remaining": "1", "x-ratelimit-reset": String(Date.UTC(2026, 8, 10, 12, 5) / 1000) }, 60000],
  ["long valid advice honored", { "retry-after": "172800" }, 172800000],
  ["invalid advice", { "retry-after": "not a date", "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1e999" }, 60000],
  ["out of Date range", { "retry-after": "86400000000000000000" }, 60000],
  ["past advice", { "retry-after": "Wed, 09 Sep 2026 12:03:00 GMT", "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1000" }, 60000],
]) {
  test(`rate-limit ${label} determines a validated future retry timestamp`, async () => {
    const f = fixture(async () => response("[]", { status: 429, headers: new Headers(headers) }));
    const result = await f.check("0.49.0-preview.1");
    assert.equal(result.retryAt, f.now() + milliseconds);
    assert.equal(result.reason, "rate-limit"); assert.equal(f.selections.length, 0);
  });
}
