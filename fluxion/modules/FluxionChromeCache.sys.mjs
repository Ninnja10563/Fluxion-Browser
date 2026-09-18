/* global Services, IOUtils, PathUtils */

// The launcher only requests invalidation. A failed exec or rejected profile
// must not acknowledge it. This runs after Gecko has locked the actual profile
// and processed --purgecaches, before any browser window loads its prototypes.
export async function acknowledgeChromeCache() {
  const fingerprint = Services.env.get("FLUXION_CHROME_CACHE_ID");
  if (Services.env.get("FLUXION_CHROME_CACHE_PENDING") !== "1" ||
      !/^[a-f0-9]{64}$/.test(fingerprint)) return false;
  const path = PathUtils.join(PathUtils.profileDir, ".fluxion-chrome-cache");
  await IOUtils.writeUTF8(path, `${fingerprint}\n`, {
    tmpPath: `${path}.tmp`,
  });
  return true;
}
