"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const NOW = Date.parse("2026-09-11T12:00:00.000Z");
const OLD = "a".repeat(40), TREE = "b".repeat(40), NEXT = "c".repeat(40);
const REF = "refs/heads/update-channel";
const ref = value => value ? { ref: REF, object: { type: "commit", sha: value } } : null;
function feed() {
  const tag = "v0.63.0-preview.1", name = "Fluxion-0.63.0-preview.1-macOS-universal.dmg";
  const root = "https://github.com/Ninnja10563/Fluxion-Browser";
  return { schemaVersion: 1, repository: "Ninnja10563/Fluxion-Browser", generatedAt: new Date(NOW).toISOString(),
    expiresAt: new Date(NOW + 86400000).toISOString(), releases: [{ id: 1, tag_name: tag, draft: false,
      prerelease: true, html_url: `${root}/releases/tag/${tag}`, published_at: new Date(NOW - 86400000).toISOString(),
      verifiedAt: new Date(NOW).toISOString(), sourceCommit: OLD,
      assets: [name, `${name}.sha256`].map((name, i) => ({ id: 10 + i, name, size: 100, state: "uploaded",
        digest: `sha256:${"d".repeat(64)}`, browser_download_url: `${root}/releases/download/${tag}/${name}` })) }] };
}
function fixture(head = OLD) {
  const calls = [];
  const f = { calls, head, override: null, build: async () => feed(), now: () => NOW };
  f.api = async (method, path, body) => {
    calls.push({ method, path, body });
    const overridden = await f.override?.(method, path, body);
    if (overridden !== undefined) return overridden;
    if (method === "GET" && path.includes("/ref/")) return ref(f.head);
    if (method === "GET" && path === `/git/commits/${OLD}`) return { sha: OLD, tree: { sha: TREE } };
    if (path === "/git/trees") return { sha: TREE };
    if (path === "/git/commits") return { sha: NEXT };
    if (method === "PATCH" || path === "/git/refs") { f.head = body.sha; return ref(f.head); }
    throw new Error(`Unexpected ${method} ${path}`);
  };
  f.run = async () => (await import("../scripts/publish-release-feed.mjs")).publishReleaseFeed(f);
  return f;
}
test("publisher preserves branch files and fast-forwards from the observed parent", async () => {
  const f = fixture(); assert.equal((await f.run()).commit, NEXT);
  assert.equal(f.calls.find(c => c.path === "/git/trees").body.base_tree, TREE);
  assert.deepEqual(f.calls.find(c => c.path === "/git/commits").body.parents, [OLD]);
  assert.deepEqual(f.calls.find(c => c.method === "PATCH").body, { sha: NEXT, force: false });
  const entries = f.calls.find(c => c.path === "/git/trees").body.tree;
  assert.equal(entries.length, 1); assert.equal(entries[0].path, "releases.json");
  assert.deepEqual(JSON.parse(entries[0].content), feed());
});
test("bootstrap creates an independent feed tree without modifying source branches", async () => {
  const f = fixture(null); await f.run();
  assert.equal(f.calls.some(c => c.method === "PATCH"), false);
  assert.equal(f.calls.find(c => c.path === "/git/trees").body.base_tree, undefined);
  assert.deepEqual(f.calls.find(c => c.path === "/git/commits").body.parents, []);
  assert.deepEqual(f.calls.find(c => c.path === "/git/refs").body, { ref: REF, sha: NEXT });
});
test("failed verification and invalid manifests cause no remote writes", async () => {
  for (const build of [async () => { throw new Error("Download failed"); }, async () => ({}), async () => ({ ...feed(), expiresAt: new Date(NOW).toISOString() })]) {
    const f = fixture(); f.build = build; await assert.rejects(f.run());
    assert.ok(f.calls.every(c => c.method === "GET")); assert.equal(f.head, OLD);
  }
});
test("concurrent branch changes reject publication both after verification and before ref update", async () => {
  for (const at of [2, 3]) {
    const f = fixture(); let reads = 0;
    f.override = (method, path) => {
      if (method === "GET" && path.includes("/ref/") && ++reads === at) return ref("d".repeat(40));
    };
    await assert.rejects(f.run(), /branch changed/);
    assert.ok(f.calls.every(c => c.method !== "PATCH" && c.path !== "/git/refs"));
  }
});
test("publication rejects invalid identities, expiry and non-fast-forward conflicts", async () => {
  for (const kind of ["ref", "tree", "commit", "conflict", "expiry"]) {
    const f = fixture();
    f.override = (method, path) => {
      if (kind === "ref" && path.includes("/ref/")) return { ref: "refs/heads/main", object: { type: "commit", sha: OLD } };
      if (kind === "tree" && path === "/git/trees") return { sha: "bad" };
      if (kind === "commit" && path === "/git/commits") return { sha: "bad" };
      if (kind === "conflict" && method === "PATCH") throw new Error("HTTP 422");
      if (kind === "expiry" && path === "/git/commits") f.now = () => NOW + 2 * 86400000;
    };
    // The injected clock delegates so a mid-publication clock change is visible.
    const clock = () => f.now();
    await assert.rejects((await import("../scripts/publish-release-feed.mjs")).publishReleaseFeed({ ...f, now: clock }));
    assert.equal(f.head, OLD);
  }
});
test("publication API restricts credentials to exact repository routes and rejects redirects/errors", async () => {
  const { repositoryAPI } = await import("../scripts/publish-release-feed.mjs");
  const calls = [];
  const api = repositoryAPI("fixture-secret", async (url, options) => {
    calls.push({ url, options }); return Response.json(ref(OLD));
  });
  await api("GET", "/git/ref/heads/update-channel");
  assert.equal(calls[0].options.redirect, "error"); assert.equal(calls[0].options.credentials, "omit");
  assert.equal(calls[0].options.headers.Authorization, "Bearer fixture-secret");
  for (const path of ["https://evil.invalid", "/git/refs/heads/main", "/releases", "/git/ref/heads/update-channel?token=x"]) {
    await assert.rejects(api("PATCH", path), /Unsupported/);
  }
  assert.equal(calls.length, 1);
  const missing = repositoryAPI("fixture", async () => new Response(null, { status: 404 }));
  assert.equal(await missing("GET", "/git/ref/heads/update-channel"), null);
  await assert.rejects(missing("POST", "/git/refs", {}), /HTTP 404/);
  const redirect = repositoryAPI("fixture", async () => new Response(null, { status: 302 }));
  await assert.rejects(redirect("GET", "/git/ref/heads/update-channel"), /HTTP 302/);
});
