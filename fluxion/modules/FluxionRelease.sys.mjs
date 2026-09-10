const REPOSITORY = "https://github.com/Ninnja10563/Fluxion-Browser";
const MAX_RELEASES = 100;

function version(value, allowPrefix = false) {
  if (typeof value !== "string" || value.length > 100) return null;
  const text = allowPrefix && value.startsWith("v") ? value.slice(1) : value;
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-preview\.(0|[1-9]\d*))?$/.exec(text);
  if (!match) return null;
  const parts = match.slice(1, 4).map(Number);
  const preview = match[4] === undefined ? null : Number(match[4]);
  if (!parts.every(Number.isSafeInteger) || (preview !== null && !Number.isSafeInteger(preview))) return null;
  return { text, parts, preview };
}

function compare(a, b) {
  for (let index = 0; index < 3; index++) {
    if (a.parts[index] !== b.parts[index]) return a.parts[index] > b.parts[index] ? 1 : -1;
  }
  if (a.preview === b.preview) return 0;
  if (a.preview === null) return 1;
  if (b.preview === null) return -1;
  return a.preview > b.preview ? 1 : -1;
}

function candidate(release, installed) {
  if (!release || typeof release !== "object" || release.draft !== false ||
      typeof release.tag_name !== "string" || !release.tag_name.startsWith("v")) return null;
  const parsed = version(release.tag_name.slice(1));
  if (!parsed || release.prerelease !== (parsed.preview !== null) ||
      (installed.preview === null && parsed.preview !== null)) return null;
  const releaseURL = `${REPOSITORY}/releases/tag/v${parsed.text}`;
  if (release.html_url !== releaseURL || !Array.isArray(release.assets) || release.assets.length > 100) return null;
  const name = `Fluxion-${parsed.text}-macOS-universal.dmg`;
  const assets = [name, `${name}.sha256`].map(expected => {
    const matches = release.assets.filter(asset => asset?.name === expected);
    if (matches.length !== 1) return null;
    const asset = matches[0];
    const url = `${REPOSITORY}/releases/download/v${parsed.text}/${expected}`;
    return asset.state === "uploaded" && Number.isSafeInteger(asset.size) && asset.size > 0 &&
      asset.browser_download_url === url ? url : null;
  });
  if (assets.some(asset => !asset)) return null;
  return { version: parsed, releaseURL, downloadURL: assets[0], checksumURL: assets[1] };
}

function select(releases, installedRelease, platform = "Darwin") {
  const installedVersion = version(installedRelease, true);
  const installed = installedVersion?.text ?? (typeof installedRelease === "string" ? installedRelease.slice(0, 100) : "");
  if (platform !== "Darwin") return { state: "unsupported", installed };
  if (!installedVersion || !Array.isArray(releases)) return { state: "unavailable", installed };
  let latest = null;
  // GitHub's releases endpoint has a maximum page size of 100. Do not scan an
  // unbounded response or rely on its publication-date ordering for versions.
  for (const release of releases.slice(0, MAX_RELEASES)) {
    const valid = candidate(release, installedVersion);
    if (valid && (!latest || compare(valid.version, latest.version) > 0)) latest = valid;
  }
  if (!latest) return { state: "unavailable", installed };
  if (compare(latest.version, installedVersion) <= 0) {
    // Never offer an older download, even if a release was recently republished.
    return { state: "current", installed, latest: latest.version.text };
  }
  return { state: "available", installed, latest: latest.version.text,
    releaseURL: latest.releaseURL, downloadURL: latest.downloadURL, checksumURL: latest.checksumURL };
}

export const FluxionRelease = Object.freeze({ select });
