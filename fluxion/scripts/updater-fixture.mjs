// Test-only fixture ownership and loopback server. No production update key or
// user-controlled network destination is accepted by this module.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const ORIGIN = "http://127.0.0.1:38473";
export const OLD_VERSION = "1.0.0b1";
export const NEW_VERSION = "1.0.1b1";
export const RELEASE = "1.0.1-preview.1";
const OWNER = ".fluxion-updater-gate-owner.json";
const stages = new Set(["wrong-sign", "corrupt", "valid"]);
const read = filename => JSON.parse(fs.readFileSync(filename, "utf8"));
const write = (filename, value) => fs.writeFileSync(filename, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });

export function claimProfile(root, home = os.homedir()) {
  root = fs.realpathSync(root); home = fs.realpathSync(home);
  if (!/^fluxion-updater-check\.[A-Za-z0-9]{6}$/.test(path.basename(root))) throw Error("Updater gate requires its owned temporary namespace");
  const profile = path.join(home, "Library/Application Support/Fluxion/Profiles/default");
  if (fs.existsSync(profile) || fs.existsSync(path.join(root, "gate.json"))) throw Error("Refusing an existing default profile or fixture");
  let current = home;
  for (const component of ["Library", "Application Support", "Fluxion", "Profiles"]) {
    current = path.join(current, component);
    if (!fs.existsSync(current)) fs.mkdirSync(current, { mode: 0o700 });
    if (!fs.lstatSync(current).isDirectory() || fs.realpathSync(current) !== current) throw Error("Default profile parent is not a canonical directory");
  }
  fs.mkdirSync(profile, { mode: 0o700 }); // exclusive, never recursively reuse a profile
  const config = { schema: 1, root, profile, token: crypto.randomBytes(24).toString("hex"),
    oldVersion: OLD_VERSION, newVersion: NEW_VERSION, release: RELEASE,
    app: path.join(root, "live", "Fluxion.app") };
  write(path.join(profile, OWNER), { root, token: config.token });
  write(path.join(root, "gate.json"), config);
  fs.writeFileSync(path.join(profile, "user.js"), 'user_pref("fluxion.verification.nativeUpdater", true);\n', { flag: "wx", mode: 0o600 });
  for (const name of ["signing", "wrong"]) {
    const pair = crypto.generateKeyPairSync("ed25519");
    const privateDER = pair.privateKey.export({ type: "pkcs8", format: "der" });
    if (privateDER.length !== 48 || privateDER.subarray(0, 16).toString("hex") !== "302e020100300506032b657004220420") throw Error("Unexpected Ed25519 seed encoding");
    fs.writeFileSync(path.join(root, `${name}.key`), privateDER.subarray(16).toString("base64"), { flag: "wx", mode: 0o600 });
    if (name === "signing") fs.writeFileSync(path.join(root, "public-key.txt"), pair.publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("base64"), { flag: "wx", mode: 0o600 });
  }
  return config;
}

export function releaseProfile(root) {
  root = fs.realpathSync(root);
  const config = read(path.join(root, "gate.json"));
  const expected = path.join(fs.realpathSync(os.homedir()), "Library/Application Support/Fluxion/Profiles/default");
  if (config.root !== root || config.profile !== expected || !/^fluxion-updater-check\.[A-Za-z0-9]{6}$/.test(path.basename(root))) throw Error("Refusing mismatched updater fixture cleanup");
  if (!fs.existsSync(expected)) return;
  const owner = read(path.join(expected, OWNER));
  if (fs.realpathSync(expected) !== expected || owner.root !== root || owner.token !== config.token || !/^[a-f0-9]{48}$/.test(owner.token)) throw Error("Default profile ownership changed; leaving it untouched");
  fs.rmSync(expected, { recursive: true });
}

