// Maintainer-only signing. Secrets enter through stdin/environment, never argv.
import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const REPOSITORY = "Ninnja10563/Fluxion-Browser";
const MAX_ARCHIVE = 2 * 1024 ** 3;
const FIELDS = ["schemaVersion", "repository", "version", "bundleVersion", "minimumMacOS", "url", "size", "sha256", "sourceCommit", "archiveSignature"];
export const loadSigningLock = async () => JSON.parse(await readFile(new URL("../runtime/sparkle-lock.json", import.meta.url), "utf8"));

export function nativeVersion(version) {
  if (typeof version !== "string" || version.length > 64 ||
      !/^(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})(?:-preview\.([1-9]\d{0,2}))?(?![\s\S])/.test(version) ||
      (version.includes("-preview.") && Number(version.split("-preview.")[1]) > 255))
    throw new Error("Unsupported signed update version");
  return version.replace("-preview.", "b");
}

function base64(value, bytes) {
  if (typeof value !== "string") return false;
  const decoded = Buffer.from(value, "base64");
  return decoded.length === bytes && decoded.toString("base64") === value;
}

export function publicSigningKey(lock) {
  if (!lock || !base64(lock.publicKey, 32) || lock.minimumMacOS !== "12.0") throw new Error("Invalid signing trust configuration");
  return createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(lock.publicKey, "base64")]), format: "der", type: "spki" });
}

export function privateSigningKey(seed, lock) {
  publicSigningKey(lock);
  const value = Buffer.isBuffer(seed) ? Buffer.from(seed) : base64(seed, 32) ? Buffer.from(seed, "base64") : null;
  if (!value || value.length !== 32) throw new Error("A canonical 32-byte Ed25519 signing seed is required");
  try {
    const key = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), value]), format: "der", type: "pkcs8" });
    if (createPublicKey(key).export({ format: "der", type: "spki" }).subarray(-32).toString("base64") !== lock.publicKey)
      throw new Error("Signing seed does not match the reviewed public key");
    return key;
  } finally { value.fill(0); }
}

export function archiveName(version) { nativeVersion(version); return `Fluxion-${version}-macOS-universal.dmg`; }
export function archiveURL(version) { return `https://github.com/${REPOSITORY}/releases/download/v${version}/${archiveName(version)}`; }
export function canonicalRecord(record) {
  return Buffer.from(JSON.stringify(Object.fromEntries(FIELDS.map(key => [key, record[key]]))), "utf8");
}

export function validateSignedRecord(record, lock) {
  try {
    if (!record || typeof record !== "object" || Array.isArray(record) ||
        Object.keys(record).length !== FIELDS.length + 1 || [...FIELDS, "metadataSignature"].some(key => !Object.hasOwn(record, key)) ||
        record.schemaVersion !== 1 || record.repository !== REPOSITORY || record.bundleVersion !== nativeVersion(record.version) ||
        record.minimumMacOS !== lock.minimumMacOS || record.url !== archiveURL(record.version) ||
        !Number.isSafeInteger(record.size) || record.size <= 0 || record.size > MAX_ARCHIVE ||
        typeof record.sha256 !== "string" || record.sha256.length !== 64 || !/^[a-f0-9]{64}$/.test(record.sha256) ||
        typeof record.sourceCommit !== "string" || record.sourceCommit.length !== 40 || !/^[a-f0-9]{40}$/.test(record.sourceCommit) ||
        !base64(record.archiveSignature, 64) || !base64(record.metadataSignature, 64)) return null;
    if (!verify(null, canonicalRecord(record), publicSigningKey(lock), Buffer.from(record.metadataSignature, "base64"))) return null;
    return Object.freeze(Object.fromEntries([...FIELDS, "metadataSignature"].map(key => [key, record[key]])));
  } catch (_) { return null; }
}

async function hashArchive(path) {
  const stat = await lstat(path);
  if (!stat.isFile() || !Number.isSafeInteger(stat.size) || stat.size <= 0 || stat.size > MAX_ARCHIVE) throw new Error("Invalid update archive file");
  const hash = createHash("sha256"); let size = 0;
  for await (const chunk of createReadStream(path)) {
    size += chunk.length;
    if (size > stat.size) throw new Error("Update archive changed while hashing");
    hash.update(chunk);
  }
  if (size !== stat.size) throw new Error("Update archive changed while hashing");
  return { size, sha256: hash.digest("hex"), identity: `${stat.dev}:${stat.ino}:${stat.mtimeMs}:${stat.ctimeMs}` };
}

export async function signUpdateAsset({ assetPath, version, sourceCommit, signUpdatePath, seed, lock, run = execFileSync }) {
  lock ||= await loadSigningLock();
  const key = privateSigningKey(seed, lock);
  const bundleVersion = nativeVersion(version), path = resolve(assetPath);
  if (basename(path) !== archiveName(version) || typeof sourceCommit !== "string" || sourceCommit.length !== 40 || !/^[a-f0-9]{40}$/.test(sourceCommit))
    throw new Error("Archive name or source commit does not match the release");
  const before = await hashArchive(path);
  const encoded = Buffer.isBuffer(seed) ? seed.toString("base64") : seed;
  const env = { ...process.env }; delete env.FLUXION_SPARKLE_PRIVATE_KEY;
  const options = { input: `${encoded}\n`, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], env, timeout: 120000, maxBuffer: 4096 };
  let archiveSignature;
  try {
    archiveSignature = run(resolve(signUpdatePath), ["--ed-key-file", "-", "-p", path], options).trim();
    if (!base64(archiveSignature, 64)) throw new Error("Invalid signer response");
    run(resolve(signUpdatePath), ["--ed-key-file", "-", "--verify", path, archiveSignature], options);
  } catch (_) { throw new Error("Official Sparkle archive signing or verification failed; private output was suppressed"); }
  const after = await hashArchive(path);
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error("Archive changed during signing");
  const record = { schemaVersion: 1, repository: REPOSITORY, version, bundleVersion, minimumMacOS: lock.minimumMacOS,
    url: archiveURL(version), size: before.size, sha256: before.sha256, sourceCommit, archiveSignature };
  record.metadataSignature = sign(null, canonicalRecord(record), key).toString("base64");
  if (!validateSignedRecord(record, lock)) throw new Error("Signed metadata failed its own validation");
  return record;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [assetPath, version, sourceCommit, signUpdatePath, output, ...extra] = process.argv.slice(2);
  if (!output || extra.length) throw new Error("Usage: sign-update-asset.mjs <dmg> <version> <source-commit> <official-sign_update> <new-output.sparkle.json>; seed: FLUXION_SPARKLE_PRIVATE_KEY");
  const record = await signUpdateAsset({ assetPath, version, sourceCommit, signUpdatePath, seed: process.env.FLUXION_SPARKLE_PRIVATE_KEY });
  await writeFile(output, `${JSON.stringify(record, null, 2)}\n`, { flag: "wx", mode: 0o644 });
  console.log(`Signed ${record.version} archive and metadata (${record.size} bytes).`);
}
