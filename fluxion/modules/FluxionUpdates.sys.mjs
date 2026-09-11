import { setTimeout, clearTimeout } from "resource://gre/modules/Timer.sys.mjs";
import { FluxionRelease } from "resource://fluxion/modules/FluxionRelease.sys.mjs";
import { FluxionReleaseFeed } from "resource://fluxion/modules/FluxionReleaseFeed.sys.mjs";

// System-global DOM exposure varies across Gecko baselines. These are native
// chrome globals, never constructors or network functions supplied by a page.
if (typeof fetch === "undefined" || typeof TextDecoder === "undefined") {
  Cu.importGlobalProperties(["fetch", "TextDecoder"]);
}

const RELEASES_URL = "https://raw.githubusercontent.com/Ninnja10563/Fluxion-Browser/update-channel/releases.json";
const MAX_BYTES = 64 * 1024;
const DEADLINE_MS = 10000;
let inFlight;
let rateLimit;

function rateLimitAdvice(response) {
  const now = Date.now();
  const deadlines = [];
  const future = deadline => Number.isSafeInteger(deadline) && deadline > now && deadline <= 8640000000000000;
  const retry = response.headers.get("retry-after")?.trim();
  if (retry && retry.length <= 128) {
    const deadline = /^\d+$/.test(retry) ? now + Number(retry) * 1000 : Date.parse(retry);
    if (future(deadline)) deadlines.push(deadline);
  }
  if (response.headers.get("x-ratelimit-remaining")?.trim() === "0") {
    const reset = response.headers.get("x-ratelimit-reset")?.trim();
    if (reset && reset.length <= 128 && /^\d+$/.test(reset)) {
      const deadline = Number(reset) * 1000;
      if (future(deadline)) deadlines.push(deadline);
    }
  }
  // Store a timestamp, not a timer. Valid long server backoffs cost no resources
  // and must not be shortened; expiration only permits a later manual check.
  return { error: "rate-limit", status: response.status,
    retryAt: deadlines.length ? Math.max(...deadlines) : now + 60000 };
}

function unavailable(result, installed) {
  return { state: "unavailable", installed, reason: result.error,
    ...(result.retryAt ? { retryAt: result.retryAt, status: result.status } : {}) };
}

async function fetchReleases() {
  const controller = new AbortController();
  let timedOut = false;
  let reader;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, DEADLINE_MS);
  try {
    const response = await fetch(RELEASES_URL, {
      method: "GET", credentials: "omit", redirect: "error", referrer: "",
      referrerPolicy: "no-referrer", cache: "no-store", signal: controller.signal,
      headers: { Accept: "application/json, text/plain" },
    });
    if (timedOut) return { error: "timeout" };
    if (response.redirected || response.url !== RELEASES_URL) return { error: "http" };
    if (response.status === 403 || response.status === 429) {
      rateLimit = rateLimitAdvice(response);
      return rateLimit;
    }
    if (response.status !== 200) return { error: "http" };
    const type = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    // GitHub raw content uses text/plain. Trust rests on the fixed HTTPS URL
    // and bounded, strict JSON schema, never on treating the response as code.
    if (!["application/json", "text/plain"].includes(type)) return { error: "invalid-response" };
    const length = response.headers.get("content-length");
    if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES)) return { error: "too-large" };
    if (!response.body?.getReader) return { error: "invalid-response" };
    reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let bytes = 0;
    let text = "";
    while (true) {
      const { done, value } = await reader.read();
      if (timedOut) return { error: "timeout" };
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) return { error: "too-large" };
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    const feed = JSON.parse(text);
    if (!FluxionReleaseFeed.validate(feed)) return { error: "invalid-feed" };
    return { feed };
  } catch (_) {
    return { error: timedOut ? "timeout" : "unavailable" };
  } finally {
    clearTimeout(timer);
    controller.abort();
    // Cancel without waiting on a possibly stalled producer. The active fetch
    // slot itself is retained until this request's read/fetch has settled.
    if (reader) {
      try { reader.cancel().catch(() => {}); } catch (_) {}
      try { reader.releaseLock(); } catch (_) {}
    }
  }
}

export const FluxionUpdates = Object.freeze({
  check(installedRelease, platform = "Darwin") {
    if (platform !== "Darwin") return Promise.resolve(FluxionRelease.select([], installedRelease, platform));
    if (rateLimit?.retryAt > Date.now()) return Promise.resolve(unavailable(rateLimit, installedRelease));
    rateLimit = null;
    // Importing this singleton performs no network IO. Only an explicit check
    // starts a request; concurrent browser windows share its bounded response.
    if (!inFlight) inFlight = fetchReleases().finally(() => { inFlight = null; });
    return inFlight.then(result => {
      if (result.error) return unavailable(result, installedRelease);
      const checked = FluxionReleaseFeed.validate(result.feed);
      if (!checked) return unavailable({ error: "invalid-feed" }, installedRelease);
      const selection = FluxionRelease.select(checked.releases, installedRelease, platform);
      const selected = checked.releases.find(release => release.tag_name === `v${selection.latest}`);
      return { ...selection, ...(selected ? { evidence: {
        id: selected.id, tag: selected.tag_name, sourceCommit: selected.sourceCommit,
        publishedAt: selected.published_at, assets: selected.assets,
      } } : {}) };
    });
  },
});
