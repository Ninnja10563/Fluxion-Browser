import { setTimeout, clearTimeout } from "resource://gre/modules/Timer.sys.mjs";
import { FluxionRelease } from "resource://fluxion/modules/FluxionRelease.sys.mjs";

// System-global DOM exposure varies across Gecko baselines. These are native
// chrome globals, never constructors or network functions supplied by a page.
if (typeof fetch === "undefined" || typeof TextDecoder === "undefined") {
  Cu.importGlobalProperties(["fetch", "TextDecoder"]);
}

const RELEASES_URL = "https://api.github.com/repos/Ninnja10563/Fluxion-Browser/releases?per_page=100";
const MAX_BYTES = 4 * 1024 * 1024;
const DEADLINE_MS = 10000;
let inFlight;

async function fetchReleases() {
  const controller = new AbortController();
  let timedOut = false;
  let reader;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, DEADLINE_MS);
  try {
    const response = await fetch(RELEASES_URL, {
      method: "GET", credentials: "omit", redirect: "error", referrer: "",
      referrerPolicy: "no-referrer", cache: "no-store", signal: controller.signal,
      headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    });
    if (timedOut) return { error: "timeout" };
    if (response.status === 403 || response.status === 429) return { error: "rate-limit" };
    if (response.status !== 200 || response.redirected || response.url !== RELEASES_URL) return { error: "http" };
    const type = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    if (!["application/json", "application/vnd.github+json"].includes(type)) return { error: "invalid-response" };
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
    const releases = JSON.parse(text);
    if (!Array.isArray(releases) || releases.length > 100) return { error: "invalid-response" };
    return { releases };
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
    // Importing this singleton performs no network IO. Only an explicit check
    // starts a request; concurrent browser windows share its bounded response.
    if (!inFlight) inFlight = fetchReleases().finally(() => { inFlight = null; });
    return inFlight.then(result => result.error
      ? { state: "unavailable", installed: installedRelease, reason: result.error }
      : FluxionRelease.select(result.releases, installedRelease, platform));
  },
});
