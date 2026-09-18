"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), { spawnSync } = require("node:child_process");
const source = fs.readFileSync(require.resolve("../scripts/verify-macos-new-tab.sh"), "utf8");
const functions = source.slice(source.indexOf("owned() {"), source.indexOf("cleanup() {"));

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
    assert.ok(engine.includes(`template="${origin}/search"`));
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
    const foreignStatus = await new Promise((resolve, reject) => {
      require("node:http").get(`${origin}/engine.xml`, { headers: { Host: "foreign.invalid" } }, response => {
        response.resume(); resolve(response.statusCode);
      }).on("error", reject);
    });
    assert.equal(foreignStatus, 400);
    assert.equal((await (await fetch(`${origin}/state`)).json()).requests.length, 2, "Rejected requests must not pollute evidence");
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
