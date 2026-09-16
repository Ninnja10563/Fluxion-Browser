// Maintainer-only, explicitly invoked provisioning. Never imported by the app.
import { randomBytes, createPrivateKey, createPublicKey } from "node:crypto";
import { mkdtempSync, realpathSync, writeFileSync, statSync } from "node:fs";
import { resolve, relative, sep, join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

export function publicKeyForSeed(seed) {
  if (!Buffer.isBuffer(seed) || seed.length !== 32) throw new Error("An Ed25519 seed must have 32 bytes");
  const key = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]),
    format: "der", type: "pkcs8" });
  return createPublicKey(key).export({ format: "der", type: "spki" }).subarray(-32).toString("base64");
}

export function provision(parent, { run = execFileSync } = {}) {
  const repository = "Ninnja10563/Fluxion-Browser", secretName = "FLUXION_SPARKLE_PRIVATE_KEY";
  const workspace = realpathSync(resolve(fileURLToPath(new URL("../..", import.meta.url))));
  const directory = realpathSync(resolve(parent));
  const inside = relative(workspace, directory);
  if (!inside || (!inside.startsWith(`..${sep}`) && inside !== ".." && !inside.startsWith(sep)))
    throw new Error("Signing backup must be outside the source checkout");
  if (!statSync(directory).isDirectory()) throw new Error("Backup parent must be a directory");
  const secrets = JSON.parse(run("gh", ["secret", "list", "--repo", repository, "--json", "name"], { encoding: "utf8" }));
  if (!Array.isArray(secrets) || secrets.some(item => item.name === secretName))
    throw new Error("Refusing to replace an existing update signing key");
  const backup = mkdtempSync(join(directory, "fluxion-update-signing-"));
  const keyPath = join(backup, "sparkle-private-seed.txt");
  const seed = randomBytes(32), publicKey = publicKeyForSeed(seed);
  // Sparkle's current exported-key format is the base64-encoded 32-byte seed.
  // The file is created first so a failed upload never loses the recovery key.
  writeFileSync(keyPath, seed.toString("base64"), { flag: "wx", mode: 0o600 });
  writeFileSync(join(backup, "public-key.txt"), `${publicKey}\n`, { flag: "wx", mode: 0o600 });
  try {
    run("gh", ["secret", "set", secretName, "--repo", repository], {
      input: seed.toString("base64"), encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (_) {
    throw new Error(`Secret upload failed; recovery key remains at ${keyPath}. No key material was logged.`);
  } finally { seed.fill(0); }
  return { repository, secretName, publicKey, backup: keyPath };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 4 || process.argv[2] !== "--backup-parent")
    throw new Error("Usage: provision-update-key.mjs --backup-parent <existing-directory-outside-checkout>");
  // Output contains public metadata and the backup location, never the private seed.
  console.log(JSON.stringify(provision(process.argv[3]), null, 2));
}
