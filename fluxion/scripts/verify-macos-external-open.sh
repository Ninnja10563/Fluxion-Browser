#!/usr/bin/env bash
set -euo pipefail
[[ "$(uname -s)" == Darwin ]] || { printf 'LaunchServices verification requires macOS.\n' >&2; exit 69; }
fluxion_root="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
app_input="${1:-$fluxion_root/../.runtime/Fluxion.app}"
app="$(CDPATH= cd -- "$app_input" && pwd -P)"
[[ -x "$app/Contents/MacOS/Fluxion" ]] || { printf 'Missing packaged Fluxion application.\n' >&2; exit 69; }
open_help="$(/usr/bin/open --help 2>&1 || true)"
[[ "$open_help" == *"--env"* ]] || { printf 'This macOS open tool cannot supply an isolated per-process environment.\n' >&2; exit 69; }
check_root="$(mktemp -d "${TMPDIR:-/tmp}/fluxion-external-open.XXXXXX")"
profile="$check_root/profile"
server_log="$check_root/server.log"
browser_log="$check_root/browser.log"
browser_error="$check_root/browser-error.log"
local_file="$check_root/Fluxion café document.html"
server_pid=""
opener_pid=""
forwarder_pid=""

owned_browser_pids() {
  # Never signal by application name or bundle id. Validate both the exact
  # executable and this fixture's unique profile in the operating-system argv.
  ps -axww -o pid= -o command= | node -e '
    let input=""; process.stdin.on("data", chunk=>input+=chunk); process.stdin.on("end",()=>{
      for(const line of input.split("\n")) {
        const row=line.match(/^\s*(\d+)\s+(.*)$/); if(!row)continue;
        if(row[2].startsWith(process.argv[1]+"/Contents/MacOS/firefox ") &&
           (row[2].includes("--profile "+process.argv[2]+" ") ||
            row[2].endsWith("--profile "+process.argv[2]))) console.log(row[1]);
      }
    });' "$app" "$profile"
}
cleanup() {
  local pid
  for pid in $(owned_browser_pids); do
    kill "$pid" 2>/dev/null || true
    for ((attempt=0; attempt<40; attempt++)); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.25
    done
    if kill -0 "$pid" 2>/dev/null && owned_browser_pids | grep -Fxq "$pid"; then
      kill -KILL "$pid" 2>/dev/null || true
    fi
  done
  for pid in "$forwarder_pid" "$opener_pid" "$server_pid"; do
    [[ -z "$pid" ]] || kill "$pid" 2>/dev/null || true
    [[ -z "$pid" ]] || wait "$pid" 2>/dev/null || true
  done
  case "$check_root" in
    "${TMPDIR:-/tmp}"/fluxion-external-open.*) rm -rf -- "$check_root" ;;
    *) printf 'Refusing unsafe external-open cleanup path: %s\n' "$check_root" >&2 ;;
  esac
}
trap cleanup EXIT
cp "$fluxion_root/tests/fixtures/external-open.html" "$local_file"
file_url="$(node -e 'console.log(require("node:url").pathToFileURL(require("node:fs").realpathSync(process.argv[1])).href)' "$local_file")"
node "$fluxion_root/scripts/browsing-fixture.mjs" 0 >"$server_log" 2>&1 &
server_pid=$!
for ((attempt=0; attempt<80; attempt++)); do
  if [[ -s "$server_log" ]] && node -e '
    try {const row=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8").split("\n")[0]);
      process.exit(/^http:\/\/127\.0\.0\.1:\d+$/.test(row.origin)?0:1);} catch {process.exit(1)}' "$server_log"; then break; fi
  kill -0 "$server_pid" 2>/dev/null || { printf 'Loopback fixture stopped.\n' >&2; exit 1; }
  sleep 0.1
done
(( attempt < 80 )) || { printf 'Loopback fixture did not start.\n' >&2; exit 1; }
origin="$(node -e 'console.log(JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8").split("\n")[0]).origin)' "$server_log")"

wait_stage() {
  local expected="$1"
  for ((attempt=0; attempt<160; attempt++)); do
    if [[ -f "$profile/prefs.js" ]]; then
      if grep -Fq 'user_pref("fluxion.externalOpen.error"' "$profile/prefs.js"; then break; fi
      if grep -Fq "$expected" "$profile/prefs.js"; then return 0; fi
    fi
    sleep 0.25
  done
  printf 'LaunchServices verification failed waiting for: %s\n' "$expected" >&2
  [[ ! -f "$profile/prefs.js" ]] || grep 'fluxion\.externalOpen\.' "$profile/prefs.js" >&2 || true
  [[ ! -f "$browser_log" ]] || sed -n '1,100p' "$browser_log" >&2
  [[ ! -f "$browser_error" ]] || sed -n '1,100p' "$browser_error" >&2
  return 1
}

# -n is only for the cold launch, isolating this process from an installed app.
# Warm sends deliberately omit -n so LaunchServices must reach the same app.
/usr/bin/open -n -W -a "$app" \
  --env "FLUXION_PROFILE=$profile" --env "FLUXION_EXTERNAL_OPEN_TEST=1" \
  --env "FLUXION_EXTERNAL_OPEN_ORIGIN=$origin" --env "FLUXION_EXTERNAL_OPEN_FILE_URL=$file_url" \
  --stdout "$browser_log" --stderr "$browser_error" "$origin/" &
opener_pid=$!
wait_stage 'user_pref("fluxion.externalOpen.stage", "cold-url-rendered")'
original_pid="$(node -e 'const text=require("node:fs").readFileSync(process.argv[1],"utf8"); const match=text.match(/user_pref\("fluxion\.externalOpen\.pid", (\d+)\)/); if(!match)process.exit(1);console.log(match[1]);' "$profile/prefs.js")"
/usr/bin/open -a "$app" "$origin/upload"
wait_stage 'user_pref("fluxion.externalOpen.stage", "warm-url-rendered")'
/usr/bin/open -a "$app" "$local_file"
wait_stage 'user_pref("fluxion.externalOpen.stage", "local-file-rendered")'
FLUXION_PROFILE="$profile" "$app/Contents/MacOS/Fluxion" "$origin/?fluxion-external-cli=1" >>"$browser_log" 2>>"$browser_error" &
forwarder_pid=$!
for ((attempt=0; attempt<80; attempt++)); do
  kill -0 "$forwarder_pid" 2>/dev/null || break
  sleep 0.25
done
(( attempt < 80 )) || { printf 'Direct URL forwarding did not exit within 20 seconds.\n' >&2; exit 1; }
wait "$forwarder_pid" || { printf 'Direct URL forwarding failed.\n' >&2; exit 1; }
forwarder_pid=""
wait_stage 'user_pref("fluxion.externalOpen.health", "launchservices-cold-warm-unicode-file-and-cli-rendered")'
kill -0 "$original_pid" 2>/dev/null || { printf 'Original browser process exited during external delivery.\n' >&2; exit 1; }
owned_browser_pids | grep -Fxq "$original_pid" || { printf 'Original browser process no longer owns the isolated profile.\n' >&2; exit 1; }
printf 'Verified LaunchServices cold/warm URLs, Unicode/spaces local-file rendering, and same-profile CLI forwarding.\n'
grep 'user_pref("fluxion.externalOpen.report"' "$profile/prefs.js"
