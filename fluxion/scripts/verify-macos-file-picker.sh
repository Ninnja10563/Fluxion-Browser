#!/usr/bin/env bash
set -euo pipefail

[[ "$(uname -s)" == Darwin ]] || { printf 'The native file-picker verifier requires macOS.\n' >&2; exit 69; }
fluxion_root="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
app_input="${1:-$fluxion_root/../.runtime/Fluxion.app}"
app="$(CDPATH= cd -- "$app_input" && pwd -P)"
launcher="$app/Contents/MacOS/Fluxion"
[[ -x "$launcher" ]] || { printf 'Fluxion launcher is missing: %s\n' "$launcher" >&2; exit 69; }
check_root="$(mktemp -d "${TMPDIR:-/tmp}/fluxion-file-picker-check.XXXXXX")"
profile="$check_root/profile"
server_log="$check_root/server.log"
browser_log="$check_root/browser.log"
browser_error="$check_root/browser-error.log"
driver_log="$check_root/driver.log"
driver_dir="$check_root/driver"
server_pid=""
browser_pid=""
opener_pid=""
artifact_dir="${FLUXION_FILE_PICKER_ARTIFACT_DIR:-}"
owned_browser_pids() {
  ps -axww -o pid= -o command= | node -e '
    let input=""; process.stdin.on("data", chunk=>input+=chunk); process.stdin.on("end",()=>{
      for(const line of input.split("\n")) {
        const row=line.match(/^\s*(\d+)\s+(.*)$/); if(!row)continue;
        if(row[2].startsWith(process.argv[1]+"/Contents/MacOS/firefox ") &&
          (row[2].includes("--profile "+process.argv[2]+" ") || row[2].endsWith("--profile "+process.argv[2]))) console.log(row[1]);
      }
    });' "$app" "$profile"
}
cleanup() {
  for pid in $(owned_browser_pids); do
    kill "$pid" 2>/dev/null || true
    for ((stop_attempt=0; stop_attempt<40; stop_attempt++)); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.25
    done
    if kill -0 "$pid" 2>/dev/null && owned_browser_pids | grep -Fxq "$pid"; then kill -KILL "$pid" 2>/dev/null || true; fi
  done
  for pid in "$opener_pid" "$server_pid"; do
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
    for log in "$browser_log" "$browser_error" "$server_log" "$driver_log"; do
      [[ ! -f "$log" ]] || cp "$log" "$artifact_dir/file-picker-$(basename "$log")"
    done
    if [[ -f "$profile/prefs.js" ]]; then
      grep 'user_pref("fluxion\.filePicker\.' "$profile/prefs.js" > "$artifact_dir/file-picker-evidence.txt" || true
    fi
  fi
  case "$check_root" in
    "${TMPDIR:-/tmp}"/fluxion-file-picker-check.*) rm -rf -- "$check_root" ;;
    *) printf 'Refusing unsafe file-picker cleanup path: %s\n' "$check_root" >&2 ;;
  esac
}
trap cleanup EXIT
mkdir -p "$driver_dir"
/usr/bin/osacompile -o "$check_root/file-picker-driver.scpt" "$fluxion_root/packaging/macos/file-picker-driver.applescript"
/usr/bin/xcrun clang -Wall -Wextra -Werror -O2 "$fluxion_root/packaging/macos/file-picker-owner.c" -framework ApplicationServices -o "$check_root/file-picker-owner"
node "$fluxion_root/scripts/browsing-fixture.mjs" 0 >"$server_log" 2>&1 &
server_pid=$!
for ((attempt=0; attempt<80; attempt++)); do
  if [[ -s "$server_log" ]] && node -e '
    const fs=require("node:fs");
    try { const r=JSON.parse(fs.readFileSync(process.argv[1],"utf8").split("\n")[0]);
      process.exit(/^http:\/\/127\.0\.0\.1:\d+$/.test(r.origin) && r.filePicker?.path==="/file-picker" && r.filePicker?.sha256 ? 0:1);
    } catch { process.exit(1); }
  ' "$server_log"; then break; fi
  kill -0 "$server_pid" 2>/dev/null || { cat "$server_log" >&2; exit 1; }
  sleep 0.1
done
(( attempt < 80 )) || { printf 'File-picker HTTP fixture did not become ready.\n' >&2; cat "$server_log" >&2; exit 1; }
origin="$(node -e 'console.log(JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8").split("\n")[0]).origin)' "$server_log")"
upload_path="$(node -e '
  const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
  const f=JSON.parse(fs.readFileSync(process.argv[1],"utf8").split("\n")[0]).filePicker;
  if(f.filename!=="Fluxion café upload.txt" || Buffer.byteLength(f.text)!==f.bytes || crypto.createHash("sha256").update(f.text).digest("hex")!==f.sha256) throw Error("Invalid picker fixture metadata");
  const target=path.join(process.argv[2],f.filename); fs.writeFileSync(target,f.text,{encoding:"utf8",flag:"wx"}); console.log(target);
