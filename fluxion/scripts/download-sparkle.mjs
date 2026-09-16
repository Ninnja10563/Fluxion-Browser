import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { readFile, link, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

export function validateSparkleLock(lock) {
  if (!/^2\.\d+\.\d+$/.test(lock.version) || !/^[a-f0-9]{64}$/.test(lock.sha256) ||
      !Number.isSafeInteger(lock.size) || lock.size < 1 || lock.size > 100 * 1024 * 1024 ||
      lock.url !== `https://github.com/sparkle-project/Sparkle/releases/download/${lock.version}/Sparkle-${lock.version}.tar.xz` ||
      !/^[A-Za-z0-9+/]{43}=$/.test(lock.publicKey) ||
      lock.feedURL !== "https://raw.githubusercontent.com/Ninnja10563/Fluxion-Browser/update-channel/appcast.xml")
    throw new Error("Invalid reviewed Sparkle lock");
  return lock;
}
export async function downloadSparkle(lock, destination, fetchImpl = fetch) {
  validateSparkleLock(lock);
  const partial = `${destination}.${randomUUID()}.partial`;
  const signal = AbortSignal.timeout(180000);
  try {
    let url = lock.url, response;
    for (let redirects = 0; redirects <= 5; redirects++) {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port ||
          !["github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"].includes(parsed.hostname))
        throw new Error("Unsafe Sparkle download redirect");
      response = await fetchImpl(url, { credentials: "omit", referrerPolicy: "no-referrer", redirect: "manual", signal });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get("location"); await response.body?.cancel();
      if (!location || redirects === 5) throw new Error("Excessive Sparkle redirects");
      url = new URL(location, url).href;
    }
    if (response.status !== 200 || !response.body) throw new Error("Sparkle download failed");
    const hash = createHash("sha256"); let size = 0;
    const verify = new Transform({ transform(chunk, _encoding, callback) {
      size += chunk.length;
      if (size > lock.size) return callback(new Error("Sparkle archive exceeds locked size"));
      hash.update(chunk); callback(null, chunk);
    } });
    await pipeline(Readable.fromWeb(response.body), verify, createWriteStream(partial, { flags: "wx", mode: 0o600 }));
    if (size !== lock.size || hash.digest("hex") !== lock.sha256) throw new Error("Sparkle archive does not match the reviewed digest");
    await link(partial, destination);
    return { version: lock.version, bytes: size, sha256: lock.sha256 };
  } finally { await unlink(partial).catch(error => { if (error.code !== "ENOENT") throw error; }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 3) throw new Error("Usage: download-sparkle.mjs <new-archive-path>");
  const lock = JSON.parse(await readFile(new URL("../runtime/sparkle-lock.json", import.meta.url), "utf8"));
  console.log(JSON.stringify(await downloadSparkle(lock, resolve(process.argv[2]))));
}
