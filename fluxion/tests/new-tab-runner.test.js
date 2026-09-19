"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), { spawnSync } = require("node:child_process");
const source = fs.readFileSync(require.resolve("../scripts/verify-macos-new-tab.sh"), "utf8");
const functions = source.slice(source.indexOf("owned() {"), source.indexOf("cleanup() {"));
const verifier = fs.readFileSync(require.resolve("../chrome/fluxion-new-tab-verification.js"), "utf8");
const queryHelper = verifier.slice(verifier.indexOf("  function createQueryTracker() {"), verifier.indexOf("  async function typeAndSettle("));
const createQueryTracker = require("node:vm").runInNewContext(`${queryHelper}\ncreateQueryTracker`);
const keyObserverHelper = verifier.slice(verifier.indexOf("  function observeKeys(owner) {"), verifier.indexOf("  function snapshot(owner) {"));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

test("native close waits for exact-browser final SessionStore flush and always detaches its observer", () => {
  const helper = verifier.slice(verifier.indexOf("  function observeFinalSessionFlush("), verifier.indexOf("  async function verifyEmptyWorkspace("));
  let registration, removed;
  const observe = require("node:vm").runInNewContext(`${helper}\nobserveFinalSessionFlush`, {
    Services: { obs: {
      addObserver(observer, topic) { registration = { observer, topic }; },
      removeObserver(observer, topic) { removed = { observer, topic }; },
    } },
  });
  const browser = {}, tracker = observe(browser);
  assert.equal(registration.topic, "sessionstore-browser-shutdown-flush");
  assert.equal(tracker.complete, false);
  registration.observer({});
  assert.equal(tracker.complete, false, "Another tab's asynchronous flush must not satisfy the close boundary");
  registration.observer(browser);
  assert.equal(tracker.complete, true);
  tracker.dispose();
  assert.deepEqual(removed, registration);
  assert.match(verifier, /finally \{ flush\.dispose\(\); \}/);
});

test("native key evidence passively observes the separate Gecko system group and rejects synthetic input", () => {
  const report = { keys: [] };
  const observe = require("node:vm").runInNewContext(`${keyObserverHelper}\nobserveKeys`, { report, privateWindow: null });
  let registration;
  const owner = { gBrowser: { tabs: [1, 2] }, FluxionNewTab: { pending: false },
    addEventListener(type, listener, options) { registration = { type, listener, options }; } };
  observe(owner);
  assert.equal(registration.type, "keydown");
  assert.deepEqual(JSON.parse(JSON.stringify(registration.options)), {
    capture: true, mozSystemGroup: true, passive: true, wantUntrusted: false,
  });
  const event = { key: "Escape", isTrusted: true, metaKey: false,
    preventDefault() { throw Error("Observer must not interfere with native input"); },
    stopPropagation() { throw Error("Observer must not stop native input"); },
    stopImmediatePropagation() { throw Error("Observer must not stop native input"); } };
  registration.listener({ ...event, isTrusted: false });
  assert.equal(report.keys.length, 0);
  registration.listener(event);
  assert.equal(report.keys.length, 1);
  assert.equal(report.keys[0].key, "Escape");
  assert.equal(report.keys[0].tabs, 2);
  registration.listener({ ...event, key: "t" });
  assert.equal(report.keys.length, 1, "Typed query letters must not crowd out command evidence");
  registration.listener({ ...event, key: "w", metaKey: true });
  assert.equal(report.keys.length, 2);
  assert.equal(report.keys[1].key, "w");
  assert.equal(report.keys[1].command, true);
  for (let index = 0; index < 100; index++) registration.listener(event);
  assert.equal(report.keys.length, 80, "Evidence remains bounded");
});

test("empty workspace evidence captures only four bounded normal/private states after foreground ownership checks", () => {
  for (const state of ["ordinary-empty", "ordinary-draft", "private-empty", "private-draft"]) {
    assert.ok(source.includes(`capture-${state}`));
    assert.ok(verifier.includes(`"capture-${state}"`));
  }
  assert.match(source, /owned \|\| exit 1\n\s+\/usr\/sbin\/screencapture -x "\$artifact_dir\/\$action\.png"\n\s+\[\[ -s "\$artifact_dir\/\$action\.png" \]\] \|\| exit 1/);
  assert.match(source, /Wrong foreground process/);
  assert.match(verifier, /capture-\$\{label\}-empty/);
  assert.match(verifier, /capture-\$\{label\}-draft/);
  assert.match(source, /sequence <= 80/);
});

test("native query tracking discards already-rejected predecessor state on replacement", async () => {
  const tracker = createQueryTracker(), old = deferred(), current = deferred();
  tracker.observe(old.promise);
  old.reject(Error("old query cancelled"));
  await Promise.resolve();
  assert.equal(tracker.observe(old.promise).status, "rejected");
  assert.equal(tracker.observe(current.promise).status, "pending");
  current.resolve({ searchString: "new input" });
  await Promise.resolve();
  const state = tracker.observe(current.promise);
  assert.equal(state.status, "resolved");
  assert.equal(state.context.searchString, "new input");
  assert.equal(state.promise, current.promise);
});

