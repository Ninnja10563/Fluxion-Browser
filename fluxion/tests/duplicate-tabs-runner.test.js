"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), { spawnSync } = require("node:child_process");
const source = fs.readFileSync(require.resolve("../scripts/verify-macos-duplicate-tabs.sh"), "utf8");
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

test("duplicate runner waits for exact isolated Gecko ownership before native automation", () => {
  assert.equal(run(`sleep() { polls=$((polls + 1)); if (( polls == 4 )); then phase=browser; fi; }
if owned; then exit 2; fi
wait_for_owned_browser
owned
[[ "$polls" == 4 && "$signals" == 0 ]]
printf ready`), "ready");
  assert.match(source, /browser_pid=\$!\nwait_for_owned_browser \|\| exit 1\nsequence=1/);
});

test("duplicate runner bounds startup and never automates or terminates another profile", () => {
  run(`alive=false
if wait_for_owned_browser; then exit 2; fi
[[ "$polls" == 0 && "$signals" == 0 ]]`);
  run(`phase=foreign
if wait_for_owned_browser; then exit 2; fi
[[ "$polls" == 120 && "$signals" == 0 ]]
cleanup_browser
[[ "$signals" == 0 ]]`);
});

test("duplicate runner cleanup is limited to direct launcher child or exact owned profile", () => {
  run(`cleanup_browser
[[ "$signals" == 1 && "$alive" == false ]]`);
  run(`parent_mode=foreign
cleanup_browser
[[ "$signals" == 0 && "$alive" == true ]]`);
  run(`phase=browser
cleanup_browser
[[ "$signals" == 1 && "$alive" == false ]]`);
});

test("duplicate loopback fixture refuses foreign hosts and methods and records bounded event categories", async () => {
  const { startFixture } = await import("../scripts/duplicate-tabs-fixture.mjs");
  const { server, origin } = await startFixture();
  try {
    const foreignStatus = await new Promise((resolve, reject) => {
      require("node:http").get(`${origin}/page`, { headers: { Host: "foreign.invalid" } }, response => {
        response.resume(); resolve(response.statusCode);
      }).on("error", reject);
    });
    assert.equal(foreignStatus, 400);
    assert.equal((await fetch(`${origin}/page`, { method: "POST" })).status, 405);
    assert.equal((await fetch(`${origin}/unknown`)).status, 404);
    assert.equal((await fetch(`${origin}/event?name=foreign`, { method: "POST" })).status, 400);
    for (const name of ["armed", "unload", "unload"]) {
      assert.equal((await fetch(`${origin}/event?name=${name}`, { method: "POST" })).status, 204);
    }
    assert.deepEqual(await (await fetch(`${origin}/state`)).json(), { armed: 1, unload: 2 });
    const page = await (await fetch(`${origin}/page?case=test#fragment`)).text();
    assert.match(page, /event\.isTrusted/);
    assert.match(page, /navigator\.userActivation\.isActive/);
    assert.match(page, /beforeunload/);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
