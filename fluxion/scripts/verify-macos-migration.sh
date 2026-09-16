#!/usr/bin/env bash
set -euo pipefail
[[ "$(uname -s)" == Darwin ]] || { printf 'Native migration verification requires macOS.\n' >&2; exit 69; }
fluxion_root="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
app_input="${1:-$fluxion_root/../.runtime/Fluxion.app}"
app="$(CDPATH= cd -- "$app_input" && pwd -P)"
[[ -x "$app/Contents/MacOS/Fluxion" ]] || exit 69
check_root="$(mktemp -d "${TMPDIR:-/tmp}/fluxion-migration-check.XXXXXX")"
profile="$check_root/profile"
driver="$check_root/driver"
browser_log="$check_root/browser.log"
browser_error="$check_root/browser-error.log"
driver_log="$check_root/driver.log"
artifact_dir="${FLUXION_MIGRATION_ARTIFACT_DIR:-}"
browser_pid=""
opener_pid=""
owned_browser_pids() {
  ps -axww -o pid= -o command= | node -e '
    let input=""; process.stdin.on("data",chunk=>input+=chunk);process.stdin.on("end",()=>{
      for(const line of input.split("\n")) {
        const row=line.match(/^\s*(\d+)\s+(.*)$/);if(!row)continue;
        if(row[2].startsWith(process.argv[1]+"/Contents/MacOS/firefox ") &&
          (row[2].includes("--profile "+process.argv[2]+" ") || row[2].endsWith("--profile "+process.argv[2])))console.log(row[1]);
      }
    });' "$app" "$profile"
}
cleanup() {
  for pid in $(owned_browser_pids); do
    kill "$pid" 2>/dev/null || true
    for ((attempt=0; attempt<40; attempt++)); do kill -0 "$pid" 2>/dev/null || break; sleep 0.25; done
    if kill -0 "$pid" 2>/dev/null && owned_browser_pids | grep -Fxq "$pid"; then kill -KILL "$pid" 2>/dev/null || true; fi
  done
  [[ -z "$opener_pid" ]] || wait "$opener_pid" 2>/dev/null || true
  if [[ -n "$artifact_dir" ]]; then
    mkdir -p "$artifact_dir"
    for log in "$browser_log" "$browser_error" "$driver_log"; do [[ ! -f "$log" ]] || cp "$log" "$artifact_dir/$(basename "$log")"; done
    [[ ! -f "$profile/prefs.js" ]] || grep 'fluxion.migrationVerification' "$profile/prefs.js" > "$artifact_dir/report.txt" || true
  fi
  case "$check_root" in "${TMPDIR:-/tmp}"/fluxion-migration-check.*) rm -rf -- "$check_root";; esac
}
trap cleanup EXIT
mkdir -p "$driver"
fixture="$check_root/Fluxion café bookmarks.html"
cp "$fluxion_root/tests/fixtures/migration-bookmarks.html" "$fixture"
/usr/bin/osacompile -o "$check_root/migration-driver.scpt" "$fluxion_root/packaging/macos/migration-picker-driver.applescript"
/usr/bin/xcrun clang -Wall -Wextra -Werror -O2 "$fluxion_root/packaging/macos/file-picker-owner.c" -framework ApplicationServices -o "$check_root/picker-owner"
/usr/bin/open -n -W -a "$app" --env "FLUXION_PROFILE=$profile" --env "FLUXION_MIGRATION_TEST=1" \
  --env "FLUXION_MIGRATION_DRIVER_DIR=$driver" --stdout "$browser_log" --stderr "$browser_error" about:blank &
opener_pid=$!
for ((attempt=0; attempt<160; attempt++)); do
  if [[ -f "$profile/prefs.js" ]]; then
    browser_pid="$(node -e 'const t=require("node:fs").readFileSync(process.argv[1],"utf8");const m=t.match(/user_pref\("fluxion\.migrationVerification\.pid", (\d+)\)/);if(m)console.log(m[1]);' "$profile/prefs.js")"
    if [[ -n "$browser_pid" ]]; then owned_browser_pids | grep -Fxq "$browser_pid" || exit 1; break; fi
  fi
  kill -0 "$opener_pid" 2>/dev/null || break
  sleep 0.25
done
[[ -n "$browser_pid" ]] || { printf 'Isolated migration browser did not start.\n' >&2; exit 1; }
"$check_root/picker-owner" "$browser_pid" >>"$driver_log" 2>&1
foreground=false
for ((attempt=0; attempt<640; attempt++)); do
  kill -0 "$browser_pid" 2>/dev/null || break
  if [[ "$foreground" == false ]] && /usr/bin/osascript -e "tell application \"System Events\" to set frontmost of first application process whose unix id is $browser_pid to true" >>"$driver_log" 2>&1; then
    touch "$driver/foreground.ready"
    foreground=true
  fi
  for action in accept open; do
    if [[ -f "$driver/$action.ready" && ! -f "$driver/$action.sent" ]]; then
      owned_browser_pids | grep -Fxq "$browser_pid" || break 2
      if /usr/bin/osascript "$check_root/migration-driver.scpt" "$action" "$browser_pid" "$fixture" "$check_root/picker-owner" >>"$driver_log" 2>&1; then
        touch "$driver/$action.sent"
      else
        printf 'Native migration file-picker driver failed; no mocked import fallback.\n' >&2
        break 2
      fi
    fi
  done
  if [[ -f "$profile/prefs.js" ]]; then
    if grep -Fq 'user_pref("fluxion.migrationVerification.error"' "$profile/prefs.js"; then break; fi
    if grep -Fq 'user_pref("fluxion.migrationVerification.health", "native-wizard-cancel-and-html-import-verified")' "$profile/prefs.js"; then
      [[ -f "$driver/accept.sent" ]] || break
      printf 'Verified native import wizard, Cancel and real HTML bookmark import.\n'
      grep 'fluxion.migrationVerification' "$profile/prefs.js"
      exit 0
    fi
  fi
  sleep 0.25
done
printf 'Native migration verification failed.\n' >&2
[[ ! -f "$profile/prefs.js" ]] || grep 'fluxion.migrationVerification' "$profile/prefs.js" >&2 || true
if [[ -n "$artifact_dir" ]]; then mkdir -p "$artifact_dir"; /usr/sbin/screencapture -x "$artifact_dir/failure.png" || true; fi
for log in "$browser_log" "$browser_error" "$driver_log"; do [[ ! -f "$log" ]] || sed -n '1,120p' "$log" >&2; done
exit 1