test("native query tracking ignores late predecessor rejection but preserves actual current failure", async () => {
  const tracker = createQueryTracker(), old = deferred(), current = deferred();
  tracker.observe(old.promise);
  tracker.observe(current.promise);
  old.reject(Error("late old cancellation"));
  await Promise.resolve();
  assert.equal(tracker.observe(current.promise).status, "pending");
  const failure = Error("real current query error");
  current.reject(failure);
  await Promise.resolve();
  assert.equal(tracker.observe(current.promise).status, "rejected");
  assert.equal(tracker.observe(current.promise).error, failure);
});

function run(body) {
  const result = spawnSync("bash", ["-c", `set -euo pipefail
app='/fixture/Fluxion.app'
launcher="$app/Contents/MacOS/Fluxion"
profile='/fixture/isolated/profile'
browser_pid=4321
phase=launcher
alive=true
polls=0
signals=0
parent_mode=owned
ps() {
  if [[ "$*" == *'ppid='* ]]; then
    if [[ "$parent_mode" == owned ]]; then printf '  %s\\n' "$$"; else printf '1\\n'; fi
  elif [[ "$phase" == launcher ]]; then printf '%s about:blank\\n' "$launcher"
  elif [[ "$phase" == browser ]]; then printf '%s/Contents/MacOS/firefox --profile %s about:blank\\n' "$app" "$profile"
  elif [[ "$phase" == foreign ]]; then printf '%s/Contents/MacOS/firefox --profile /other/profile\\n' "$app"
  else printf '/unrelated/program\\n'
  fi
}
kill() {
  if [[ "$1" == -0 ]]; then [[ "$alive" == true ]]; return; fi
  signals=$((signals + 1)); alive=false
}
wait() { return 0; }
sleep() { polls=$((polls + 1)); }
${functions}
${body}`], { encoding: "utf8", timeout: 5000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

test("new tab driver waits for its exact Gecko profile before native keyboard input", () => {
  run(`sleep() { polls=$((polls + 1)); if (( polls == 3 )); then phase=browser; fi; }
if owned; then exit 2; fi
wait_for_owned_browser
owned
[[ "$polls" == 3 && "$signals" == 0 ]]`);
  assert.match(source, /browser_pid=\$!\nwait_for_owned_browser \|\| exit 1\nsequence=1/);
});

test("new tab driver bounds startup and will not kill an unrelated process or profile", () => {
  run(`phase=foreign
if wait_for_owned_browser; then exit 2; fi
[[ "$polls" == 120 && "$signals" == 0 ]]
cleanup_browser
[[ "$signals" == 0 ]]`);
  run(`parent_mode=foreign
cleanup_browser
[[ "$signals" == 0 ]]`);
  run(`cleanup_browser
[[ "$signals" == 1 && "$alive" == false ]]`);
  run(`phase=browser
cleanup_browser
[[ "$signals" == 1 && "$alive" == false ]]`);
});

test("native new tab fixture supplies actual POST OpenSearch and records bounded request bodies", async () => {
  const { startFixture } = await import("../scripts/new-tab-fixture.mjs");
  const { server, origin } = await startFixture();
  try {
    const engine = await (await fetch(`${origin}/engine.xml`)).text();
    assert.match(engine, /method="POST"/);
    assert.ok(engine.includes(`template="http://fluxion-new-tab.example.com:${new URL(origin).port}/search"`));
    assert.match(engine, /name="q" value="\{searchTerms\}"/);
    assert.equal((await fetch(`${origin}/page?case=source`)).status, 200);
    assert.equal((await fetch(`${origin}/search`, { method: "POST", body: "q=fluxion+native+post+proof" })).status, 200);
    assert.deepEqual((await (await fetch(`${origin}/state`)).json()).requests, [
      { method: "GET", path: "/page", query: "?case=source", body: "" },
      { method: "POST", path: "/search", query: "", body: "q=fluxion+native+post+proof" },
    ]);
    assert.equal((await fetch(`${origin}/search`)).status, 405);
    assert.equal((await fetch(`${origin}/search`, { method: "POST", body: "x".repeat(2049) })).status, 413);
    assert.equal((await fetch(`${origin}/page`, { method: "POST" })).status, 405);
    const requestHost = host => new Promise((resolve, reject) => {
      require("node:http").get(`${origin}/engine.xml`, { headers: { Host: host } }, response => {
        response.resume(); resolve(response.statusCode);
      }).on("error", reject);
    });
    assert.equal(await requestHost("foreign.invalid"), 400);
    assert.equal(await requestHost(`fluxion-new-tab.example.com:${new URL(origin).port}`), 200);
    assert.equal(await requestHost("fluxion-new-tab.example.com:1"), 400);
    assert.equal(await requestHost(`other.example.com:${new URL(origin).port}`), 400);
    assert.equal((await (await fetch(`${origin}/state`)).json()).requests.length, 2, "Rejected requests must not pollute evidence");
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
