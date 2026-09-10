import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { readFile, link, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

export function validateLock(lock) {
  if (lock.schemaVersion !== 1 || !/^\d+\.\d+(?:\.\d+)?$/.test(lock.version) ||
      lock.platform !== "mac" || lock.locale !== "en-US" || !/^[a-f0-9]{64}$/.test(lock.sha256)) {
    throw new Error("Invalid Gecko runtime lock");
  }
  const base = `https://archive.mozilla.org/pub/firefox/releases/${lock.version}/`;
  if (lock.url !== `${base}mac/en-US/Firefox%20${lock.version}.dmg` ||
      lock.checksumsUrl !== `${base}SHA256SUMS`) {
    throw new Error("The runtime lock must use the versioned official Mozilla archive");
  }
  return lock;
}

export async function downloadRuntime(lock, destination, fetchImpl = fetch) {
  validateLock(lock);
  const partial = `${destination}.${randomUUID()}.partial`;
  try {
    const response = await fetchImpl(lock.url, { redirect: "error", signal: AbortSignal.timeout(300000) });
    if (!response.ok || !response.body) throw new Error(`Gecko download failed: HTTP ${response.status}`);
    const hash = createHash("sha256");
    let size = 0;
    const digest = new Transform({ transform(chunk, _encoding, callback) {
      size += chunk.length;
      if (size > 1024 * 1024 * 1024) return callback(new Error("Gecko download exceeds 1 GiB"));
      hash.update(chunk);
      callback(null, chunk);
    } });
    await pipeline(Readable.fromWeb(response.body), digest, createWriteStream(partial, { flags: "wx", mode: 0o600 }));
    if (hash.digest("hex") !== lock.sha256) throw new Error("Gecko download SHA-256 does not match the reviewed lock");
    // Publish only verified bytes, without replacing any existing destination.
    await link(partial, destination);
    return { version: lock.version, sha256: lock.sha256, bytes: size };
  } finally {
    await unlink(partial).catch(error => { if (error.code !== "ENOENT") throw error; });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = process.argv[2];
  if (!output || process.argv.length !== 3) throw new Error("Usage: node download-gecko.mjs /path/to/new/firefox.dmg");
  const lock = JSON.parse(await readFile(new URL("../runtime/gecko-lock.json", import.meta.url), "utf8"));
  console.log(JSON.stringify(await downloadRuntime(lock, resolve(output))));
}
