import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { FluxionReleaseFeed } from "../modules/FluxionReleaseFeed.sys.mjs";

const REPOSITORY = "Ninnja10563/Fluxion-Browser";
const API = `https://api.github.com/repos/${REPOSITORY}`;
const PUBLIC = `https://github.com/${REPOSITORY}`;
const MAX_DMG_BYTES = 2 * 1024 ** 3;
const MAX_JSON_BYTES = 16 * 1024 ** 2;
const ASSET_HOSTS = new Set(["github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"]);
const fail = message => { throw new Error(message); };
const positive = value => Number.isSafeInteger(value) && value > 0;
function parsedVersion(tag) {
  const match = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-preview\.(0|[1-9]\d*))?$/.exec(tag);
  if (!match) return null;
  const parts = match.slice(1).map(value => value === undefined ? null : Number(value));
  return parts.every(value => value === null || Number.isSafeInteger(value)) ? parts : null;
}
function newer(left, right) {
  for (let index = 0; index < 4; index++) {
    if (left[index] !== right[index]) return left[index] > right[index];
  }
  return false;
}

/** Verify public bytes before producing metadata. This never deploys a feed. */
export async function buildReleaseFeed({ fetchImpl = globalThis.fetch, now = () => Date.now(), apiToken = "",
  maxPages = 100, timeoutMs = 600000, expiresInMs = 24 * 60 * 60 * 1000 } = {}) {
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 100 ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600000 ||
      !Number.isSafeInteger(expiresInMs) || expiresInMs <= 0 || expiresInMs > 7 * 86400000) fail("Invalid publisher bounds");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("Release feed verification deadline exceeded")), timeoutMs);
  const checkAbort = () => { if (controller.signal.aborted) throw controller.signal.reason; };
  async function request(url, authenticated = false) {
    checkAbort();
    const headers = authenticated ? { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" } : {};
    if (authenticated && apiToken) headers.Authorization = `Bearer ${apiToken}`;
    return fetchImpl(url, { headers, credentials: "omit", referrerPolicy: "no-referrer",
      redirect: "manual", signal: controller.signal });
  }
  async function readBounded(response, limit) {
    const chunks = []; let size = 0;
    if (!response.body) fail("Missing response body");
    for await (const chunk of response.body) {
      checkAbort(); size += chunk.byteLength;
      if (size > limit) fail("API/checksum response exceeds byte limit");
      chunks.push(Buffer.from(chunk));
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  }
  async function api(path) {
    // Callers only construct paths below this fixed repository API prefix.
    if (!/^\/(?:releases\?per_page=100&page=\d+|git\/ref\/tags\/[^/?#]+|git\/tags\/[0-9a-f]{40}|commits\/[0-9a-f]{40})$/.test(path)) fail("Unsafe API path");
    const response = await request(`${API}${path}`, true);
    if (response.status !== 200) fail(`GitHub API HTTP ${response.status}`);
    const body = JSON.parse(await readBounded(response, MAX_JSON_BYTES));
    return { body, link: response.headers.get("link") || "" };
  }
  async function resolveTag(tag) {
    let object = (await api(`/git/ref/tags/${encodeURIComponent(tag)}`)).body;
    if (object?.ref !== `refs/tags/${tag}`) fail("Remote tag reference mismatch");
    object = object.object;
    const seen = new Set();
    for (let depth = 0; depth <= 8; depth++) {
      if (!object || !/^[0-9a-f]{40}$/.test(object.sha) || seen.has(object.sha)) fail("Invalid or cyclic remote tag object");
      seen.add(object.sha);
      if (object.type === "commit") {
        const commit = (await api(`/commits/${object.sha}`)).body;
        if (commit?.sha !== object.sha) fail("Remote tag commit cannot be verified");
        return object.sha;
      }
      if (object.type !== "tag" || depth === 8) fail("Unsupported or excessive annotated tag depth");
      const annotated = (await api(`/git/tags/${object.sha}`)).body;
      if (annotated?.sha !== object.sha) fail("Annotated tag object mismatch");
      object = annotated.object;
    }
    fail("Unresolved remote tag");
  }
  async function verifyAsset(asset, checksum = false) {
    let url = asset.browser_download_url, response;
    for (let redirects = 0; redirects <= 5; redirects++) {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port ||
          !ASSET_HOSTS.has(parsed.hostname)) fail("Unsafe public asset redirect");
      response = await request(url);
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location || redirects === 5) fail("Invalid or excessive asset redirect");
      url = new URL(location, url).href;
    }
    if (response.status !== 200 || !response.body) fail(`Public asset HTTP ${response.status}`);
    const declared = response.headers.get("content-length");
    if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) !== asset.size)) fail("Asset Content-Length mismatch");
    let size = 0, text = "";
    const hash = createHash("sha256");
    for await (const chunk of response.body) {
      checkAbort(); size += chunk.byteLength;
      if (size > asset.size || size > (checksum ? 512 : MAX_DMG_BYTES)) fail("Asset exceeds verified size bound");
      hash.update(chunk);
      if (checksum) text += Buffer.from(chunk).toString("utf8");
    }
    const digest = `sha256:${hash.digest("hex")}`;
    if (size !== asset.size || digest !== asset.digest) fail("Public asset size or REST digest mismatch");
    return text;
  }
  async function discoverPublished() {
    const ids = new Set(), tags = new Set(), selected = new Map();
    let complete = false;
    for (let page = 1; page <= maxPages; page++) {
      const { body, link } = await api(`/releases?per_page=100&page=${page}`);
      if (!Array.isArray(body) || body.length > 100) fail("Invalid release page");
      for (const release of body) {
        if (!release || !positive(release.id) || typeof release.tag_name !== "string" || ids.has(release.id) || tags.has(release.tag_name)) fail("Ambiguous release pagination");
        ids.add(release.id); tags.add(release.tag_name);
        if (release.draft === true) continue;
        if (release.draft !== false) fail("Invalid release draft flag");
        const version = parsedVersion(release.tag_name);
        if (!version) continue;
        const preview = version[3] !== null;
        if (release.prerelease !== preview) fail("Release version/channel mismatch");
        const prior = selected.get(preview);
        if (!prior || newer(version, prior.version)) selected.set(preview, { version, release });
      }
      if (body.length < 100) {
        if (/rel\s*=\s*"?next\b/i.test(link)) fail("Incomplete release pagination");
        complete = true; break;
      }
    }
    if (!complete) fail("Release pagination bound reached before completeness");
    if (!selected.size) fail("No supported published release");
    return selected;
  }
  function canonicalMetadata(release, preview) {
    const tag = release.tag_name;
    if (release.html_url !== `${PUBLIC}/releases/tag/${tag}` || !Array.isArray(release.assets) || release.assets.length > 100) fail("Newest release metadata is invalid");
    const name = `Fluxion-${tag.slice(1)}-macOS-universal.dmg`;
    const assets = [name, `${name}.sha256`].map((expected, index) => {
      const matches = release.assets.filter(asset => asset?.name === expected);
      if (matches.length !== 1) fail("Newest release lacks unique canonical assets");
      const value = matches[0];
      if (!positive(value.id) || value.state !== "uploaded" || !positive(value.size) ||
          value.size > (index ? 512 : MAX_DMG_BYTES) || !/^sha256:[0-9a-f]{64}$/.test(value.digest) ||
          value.browser_download_url !== `${PUBLIC}/releases/download/${tag}/${expected}`) fail("Newest release asset metadata is invalid");
      return { id: value.id, name: value.name, state: value.state, size: value.size,
        digest: value.digest, browser_download_url: value.browser_download_url };
    });
    if (typeof release.published_at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(release.published_at)) fail("Invalid release publication time");
    const published = new Date(release.published_at).toISOString();
    if (published !== release.published_at.replace(/(?<=:\d{2})Z$/, ".000Z")) fail("Invalid release publication date");
    return { id: release.id, tag_name: tag, draft: false, prerelease: preview,
      html_url: release.html_url, published_at: published, assets };
  }
  try {
    const selected = await discoverPublished();
    const snapshots = new Map();
    const releases = [];
    for (const preview of [false, true]) {
      const chosen = selected.get(preview);
      if (!chosen) continue;
      const metadata = canonicalMetadata(chosen.release, preview);
      snapshots.set(preview, JSON.stringify(metadata));
      const { tag_name: tag, assets } = metadata;
      const sourceCommit = await resolveTag(tag);
      await verifyAsset(assets[0]);
      const checksum = await verifyAsset(assets[1], true);
      if (checksum !== `${assets[0].digest.slice(7)}  ${assets[0].name}\n`) fail("Checksum content or canonical filename mismatch");
      // A moving tag cannot silently mix pre-verification source with new bytes.
      if (await resolveTag(tag) !== sourceCommit) fail("Release tag changed during verification");
      releases.push({ ...metadata, sourceCommit, verifiedAt: new Date(now()).toISOString() });
    }
    // Reconcile a fresh complete listing after downloads: replacement assets,
    // deletion, or a newly published channel must not leave a stale feed.
    const current = await discoverPublished();
    if (current.size !== snapshots.size) fail("Published release channels changed during verification");
    for (const [preview, chosen] of current) {
      if (snapshots.get(preview) !== JSON.stringify(canonicalMetadata(chosen.release, preview))) fail("Published release metadata changed during verification");
    }
    checkAbort();
    const generated = now();
    const feed = { schemaVersion: 1, repository: REPOSITORY, generatedAt: new Date(generated).toISOString(),
      expiresAt: new Date(generated + expiresInMs).toISOString(), releases };
    if (!FluxionReleaseFeed.validate(feed, generated)) fail("Verified release feed failed shared schema validation");
    return feed;
  } finally { clearTimeout(timer); controller.abort(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== "--output" || !args[1]) throw new Error("Usage: build-release-feed.mjs --output <file>");
  const feed = await buildReleaseFeed({ apiToken: process.env.GH_TOKEN || "" });
  await writeFile(args[1], `${JSON.stringify(feed, null, 2)}\n`, { flag: "wx", mode: 0o644 });
  console.log(`Verified ${feed.releases.length} release channels; wrote ${args[1]}`);
}
