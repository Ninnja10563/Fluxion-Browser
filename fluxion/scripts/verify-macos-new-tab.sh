#!/usr/bin/env bash
set -euo pipefail
[[ "$(uname -s)" == Darwin ]] || { printf 'Native new tab verification requires macOS.\n' >&2; exit 69; }
fluxion_root="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
app="${1:-$fluxion_root/../.runtime/Fluxion.app}"
app="$(CDPATH= cd -- "$app" && pwd)"
launcher="$app/Contents/MacOS/Fluxion"
[[ -x "$launcher" ]] || { printf 'Missing Fluxion launcher.\n' >&2; exit 69; }
check_root="$(mktemp -d "${TMPDIR:-/tmp}/fluxion-new-tab.XXXXXX")"
profile="$check_root/profile"
driver="$check_root/driver"
artifact_dir="${FLUXION_NEW_TAB_ARTIFACT_DIR:-$check_root/artifacts}"
browser_pid=""
server_pid=""
owned() {
  [[ -n "$browser_pid" ]] && kill -0 "$browser_pid" 2>/dev/null || return 1
  local command_line expected
  command_line="$(ps -ww -p "$browser_pid" -o command=)" || return 1
  expected="$app/Contents/MacOS/firefox --profile $profile"
  [[ "$command_line" == "$expected" || "$command_line" == "$expected "* ]]
}
owned_launcher() {
  [[ -n "$browser_pid" ]] && kill -0 "$browser_pid" 2>/dev/null || return 1
  local command_line parent_pid
  command_line="$(ps -ww -p "$browser_pid" -o command=)" || return 1
  parent_pid="$(ps -p "$browser_pid" -o ppid=)" || return 1
  parent_pid="${parent_pid//[[:space:]]/}"
  [[ "$parent_pid" == "$$" && "$command_line" == "$launcher about:blank" ]]
}
wait_for_owned_browser() {
  local attempt
  for ((attempt=0; attempt<120; attempt++)); do
    if owned; then return 0; fi
    kill -0 "$browser_pid" 2>/dev/null || return 1
    sleep 0.1
  done
  printf 'New tab launcher did not become the exact profile-owned Gecko process.\n' >&2
  return 1
}
cleanup_browser() {
  if owned || owned_launcher; then
    kill "$browser_pid" 2>/dev/null || true
    local attempt
    for ((attempt=0; attempt<40; attempt++)); do
      if ! owned && ! owned_launcher; then break; fi
      sleep 0.25
    done
    if owned || owned_launcher; then kill -KILL "$browser_pid" 2>/dev/null || true; fi
    wait "$browser_pid" 2>/dev/null || true
  fi
}
cleanup() {
  cleanup_browser
  if [[ -n "$server_pid" ]]; then kill "$server_pid" 2>/dev/null || true; wait "$server_pid" 2>/dev/null || true; fi
  mkdir -p "$artifact_dir"
  for name in browser keyboard server; do
    [[ ! -f "$check_root/$name.log" ]] || cp "$check_root/$name.log" "$artifact_dir/new-tab-$name.log"
  done
  if [[ -f "$profile/prefs.js" ]]; then
    grep 'fluxion.newTab.verification' "$profile/prefs.js" > "$artifact_dir/new-tab-report.txt" || true
  fi
  printf 'New tab fixture retained at: %s\n' "$check_root" >&2
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
mkdir -p "$driver" "$artifact_dir"
node "$fluxion_root/scripts/new-tab-fixture.mjs" > "$check_root/server.log" 2>&1 &
server_pid=$!
for ((attempt=0; attempt<100; attempt++)); do
  [[ ! -s "$check_root/server.log" ]] || break
  kill -0 "$server_pid" 2>/dev/null || exit 1
  sleep 0.1
done
origin="$(node -e 'const f=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8").split("\n")[0]);if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(f.origin))throw Error("Invalid fixture origin");console.log(f.origin)' "$check_root/server.log")"
FLUXION_PROFILE="$profile" FLUXION_NEW_TAB_TEST=1 FLUXION_NEW_TAB_DRIVER_DIR="$driver" \
  FLUXION_NEW_TAB_ORIGIN="$origin" "$launcher" about:blank > "$check_root/browser.log" 2>&1 &
browser_pid=$!
wait_for_owned_browser || exit 1
sequence=1
for ((attempt=0; attempt<1200; attempt++)); do
  owned || break
  for action in activate newtab type return escape; do
    request="$sequence-$action"
    if [[ -f "$driver/$request.ready" && ! -f "$driver/$request.sent" ]]; then
      (( sequence <= 80 )) || exit 1
      input=""
      if [[ "$action" == type ]]; then
        input="$(node -e 'const s=require("node:fs").readFileSync(process.argv[1],"utf8");if(!/^[\x20-\x7e]{1,512}$/.test(s))throw Error("Unsafe native typing request");console.log(s)' "$driver/$request.ready")"
      fi
      /usr/bin/osascript - "$browser_pid" "$action" "$input" >> "$check_root/keyboard.log" 2>&1 <<'APPLESCRIPT'
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
          if actionName is "newtab" then
            key code 17 using {command down}
          else if actionName is "type" then
            keystroke (item 3 of arguments)
          else if actionName is "return" then
            key code 36
          else if actionName is "escape" then
            key code 53
          else
            error "Unknown new tab action"
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
    if grep -Fq 'user_pref("fluxion.newTab.verification.health", "native-deferred-new-tab-verified")' "$profile/prefs.js"; then
      printf 'Verified native deferred New Tab, Escape cancellation, URL/POST submission, workspace/container boundaries and private browsing.\n'
      exit 0
    fi
    if grep -Fq 'user_pref("fluxion.newTab.verification.error"' "$profile/prefs.js"; then break; fi
  fi
  kill -0 "$server_pid" 2>/dev/null || break
  sleep 0.25
done
printf 'Native new tab verification failed.\n' >&2
[[ ! -f "$profile/prefs.js" ]] || grep 'fluxion.newTab.verification' "$profile/prefs.js" >&2 || true
exit 1
