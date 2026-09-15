#!/usr/bin/env bash
set -euo pipefail
[[ "$(uname -s)" == Darwin ]] || { printf 'Frame verification requires macOS.\n' >&2; exit 69; }
fluxion_root="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
app="${1:-$fluxion_root/../.runtime/Fluxion.app}"
app="$(CDPATH= cd -- "$app" && pwd)"
launcher="$app/Contents/MacOS/Fluxion"
[[ -x "$launcher" ]] || { printf 'Fluxion launcher is missing.\n' >&2; exit 69; }
check_root="$(mktemp -d "${TMPDIR:-/tmp}/fluxion-frame-check.XXXXXX")"
profile="$check_root/profile"
artifact_dir="${FLUXION_FRAME_ARTIFACT_DIR:-$check_root/captures}"
process_id=""
owned() {
  [[ -n "$process_id" ]] && kill -0 "$process_id" 2>/dev/null || return 1
  local command_line expected_prefix
  command_line="$(ps -ww -p "$process_id" -o command=)" || return 1
  expected_prefix="$app/Contents/MacOS/firefox --profile $profile"
  [[ "$command_line" == "$expected_prefix" || "$command_line" == "$expected_prefix "* ]]
}
cleanup() {
  if owned; then
    kill "$process_id" 2>/dev/null || true
    for ((stop_attempt=0; stop_attempt<40; stop_attempt++)); do owned || break; sleep 0.25; done
    if owned; then kill -KILL "$process_id" 2>/dev/null || true; fi
    wait "$process_id" 2>/dev/null || true
  fi
  mkdir -p "$artifact_dir"
  [[ ! -f "$check_root/browser.log" ]] || cp "$check_root/browser.log" "$artifact_dir/frame.log"
  if [[ -f "$profile/prefs.js" ]]; then
    grep 'fluxion.frame.verification' "$profile/prefs.js" > "$artifact_dir/frame-report.txt" || true
  fi
  # Retain the isolated fixture and screenshots on failure or when no external
  # artifact directory was requested, so local runs keep their evidence too.
  printf 'Frame fixture and logs: %s\n' "$check_root" >&2
}
trap cleanup EXIT
native_action() {
  owned || { printf 'Frame driver lost its exact owned browser process.\n' >&2; return 1; }
  osascript - "$process_id" "$1" <<'APPLESCRIPT'
on run arguments
  set browserPID to (item 1 of arguments) as integer
  set actionName to item 2 of arguments
  with timeout of 10 seconds
  tell application "System Events"
    set ownedProcess to first application process whose unix id is browserPID
    if actionName is "foreground" then
      set frontmost of ownedProcess to true
      delay 0.15
    end if
    if (unix id of first application process whose frontmost is true) is not browserPID then error "Wrong foreground process"
    tell ownedProcess
      if actionName is "close-ordinary" or actionName is "close-after-pointer" then keystroke "w" using command down
      if actionName is "restore-ordinary" then keystroke "t" using {command down, shift down}
    end tell
  end tell
  end timeout
end run
APPLESCRIPT
}
mkdir -p "$artifact_dir"
FLUXION_PROFILE="$profile" FLUXION_FRAME_TEST=1 FLUXION_FRAME_DRIVER_DIR="$check_root" \
  "$launcher" about:blank >"$check_root/browser.log" 2>&1 &
process_id=$!
for ((attempt=0; attempt<720; attempt++)); do
  kill -0 "$process_id" 2>/dev/null || break
  for action in foreground close-ordinary restore-ordinary close-after-pointer capture-page-light capture-page-dark capture-settings; do
    if [[ -f "$check_root/$action.ready" && ! -f "$check_root/$action.sent" ]]; then
      native_action "$action"
      if [[ "$action" == capture-* ]]; then
        owned || exit 1
        screencapture -x "$artifact_dir/$action.png"
        [[ -s "$artifact_dir/$action.png" ]] || { printf 'Frame screenshot is missing.\n' >&2; exit 1; }
      fi
      touch "$check_root/$action.sent"
    fi
  done
  sleep 0.25
done
if kill -0 "$process_id" 2>/dev/null; then printf 'Frame verification exceeded its bounded driver wait.\n' >&2; exit 1; fi
result=0; wait "$process_id" || result=$?; process_id=""
if [[ "$result" != 0 ]] || ! grep -Fq 'user_pref("fluxion.frame.verification.health", "native-frame-keyboard-close-and-captures-verified")' "$profile/prefs.js"; then
  [[ ! -f "$profile/prefs.js" ]] || grep 'fluxion.frame.verification' "$profile/prefs.js" >&2 || true
  sed -n '1,180p' "$check_root/browser.log" >&2
  exit 1
fi
grep 'fluxion.frame.verification' "$profile/prefs.js"
printf 'Verified native macOS keyboard closure, Flow/frame geometry, and actual webpage/Settings captures. OS mouse movement and fullscreen are not claimed.\n'
