"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { pathToFileURL } = require("node:url");
const fixture = import(pathToFileURL(path.resolve(__dirname, "../scripts/updater-fixture.mjs")));

test("updater fixture claims only an absent canonical default profile and never adopts existing user data", async () => {
  const { claimProfile } = await fixture;
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fluxion-updater-policy-")));
  try {
    const home = path.join(base, "home"); fs.mkdirSync(home);
    const root = fs.mkdtempSync(path.join(base, "fluxion-updater-check."));
    const config = claimProfile(root, home);
    assert.equal(config.profile, path.join(home, "Library/Application Support/Fluxion/Profiles/default"));
    assert.match(config.token, /^[a-f0-9]{48}$/);
    assert.equal(fs.statSync(config.profile).mode & 0o777, 0o700);
    assert.equal(fs.statSync(path.join(root, "signing.key")).mode & 0o777, 0o600);
    assert.equal(Buffer.from(fs.readFileSync(path.join(root, "signing.key"), "utf8"), "base64").length, 32);
    assert.equal(Buffer.from(fs.readFileSync(path.join(root, "public-key.txt"), "utf8"), "base64").length, 32);
    fs.writeFileSync(path.join(config.profile, "user-data"), "must remain unchanged");
    const other = fs.mkdtempSync(path.join(base, "fluxion-updater-check."));
    assert.throws(() => claimProfile(other, home), /existing default profile/);
    assert.equal(fs.readFileSync(path.join(config.profile, "user-data"), "utf8"), "must remain unchanged");
    assert.equal(fs.existsSync(path.join(other, "gate.json")), false);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test("updater fixture rejects symlinked default-profile parents before claiming or generating keys", async () => {
  const { claimProfile } = await fixture;
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fluxion-updater-policy-")));
  try {
    const home = path.join(base, "home"), outside = path.join(base, "outside");
    fs.mkdirSync(home); fs.mkdirSync(outside); fs.symlinkSync(outside, path.join(home, "Library"));
    const root = fs.mkdtempSync(path.join(base, "fluxion-updater-check."));
    assert.throws(() => claimProfile(root, home), /canonical directory/);
    assert.deepEqual(fs.readdirSync(outside), []);
    assert.deepEqual(fs.readdirSync(root), []);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test("updater loopback handler serves only the selected immutable signed-feed/archive pair", async () => {
  const { fixtureHandler } = await fixture;
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fluxion-updater-server-"))), records = [];
  const completions = [], handler = fixtureHandler(root, records);
  const server = http.createServer((request, response) => {
    // Client 'end' may precede the server's 'finish' callback on macOS. Observe
    // actual server completion, after the handler has persisted its evidence.
    handler(request, response);
    completions.push(new Promise(resolve => response.once("finish", resolve)));
  });
  const request = (resource, method = "GET") => new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port: server.address().port, path: resource, method }, response => {
      const chunks = []; response.on("data", value => chunks.push(value)); response.on("end", () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString(), headers: response.headers }));
    }); req.on("error", reject); req.end();
  });
  try {
    for (const stage of ["wrong-sign", "corrupt", "valid"]) fs.writeFileSync(path.join(root, `${stage}.xml`), `signed-${stage}`);
    fs.writeFileSync(path.join(root, "payload.zip"), "real-archive-bytes");
    fs.writeFileSync(path.join(root, "corrupt.zip"), "corrupted-archive");
    fs.writeFileSync(path.join(root, "stage"), "wrong-sign");
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const first = await request("/feed/appcast.xml");
    assert.equal(first.body, "signed-wrong-sign"); assert.equal(first.headers["cache-control"], "no-store");
    assert.equal((await request("/releases/wrong-sign.zip")).body, "real-archive-bytes");
    assert.equal((await request("/releases/valid.zip")).status, 404);
    assert.equal((await request("/feed/appcast.xml?stage=valid")).status, 404);
    assert.equal((await request("/feed/appcast.xml", "POST")).status, 405);
    assert.equal((await request("/signing.key")).status, 404);
    fs.writeFileSync(path.join(root, "stage"), "corrupt");
    assert.equal((await request("/releases/corrupt.zip")).body, "corrupted-archive");
    assert.equal((await request("/releases/wrong-sign.zip")).status, 404);
    fs.writeFileSync(path.join(root, "stage"), "valid");
    assert.equal((await request("/feed/appcast.xml")).body, "signed-valid");
    assert.equal((await request("/releases/valid.zip")).body, "real-archive-bytes");
    let completionTimeout;
    try {
      await Promise.race([Promise.all(completions), new Promise((_, reject) => {
        completionTimeout = setTimeout(() => reject(Error("Fixture responses did not finish")), 2000);
      })]);
    } finally { clearTimeout(completionTimeout); }
    assert.ok(records.every(record => record.completed && record.bytes > 0));
    assert.equal(records.length, 5);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, "network.json"), "utf8")), records);
    fs.writeFileSync(path.join(root, "stage"), "../../signing.key");
    assert.equal((await request("/feed/appcast.xml")).status, 503);
  } finally {
    await new Promise(resolve => server.close(resolve)); fs.rmSync(root, { recursive: true, force: true });
  }
});
