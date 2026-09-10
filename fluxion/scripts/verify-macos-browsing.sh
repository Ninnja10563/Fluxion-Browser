#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  printf 'The packaged Fluxion browsing verifier requires macOS.\n' >&2
  exit 69
fi
fluxion_root="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
app="${1:-$fluxion_root/../.runtime/Fluxion.app}"
launcher="$app/Contents/MacOS/Fluxion"
[[ -x "$launcher" ]] || { printf 'Fluxion launcher is missing: %s\n' "$launcher" >&2; exit 69; }
check_root="$(mktemp -d "${TMPDIR:-/tmp}/fluxion-browsing-check.XXXXXX")"
profile="$check_root/profile"
server_log="$check_root/server.log"
browser_log="$check_root/browser.log"
server_pid=""
browser_pid=""
artifact_dir="${FLUXION_BROWSING_ARTIFACT_DIR:-}"
cleanup() {
  for pid in "$browser_pid" "$server_pid"; do
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      for ((stop_attempt=0; stop_attempt<40; stop_attempt++)); do
        kill -0 "$pid" 2>/dev/null || break
        sleep 0.25
      done
      if kill -0 "$pid" 2>/dev/null; then kill -KILL "$pid" 2>/dev/null || true; fi
      wait "$pid" 2>/dev/null || true
    fi
  done
  if [[ -n "$artifact_dir" ]]; then
    mkdir -p "$artifact_dir"
    [[ ! -f "$browser_log" ]] || cp "$browser_log" "$artifact_dir/browsing.log"
    [[ ! -f "$server_log" ]] || cp "$server_log" "$artifact_dir/browsing-fixture.log"
    if [[ -f "$profile/prefs.js" ]]; then
      grep 'user_pref("fluxion\.browsing\.' "$profile/prefs.js" > "$artifact_dir/browsing-evidence.txt" || true
    fi
  fi
  case "$check_root" in
    "${TMPDIR:-/tmp}"/fluxion-browsing-check.*) rm -rf -- "$check_root" ;;
    *) printf 'Refusing unsafe browsing-check cleanup path: %s\n' "$check_root" >&2 ;;
  esac
}
trap cleanup EXIT

node "$fluxion_root/scripts/browsing-fixture.mjs" 0 >"$server_log" 2>&1 &
server_pid=$!
for ((attempt=0; attempt<80; attempt++)); do
  if [[ -s "$server_log" ]] && node -e '
    const fs = require("node:fs");
    try { const ready = JSON.parse(fs.readFileSync(process.argv[1], "utf8").split("\n")[0]);
      process.exit(ready.origin && ready.download?.sha256 ? 0 : 1); } catch { process.exit(1); }
  ' "$server_log"; then break; fi
  kill -0 "$server_pid" 2>/dev/null || { cat "$server_log" >&2; exit 1; }
  sleep 0.1
done
if (( attempt == 80 )); then printf 'Browsing fixture did not become ready.\n' >&2; cat "$server_log" >&2; exit 1; fi
origin="$(node -e 'const fs=require("node:fs"); console.log(JSON.parse(fs.readFileSync(process.argv[1],"utf8").split("\n")[0]).origin)' "$server_log")"
download_hash="$(node -e 'const fs=require("node:fs"); console.log(JSON.parse(fs.readFileSync(process.argv[1],"utf8").split("\n")[0]).download.sha256)' "$server_log")"
download_size="$(node -e 'const fs=require("node:fs"); console.log(Buffer.byteLength(JSON.parse(fs.readFileSync(process.argv[1],"utf8").split("\n")[0]).download.text))' "$server_log")"

printf 'Verifying actual Gecko download, content upload, and session navigation...\n' >&2
FLUXION_PROFILE="$profile" FLUXION_VISUAL_BROWSING_TEST=1 FLUXION_BROWSING_ORIGIN="$origin" \
  FLUXION_BROWSING_DOWNLOAD_SHA256="$download_hash" FLUXION_BROWSING_DOWNLOAD_SIZE="$download_size" \
  "$launcher" "$origin/" >"$browser_log" 2>&1 &
browser_pid=$!
for ((attempt=0; attempt<600; attempt++)); do
  kill -0 "$server_pid" 2>/dev/null || { printf 'Browsing fixture stopped during verification.\n' >&2; cat "$server_log" >&2; exit 1; }
  if [[ -f "$profile/prefs.js" ]]; then
    if grep -Fq 'user_pref("fluxion.browsing.error"' "$profile/prefs.js"; then
      printf 'Packaged browsing verification failed.\n' >&2
      grep 'fluxion\.browsing\.' "$profile/prefs.js" >&2 || true
      sed -n '1,160p' "$browser_log" >&2
      exit 1
    fi
    if grep -Fq 'user_pref("fluxion.browsing.health", "real-download-upload-and-session-navigation-verified")' "$profile/prefs.js"; then
      printf 'Real download, content upload, login session, and logout verified. Native file-picker automation is not claimed.\n'
      grep 'fluxion\.browsing\.report' "$profile/prefs.js"
      exit 0
    fi
  fi
  kill -0 "$browser_pid" 2>/dev/null || { printf 'Fluxion exited before browsing verification completed.\n' >&2; cat "$browser_log" >&2; exit 1; }
  sleep 0.25
done
printf 'Timed out waiting for packaged browsing verification.\n' >&2
[[ ! -f "$profile/prefs.js" ]] || grep 'fluxion\.browsing\.' "$profile/prefs.js" >&2 || true
sed -n '1,160p' "$browser_log" >&2
exit 1