export function makeFeeds(root, signTool) {
  const sign = (key, filename) => {
    const result = spawnSync(signTool, ["--ed-key-file", path.join(root, `${key}.key`), "-p", filename], { encoding: "utf8", timeout: 90000 });
    if (result.status !== 0) throw Error(`Sparkle fixture signing failed: ${String(result.stderr).slice(0, 400)}`);
    return result.stdout.trim();
  };
  const archive = path.join(root, "payload.zip"), size = fs.statSync(archive).size;
  const validSignature = sign("signing", archive), wrongSignature = sign("wrong", archive);
  if (![validSignature, wrongSignature].every(value => /^[A-Za-z0-9+/]{86}==$/.test(value))) throw Error("Invalid fixture archive signature");
  fs.copyFileSync(archive, path.join(root, "corrupt.zip"), fs.constants.COPYFILE_EXCL);
  const descriptor = fs.openSync(path.join(root, "corrupt.zip"), "r+");
  try {
    const at = Math.floor(size / 2), byte = Buffer.alloc(1);
    fs.readSync(descriptor, byte, 0, 1, at); byte[0] ^= 0xff; fs.writeSync(descriptor, byte, 0, 1, at);
  } finally { fs.closeSync(descriptor); }
  for (const stage of stages) {
    const xml = `<?xml version="1.0" encoding="utf-8"?>\n<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle"><channel><title>Fluxion isolated updater gate</title><item><title>Updater fixture</title><pubDate>${new Date().toUTCString()}</pubDate><sparkle:version>${NEW_VERSION}</sparkle:version><sparkle:shortVersionString>${RELEASE}</sparkle:shortVersionString><sparkle:channel>preview</sparkle:channel><sparkle:minimumSystemVersion>12.0</sparkle:minimumSystemVersion><enclosure url="${ORIGIN}/releases/${stage}.zip" length="${size}" type="application/octet-stream" sparkle:installationType="application" sparkle:edSignature="${stage === "wrong-sign" ? wrongSignature : validSignature}" /></item></channel></rss>\n`;
    const filename = path.join(root, `${stage}.xml`);
    fs.writeFileSync(filename, xml, { flag: "wx", mode: 0o600 }); sign("signing", filename);
  }
  fs.writeFileSync(path.join(root, "stage"), "wrong-sign", { flag: "wx", mode: 0o600 });
}

export function fixtureHandler(root, records) {
  return (request, response) => {
    if (!["GET", "HEAD"].includes(request.method)) { response.writeHead(405); response.end(); return; }
    let stage;
    try { stage = fs.readFileSync(path.join(root, "stage"), "utf8").trim(); } catch (_) {}
    if (!stages.has(stage)) { response.writeHead(503); response.end(); return; }
    let filename;
    if (request.url === "/feed/appcast.xml") filename = `${stage}.xml`;
    else if (request.url === `/releases/${stage}.zip`) filename = stage === "corrupt" ? "corrupt.zip" : "payload.zip";
    if (!filename) { response.writeHead(404); response.end(); return; }
    const file = path.join(root, filename), size = fs.statSync(file).size;
    const record = { stage, path: request.url, method: request.method, bytes: size, completed: false };
    if (records.length < 100) records.push(record);
    response.setHeader("Cache-Control", "no-store"); response.setHeader("Content-Length", size);
    response.setHeader("Content-Type", filename.endsWith(".xml") ? "application/xml" : "application/zip");
    response.once("finish", () => { record.completed = true; fs.writeFileSync(path.join(root, "network.json"), JSON.stringify(records)); });
    response.writeHead(200);
    if (request.method === "HEAD") response.end();
    else fs.createReadStream(file).on("error", () => response.destroy()).pipe(response);
  };
}

async function main() {
  const [action, root, argument] = process.argv.slice(2);
  if (action === "claim") { claimProfile(root); return; }
  if (action === "release") { releaseProfile(root); return; }
  if (action === "feeds") { makeFeeds(root, argument); return; }
  if (action === "serve") {
    const server = http.createServer(fixtureHandler(root, []));
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(38473, "127.0.0.1", resolve); });
    fs.writeFileSync(path.join(root, "server.ready"), String(process.pid), { flag: "wx", mode: 0o600 });
    for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));
    return;
  }
  throw Error("usage: updater-fixture.mjs claim|release|feeds|serve ROOT [SIGN_TOOL]");
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