' "$server_log" "$check_root")"
expected_hash="$(node -e 'console.log(JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8").split("\n")[0]).filePicker.sha256)' "$server_log")"
expected_size="$(node -e 'console.log(JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8").split("\n")[0]).filePicker.bytes)' "$server_log")"

/usr/bin/open -n -W -a "$app" \
  --env "FLUXION_PROFILE=$profile" --env "FLUXION_FILE_PICKER_TEST=1" --env "FLUXION_FILE_PICKER_ORIGIN=$origin" \
  --env "FLUXION_FILE_PICKER_UPLOAD_PATH=$upload_path" --env "FLUXION_FILE_PICKER_DRIVER_DIR=$driver_dir" \
  --env "FLUXION_FILE_PICKER_EXPECTED_SHA256=$expected_hash" --env "FLUXION_FILE_PICKER_EXPECTED_SIZE=$expected_size" \
  --stdout "$browser_log" --stderr "$browser_error" "$origin/file-picker" &
opener_pid=$!
for ((attempt=0; attempt<160; attempt++)); do
  if [[ -f "$profile/prefs.js" ]]; then
    browser_pid="$(node -e 'const t=require("node:fs").readFileSync(process.argv[1],"utf8"); const m=t.match(/user_pref\("fluxion\.filePicker\.pid", (\d+)\)/); if(m)console.log(m[1]);' "$profile/prefs.js")"
    if [[ -n "$browser_pid" ]]; then
      owned_browser_pids | grep -Fxq "$browser_pid" || { printf 'Reported browser PID does not own the exact app and profile.\n' >&2; exit 1; }
      break
    fi
  fi
  kill -0 "$opener_pid" 2>/dev/null || break
  sleep 0.25
done
[[ -n "$browser_pid" ]] || { printf 'LaunchServices did not start the owned file-picker browser.\n' >&2; exit 1; }
"$check_root/file-picker-owner" "$browser_pid" >>"$driver_log" 2>&1
foreground_ready=false
for ((attempt=0; attempt<480; attempt++)); do
  kill -0 "$browser_pid" 2>/dev/null && kill -0 "$server_pid" 2>/dev/null || break
  if [[ "$foreground_ready" == false ]]; then
    # Wait for the owned launcher to become a Cocoa application process.
    if /usr/bin/osascript -e "tell application \"System Events\" to set frontmost of first application process whose unix id is $browser_pid to true" >>"$driver_log" 2>&1; then
      touch "$driver_dir/foreground.ready"
      foreground_ready=true
    fi
  fi
  driver_failed=false
  for action in cancel accept; do
    if [[ -f "$driver_dir/$action.ready" && ! -f "$driver_dir/$action.sent" ]]; then
      owned_browser_pids | grep -Fxq "$browser_pid" || { printf 'Owned file-picker browser identity changed.\n' >&2; break 2; }
      if /usr/bin/osascript "$check_root/file-picker-driver.scpt" "$action" "$browser_pid" "$upload_path" "$check_root/file-picker-owner" >>"$driver_log" 2>&1; then
        "$check_root/file-picker-owner" "$browser_pid" >>"$driver_log" 2>&1
        touch "$driver_dir/$action.sent"
      else
        printf 'Native file-picker driver failed during %s; no mock fallback is permitted.\n' "$action" >&2
        driver_failed=true
        break
      fi
    fi
  done
  [[ "$driver_failed" == false ]] || break
  if [[ -f "$profile/prefs.js" ]]; then
    if grep -Fq 'user_pref("fluxion.filePicker.error"' "$profile/prefs.js"; then break; fi
    if grep -Fq 'user_pref("fluxion.filePicker.health", "native-picker-cancel-and-multipart-upload-verified")' "$profile/prefs.js"; then
      [[ -f "$driver_dir/cancel.sent" && -f "$driver_dir/accept.sent" ]] || break
      printf 'Verified actual macOS picker cancellation and Unicode-path multipart upload.\n'
      grep 'fluxion\.filePicker\.report' "$profile/prefs.js"
      exit 0
    fi
  fi
  sleep 0.25
done
printf 'Native file-picker verification failed or timed out.\n' >&2
# Read-only evidence only: no driver action uses a process-name match. This
# resolver must establish exact OS attribution before remote AX can be scoped.
"$check_root/file-picker-owner" "$browser_pid" >>"$driver_log" 2>&1 || true
"$check_root/file-picker-owner" "$browser_pid" --focused >>"$driver_log" 2>&1 || true
if [[ -n "$artifact_dir" ]]; then
  mkdir -p "$artifact_dir"
  /usr/sbin/screencapture -x "$artifact_dir/file-picker-failure.png" || true
fi
[[ ! -f "$profile/prefs.js" ]] || grep 'fluxion\.filePicker\.' "$profile/prefs.js" >&2 || true
for log in "$driver_log" "$browser_log" "$browser_error" "$server_log"; do
  [[ ! -f "$log" ]] || sed -n '1,160p' "$log" >&2
done
exit 1
