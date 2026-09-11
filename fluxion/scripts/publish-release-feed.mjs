import { pathToFileURL } from "node:url";
import { buildReleaseFeed } from "./build-release-feed.mjs";
import { FluxionReleaseFeed } from "../modules/FluxionReleaseFeed.sys.mjs";

const ROOT = "https://api.github.com/repos/Ninnja10563/Fluxion-Browser";
const REF = "refs/heads/update-channel";
const sha = value => typeof value === "string" && /^[0-9a-f]{40}$/.test(value);
const fail = message => { throw new Error(message); };

export function repositoryAPI(token, fetchImpl = globalThis.fetch) {
  if (!token) fail("Repository token required for feed publication");
  return async (method, path, body) => {
    const allowed = method === "GET" ? /^\/git\/(?:ref\/heads\/update-channel|commits\/[0-9a-f]{40})$/ :
      method === "POST" ? /^\/git\/(?:trees|commits|refs)$/ :
        method === "PATCH" ? /^\/git\/refs\/heads\/update-channel$/ : /$a/;
    if (!allowed.test(path)) fail("Unsupported publication API route");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetchImpl(`${ROOT}${path}`, { method, credentials: "omit", redirect: "error",
        referrerPolicy: "no-referrer", signal: controller.signal,
        headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28",
          Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}) });
      if (method === "GET" && path === "/git/ref/heads/update-channel" && response.status === 404) return null;
      if (response.status !== (method === "POST" ? 201 : 200)) fail(`Publication API HTTP ${response.status}`);
      if (!response.body) fail("Missing publication response");
      const chunks = []; let size = 0;
      for await (const chunk of response.body) {
        size += chunk.byteLength;
        if (size > 1024 * 1024) fail("Oversized publication response");
        chunks.push(chunk);
      }
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
    } finally { clearTimeout(timer); controller.abort(); }
  };
}

/** Publish only verified public metadata. Never rebuild, alter or publish releases. */
export async function publishReleaseFeed({ api, build, now = () => Date.now() }) {
  const readHead = async () => {
    const value = await api("GET", "/git/ref/heads/update-channel");
    if (value === null) return null;
    if (value?.ref !== REF || value.object?.type !== "commit" || !sha(value.object.sha)) fail("Unexpected update branch reference");
    return value.object.sha;
  };
  const before = await readHead();
  const feed = await build();
  if (!FluxionReleaseFeed.validate(feed, now())) fail("Refusing invalid or expired publication feed");
  if (await readHead() !== before) fail("Update branch changed during verification; rerun publication");
  let baseTree;
  if (before) {
    const commit = await api("GET", `/git/commits/${before}`);
    if (commit?.sha !== before || !sha(commit.tree?.sha)) fail("Invalid existing update branch commit");
    baseTree = commit.tree.sha;
  }
  // Preserve any other files on the dedicated branch. Bootstrap has no parent;
  // no source checkout or directory is deleted to create the feed-only tree.
  const tree = await api("POST", "/git/trees", { ...(baseTree ? { base_tree: baseTree } : {}),
    tree: [{ path: "releases.json", mode: "100644", type: "blob", content: `${JSON.stringify(feed, null, 2)}\n` }] });
  if (!sha(tree?.sha)) fail("Invalid published tree identity");
  const commit = await api("POST", "/git/commits", { message: `Refresh verified releases ${feed.generatedAt}`,
    tree: tree.sha, parents: before ? [before] : [] });
  if (!sha(commit?.sha)) fail("Invalid new feed commit identity");
  if (await readHead() !== before) fail("Update branch changed before publication; rerun publication");
  if (!FluxionReleaseFeed.validate(feed, now())) fail("Feed expired before publication");
  const result = before
    ? await api("PATCH", "/git/refs/heads/update-channel", { sha: commit.sha, force: false })
    : await api("POST", "/git/refs", { ref: REF, sha: commit.sha });
  if (result?.ref !== REF || result.object?.sha !== commit.sha || await readHead() !== commit.sha) fail("Published update branch identity mismatch");
  return { commit: commit.sha, releases: feed.releases.map(release => release.tag_name) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.slice(2).join(" ") !== "--publish") fail("Usage: publish-release-feed.mjs --publish");
  const token = process.env.GH_TOKEN || "";
  const result = await publishReleaseFeed({ api: repositoryAPI(token),
    build: () => buildReleaseFeed({ apiToken: token }) });
  console.log(JSON.stringify(result));
}
