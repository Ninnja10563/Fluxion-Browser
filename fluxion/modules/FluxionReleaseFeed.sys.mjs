import { FluxionRelease } from "./FluxionRelease.sys.mjs";

const REPOSITORY = "Ninnja10563/Fluxion-Browser";
const WEEK = 7 * 24 * 60 * 60 * 1000;
const CLOCK_SKEW = 5 * 60 * 1000;
const positiveId = value => Number.isSafeInteger(value) && value > 0;
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);

function timestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value ? time : null;
}

function validate(value, now = Date.now()) {
  try {
    if (!Number.isSafeInteger(now) || !record(value) || value.schemaVersion !== 1 || value.repository !== REPOSITORY ||
        !Array.isArray(value.releases) || value.releases.length < 1 || value.releases.length > 2) return null;
    const generated = timestamp(value.generatedAt), expires = timestamp(value.expiresAt);
    if (generated === null || expires === null || generated > now + CLOCK_SKEW ||
        expires <= generated || expires - generated > WEEK || expires <= now) return null;
    const ids = new Set(), assetIds = new Set(), tags = new Set(), channels = new Set();
    const releases = [];
    for (const entry of value.releases) {
      if (!record(entry) || !positiveId(entry.id) || ids.has(entry.id) || tags.has(entry.tag_name) ||
          typeof entry.prerelease !== "boolean" || channels.has(entry.prerelease) ||
          typeof entry.sourceCommit !== "string" || !/^[0-9a-f]{40}$/.test(entry.sourceCommit) ||
          !Array.isArray(entry.assets) || entry.assets.length !== 2) return null;
      const published = timestamp(entry.published_at), verified = timestamp(entry.verifiedAt);
      if (published === null || verified === null || published > verified || verified > generated ||
          generated - verified > WEEK || now - verified > WEEK) return null;
      const assets = [];
      for (const asset of entry.assets) {
        if (!record(asset) || !positiveId(asset.id) || assetIds.has(asset.id) || !positiveId(asset.size) ||
            typeof asset.digest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(asset.digest)) return null;
        assetIds.add(asset.id);
        assets.push({ id: asset.id, name: asset.name, state: asset.state, size: asset.size,
          digest: asset.digest, browser_download_url: asset.browser_download_url });
      }
      // Reuse the browser's existing strict version/channel and canonical
      // release/asset validation. A feed must not weaken the REST boundary.
      const checked = FluxionRelease.select([entry], "0.0.0-preview.0");
      if (!["available", "current"].includes(checked.state) || `v${checked.latest}` !== entry.tag_name) return null;
      ids.add(entry.id); tags.add(entry.tag_name); channels.add(entry.prerelease);
      releases.push({ id: entry.id, tag_name: entry.tag_name, draft: entry.draft, prerelease: entry.prerelease,
        html_url: entry.html_url, published_at: entry.published_at, sourceCommit: entry.sourceCommit,
        verifiedAt: entry.verifiedAt, assets });
    }
    // Copy validated metadata; callers cannot accidentally mutate the input.
    // This is maintainer-published HTTPS metadata, not a signed build attestation.
    return { releases, generatedAt: value.generatedAt, expiresAt: value.expiresAt };
  } catch (_) { return null; }
}

export const FluxionReleaseFeed = Object.freeze({ validate });
