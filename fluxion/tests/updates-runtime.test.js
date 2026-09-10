"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const URL = "https://api.github.com/repos/Ninnja10563/Fluxion-Browser/releases?per_page=100";
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
  if (realValidation) {
    const validation = fs.readFileSync(path.join(__dirname, "../modules/FluxionRelease.sys.mjs"), "utf8")
      .replace("export const FluxionRelease", "globalThis.FluxionRelease");
    vm.runInContext(`(() => { ${validation} })()`, context);
  }
  const source = fs.readFileSync(path.join(__dirname, "../modules/FluxionUpdates.sys.mjs"), "utf8")
    .replace(/^import .*;\n/gm, "").replace("export const FluxionUpdates", "globalThis.FluxionUpdates");
  vm.runInContext(source, context);
  return { check: context.FluxionUpdates.check, calls, selections, timers,
    now: () => now, advance(ms) { now += ms; },
    expire() { for (const timer of [...timers.values()]) timer(); } };
}
function response(text = "[]", options = {}) {
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
  assert.deepEqual(Object.keys(options.headers).sort(), ["Accept", "X-GitHub-Api-Version"]);
  pending.resolve(response('[{"tag_name":"v0.49.0-preview.1"}]'));
  assert.equal((await first).state, "current"); assert.equal((await second).state, "current");
  assert.equal(f.selections[0].releases[0].tag_name, "v0.49.0-preview.1");
  assert.equal(f.timers.size, 0);
});

test("actual network module and release validator expose only the verified newer DMG pair", async () => {
  const tag = "v0.50.0-preview.1";
  const repo = "https://github.com/Ninnja10563/Fluxion-Browser";
  const filename = "Fluxion-0.50.0-preview.1-macOS-universal.dmg";
  const release = { tag_name: tag, draft: false, prerelease: true, html_url: `${repo}/releases/tag/${tag}`,
    assets: [filename, `${filename}.sha256`].map(name => ({ name, state: "uploaded", size: 100,
      browser_download_url: `${repo}/releases/download/${tag}/${name}` })) };
  const f = fixture(async () => response(JSON.stringify([release])), { realValidation: true });
  const result = await f.check("0.49.0-preview.1");
  assert.equal(result.state, "available");
  assert.equal(result.downloadURL, release.assets[0].browser_download_url);
  assert.equal(result.checksumURL, release.assets[1].browser_download_url);
  assert.equal(f.calls.length, 1, "checking never downloads app or checksum bytes");
});

for (const [label, makeResponse, reason] of [
  ["server failure", () => response("[]", { status: 500 }), "http"],
  ["redirected response", () => response("[]", { redirected: true }), "http"],
  ["different final URL", () => response("[]", { url: "https://evil.test/releases" }), "http"],
  ["HTML payload", () => response("[]", { headers: new Headers({ "content-type": "text/html" }) }), "invalid-response"],
  ["oversized declared response", () => response("[]", { headers: new Headers({ "content-type": "application/json", "content-length": "4194305" }) }), "too-large"],
  ["oversized streamed response", () => response(" ".repeat(4194305)), "too-large"],
  ["more than 100 releases", () => response(JSON.stringify(Array.from({ length: 101 }, () => ({})))), "invalid-response"],
  ["non-array JSON", () => response("{}"), "invalid-response"],
]) {
  test(`${label} never reports current or feeds validation and is not cached`, async () => {
    const f = fixture(async () => makeResponse());
    const result = await f.check("0.49.0-preview.1");
    assert.equal(result.state, "unavailable"); assert.equal(result.reason, reason);
    assert.equal(f.selections.length, 0);
    await f.check("0.49.0-preview.1"); assert.equal(f.calls.length, 2);
  });
}

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
