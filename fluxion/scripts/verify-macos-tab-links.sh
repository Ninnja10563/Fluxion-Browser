#!/usr/bin/env bash
set -euo pipefail
[[ "$(uname -s)" == Darwin ]] || { printf 'Native tab link verification requires macOS.\n' >&2; exit 69; }
fluxion_root="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
app="${1:-$fluxion_root/../.runtime/Fluxion.app}"
app="$(CDPATH= cd -- "$app" && pwd)"
launcher="$app/Contents/MacOS/Fluxion"
[[ -x "$launcher" ]] || { printf 'Missing Fluxion launcher.\n' >&2; exit 69; }
check_root="$(mktemp -d "${TMPDIR:-/tmp}/fluxion-tab-links.XXXXXX")"
profile="$check_root/profile"
driver="$check_root/driver"
token="${check_root##*/}"
artifact_dir="${FLUXION_TAB_LINKS_ARTIFACT_DIR:-$check_root/artifacts}"
browser_pid=""
server_pid=""
clipboard_pid=""
owned() {
  [[ -n "$browser_pid" ]] && kill -0 "$browser_pid" 2>/dev/null || return 1
  local command_line expected
  command_line="$(ps -ww -p "$browser_pid" -o command=)" || return 1
  expected="$app/Contents/MacOS/firefox --profile $profile"
  [[ "$command_line" == "$expected" || "$command_line" == "$expected "* ]]
}
cleanup() {
  if owned; then
    kill "$browser_pid" 2>/dev/null || true
    for ((attempt=0; attempt<40; attempt++)); do owned || break; sleep 0.25; done
    if owned; then kill -KILL "$browser_pid" 2>/dev/null || true; fi
    wait "$browser_pid" 2>/dev/null || true
  fi
  if [[ -n "$clipboard_pid" ]]; then
    touch "$driver/clipboard.finish"
    wait "$clipboard_pid" || true
  fi
  if [[ -n "$server_pid" ]]; then kill "$server_pid" 2>/dev/null || true; wait "$server_pid" 2>/dev/null || true; fi
  mkdir -p "$artifact_dir"
  for name in browser clipboard keyboard; do
    [[ ! -f "$check_root/$name.log" ]] || cp "$check_root/$name.log" "$artifact_dir/tab-links-$name.log"
  done
  [[ ! -f "$driver/clipboard.restored" ]] || cp "$driver/clipboard.restored" "$artifact_dir/clipboard-restoration.txt"
  if [[ -f "$profile/prefs.js" ]]; then
    grep 'fluxion.tabLinks.verification' "$profile/prefs.js" > "$artifact_dir/tab-links-report.txt" || true
  fi
  printf 'Tab links fixture retained at: %s\n' "$check_root" >&2
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
mkdir -p "$driver" "$artifact_dir"
node "$fluxion_root/scripts/tab-transfer-fixture.mjs" 0 > "$check_root/server.log" 2>&1 &
server_pid=$!
for ((attempt=0; attempt<100; attempt++)); do
  [[ ! -s "$check_root/server.log" ]] || break
  kill -0 "$server_pid" 2>/dev/null || exit 1
  sleep 0.1
done
origin="$(node -e 'const f=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8").split("\n")[0]);if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(f.origin))throw Error("Invalid fixture origin");console.log(f.origin)' "$check_root/server.log")"
xcrun swiftc "$fluxion_root/scripts/tab-links-clipboard.swift" -o "$check_root/clipboard-custodian"
"$check_root/clipboard-custodian" "$driver" "$token" "$origin" > "$check_root/clipboard.log" 2>&1 &
clipboard_pid=$!
for ((attempt=0; attempt<100; attempt++)); do
  [[ ! -f "$driver/clipboard.ready" ]] || break
  kill -0 "$clipboard_pid" 2>/dev/null || exit 1
  sleep 0.1
done
[[ -f "$driver/clipboard.ready" ]] || { printf 'Clipboard custodian did not initialize.\n' >&2; exit 1; }
FLUXION_PROFILE="$profile" FLUXION_TAB_LINKS_TEST=1 FLUXION_TAB_LINKS_DRIVER_DIR="$driver" \
  FLUXION_TAB_LINKS_ORIGIN="$origin" FLUXION_TAB_LINKS_TOKEN="$token" \
  "$launcher" about:blank > "$check_root/browser.log" 2>&1 &
browser_pid=$!
sequence=1
for ((attempt=0; attempt<800; attempt++)); do
  owned || break
  for action in activate open down return escape; do
    request="$sequence-$action"
    if [[ -f "$driver/$request.ready" && ! -f "$driver/$request.sent" ]]; then
      (( sequence <= 40 )) || exit 1
      /usr/bin/osascript - "$browser_pid" "$action" >> "$check_root/keyboard.log" 2>&1 <<'APPLESCRIPT'
on run arguments
  set browserPID to (item 1 of arguments) as integer
  set actionName to item 2 of arguments
  with timeout of 10 seconds
    tell application "System Events"
      if actionName is "activate" then
        set frontmost of first application process whose unix id is browserPID to true
      else
        if (unix id of first application process whose frontmost is true) is not browserPID then error "Wrong foreground process"
        tell first application process whose unix id is browserPID
          if actionName is "open" then
            key code 109 using {shift down}
          else if actionName is "down" then
            key code 125
          else if actionName is "return" then
            key code 36
          else if actionName is "escape" then
            key code 53
          else
            error "Unknown native tab link action"
          end if
        end tell
      end if
    end tell
  end timeout
end run
APPLESCRIPT
      touch "$driver/$request.sent"
      sequence=$((sequence + 1))
    fi
  done
  if [[ -f "$profile/prefs.js" ]]; then
    if grep -Fq 'user_pref("fluxion.tabLinks.verification.health", "native-tab-link-command-and-clipboard-verified")' "$profile/prefs.js"; then
      touch "$driver/clipboard.finish"
      wait "$clipboard_pid"
      clipboard_pid=""
      [[ -f "$driver/clipboard.restored" ]] || { printf 'Clipboard restoration outcome missing.\n' >&2; exit 1; }
      printf 'Verified real native Copy Tab Link commands and exact pasteboard bytes; previous formats restored only while fixture-owned.\n'
      exit 0
    fi
    if grep -Fq 'user_pref("fluxion.tabLinks.verification.error"' "$profile/prefs.js"; then break; fi
  fi
  [[ ! -f "$driver/clipboard.error" ]] || break
  kill -0 "$server_pid" 2>/dev/null && kill -0 "$clipboard_pid" 2>/dev/null || break
  sleep 0.25
done
printf 'Native tab links verification failed.\n' >&2
[[ ! -f "$profile/prefs.js" ]] || grep 'fluxion.tabLinks.verification' "$profile/prefs.js" >&2 || true
exit 1
