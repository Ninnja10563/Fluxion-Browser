// Maintainer-only signed appcast producer. Importing it never reads a secret.
import { sign } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { FluxionReleaseFeed } from "../modules/FluxionReleaseFeed.sys.mjs";
import { loadSigningLock, privateSigningKey, validateSignedRecord, archiveName, archiveURL } from "./sign-update-asset.mjs";

const HOSTS = new Set(["github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"]);
const xml = value => String(value).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[ch]);
function legacy(version) {
  const [major, minor, patch] = version.split("-")[0].split(".").map(Number);
  return major === 0 && (minor < 70 || minor === 70 && patch === 0);
}
async function fetchRecord(url, fetchImpl, signal) {
  let response;
  for (let hop = 0; hop <= 5; hop++) {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || !HOSTS.has(parsed.hostname) || parsed.username || parsed.password || parsed.port || parsed.hash)
      throw new Error("Unsafe signed metadata redirect");
    response = await fetchImpl(url, { credentials: "omit", referrerPolicy: "no-referrer", redirect: "manual", signal });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const target = response.headers.get("location"); await response.body?.cancel();
    if (!target || hop === 5) throw new Error("Excessive signed metadata redirects");
    url = new URL(target, url).href;
  }
  if (response.status !== 200 || !response.body) throw new Error("Newer release is missing signed update metadata");
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > 16384)) throw new Error("Signed metadata exceeds limit");
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > 16384) throw new Error("Signed metadata exceeds limit");
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
}

export async function buildSparkleFeed(feed, { seed, lock, fetchImpl = fetch, now = () => Date.now() } = {}) {
  lock ||= await loadSigningLock();
  const key = privateSigningKey(seed, lock), checked = FluxionReleaseFeed.validate(feed, now());
  if (!checked) throw new Error("Cannot sign an invalid or expired release feed");
  const signal = AbortSignal.timeout(30000), items = [];
  for (const release of checked.releases) {
    const version = release.tag_name.slice(1);
    if (legacy(version)) continue;
    const record = validateSignedRecord(await fetchRecord(`${archiveURL(version)}.sparkle.json`, fetchImpl, signal), lock);
    const asset = release.assets.find(value => value.name === archiveName(version));
    if (!record || !asset || record.version !== version || record.sourceCommit !== release.sourceCommit ||
        record.url !== asset.browser_download_url || record.size !== asset.size || `sha256:${record.sha256}` !== asset.digest ||
        release.prerelease !== version.includes("-preview.")) throw new Error("Signed archive metadata does not match the verified release");
    items.push(`    <item>\n      <title>Fluxion ${xml(record.version)}</title>\n` +
      `      <pubDate>${xml(new Date(release.published_at).toUTCString())}</pubDate>\n` +
      (release.prerelease ? "      <sparkle:channel>preview</sparkle:channel>\n" : "") +
      `      <sparkle:minimumSystemVersion>${xml(record.minimumMacOS)}</sparkle:minimumSystemVersion>\n` +
      `      <enclosure url="${xml(record.url)}" sparkle:version="${xml(record.bundleVersion)}" sparkle:shortVersionString="${xml(record.version)}" ` +
      `sparkle:installationType="application" sparkle:edSignature="${xml(record.archiveSignature)}" length="${record.size}" type="application/octet-stream"/>\n    </item>\n`);
  }
  const content = Buffer.from('<?xml version="1.0" encoding="utf-8"?>\n<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">\n' +
    '  <channel>\n    <title>Fluxion updates</title>\n    <link>https://github.com/Ninnja10563/Fluxion-Browser/releases</link>\n' + items.join("") + '  </channel>\n</rss>\n', "utf8");
  const signature = sign(null, content, key).toString("base64");
  // Exact pinned Sparkle common_cli/Signing.swift trailer. The length covers
  // only preceding UTF-8 bytes, not this comment or its terminating newline.
  return `${content.toString("utf8")}<!-- sparkle-signatures:\nedSignature: ${signature}\nlength: ${content.length}\n-->\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [input, output, ...extra] = process.argv.slice(2);
  if (!input || !output || extra.length) throw new Error("Usage: build-sparkle-feed.mjs <verified-releases.json> <new-appcast.xml>; seed: FLUXION_SPARKLE_PRIVATE_KEY");
  const result = await buildSparkleFeed(JSON.parse(await readFile(input, "utf8")), { seed: process.env.FLUXION_SPARKLE_PRIVATE_KEY });
  await writeFile(output, result, { flag: "wx", mode: 0o644 });
  console.log("Wrote authenticated Sparkle appcast.");
}
