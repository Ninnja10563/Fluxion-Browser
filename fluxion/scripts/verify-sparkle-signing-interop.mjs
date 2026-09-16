// Native macOS interoperability gate: ephemeral key only, no published assets,
// network, installed app, keychain, default browser, or profile modifications.
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { archiveName, signUpdateAsset } from "./sign-update-asset.mjs";
import { buildSparkleFeed } from "./build-sparkle-feed.mjs";

export async function verifySparkleSigningInterop(signUpdatePath) {
  if (process.platform !== "darwin") throw new Error("Official Sparkle signing interoperability requires macOS");
  const tool = resolve(signUpdatePath), directory = await mkdtemp(join(tmpdir(), "fluxion-signing-interop-"));
  const pair = generateKeyPairSync("ed25519");
  const seed = pair.privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32);
  try {
    const lock = { minimumMacOS: "12.0", publicKey: pair.publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64") };
    const version = "0.70.1-preview.1", name = archiveName(version), sourceCommit = "a".repeat(40);
    const assetPath = join(directory, name);
    await writeFile(assetPath, "Fluxion isolated signing interoperability fixture\n", { flag: "wx", mode: 0o600 });
    const record = await signUpdateAsset({ assetPath, version, sourceCommit, signUpdatePath: tool, seed, lock });
    const now = Date.now(), timestamp = new Date(now).toISOString();
    const feed = { schemaVersion: 1, repository: "Ninnja10563/Fluxion-Browser", generatedAt: timestamp,
      expiresAt: new Date(now + 86400000).toISOString(), releases: [{ id: 1, tag_name: `v${version}`, draft: false, prerelease: true,
        html_url: `https://github.com/Ninnja10563/Fluxion-Browser/releases/tag/v${version}`,
        published_at: timestamp, verifiedAt: timestamp, sourceCommit,
        assets: [{ id: 11, name, size: record.size, state: "uploaded", digest: `sha256:${record.sha256}`, browser_download_url: record.url },
          { id: 12, name: `${name}.sha256`, size: 100, state: "uploaded", digest: `sha256:${"b".repeat(64)}`, browser_download_url: `${record.url}.sha256` }] }] };
    const appcast = await buildSparkleFeed(feed, { seed, lock, now: () => now, fetchImpl: async url => {
      if (url !== `${record.url}.sparkle.json`) throw new Error("Unexpected interoperability fixture request");
      return Response.json(record);
    } });
    const path = join(directory, "appcast.xml");
    await writeFile(path, appcast, { flag: "wx", mode: 0o600 });
    const env = { ...process.env }; delete env.FLUXION_SPARKLE_PRIVATE_KEY;
    const verify = () => execFileSync(tool, ["--ed-key-file", "-", "--verify", path], {
      input: seed.toString("base64") + "\n", encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], env, timeout: 30000, maxBuffer: 4096,
    });
    try { verify(); }
    catch (_) { throw new Error("Official Sparkle rejected the Node-produced signed appcast"); }
    await writeFile(path, appcast.replace("<title>Fluxion updates</title>", "<title>Changed updates</title>"), { mode: 0o600 });
    let rejected = false;
    try { verify(); } catch (_) { rejected = true; }
    if (!rejected) throw new Error("Official Sparkle accepted modified signed appcast bytes");
    return { health: "official-sparkle-signing-interop-verified", archiveSignedAndVerified: true,
      nodeFeedAcceptedByOfficialSparkle: true, alteredFeedRejected: true, ephemeralKeyOnly: true };
  } finally { seed.fill(0); await rm(directory, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [tool, output, ...extra] = process.argv.slice(2);
  if (!tool || extra.length) throw new Error("Usage: verify-sparkle-signing-interop.mjs <reviewed-sign_update> [new-report.json]");
  const report = await verifySparkleSigningInterop(tool);
  if (output) await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx", mode: 0o644 });
  console.log(JSON.stringify(report));
}
