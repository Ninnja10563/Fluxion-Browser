#!/usr/bin/env bash
set -euo pipefail
[[ "$(uname -s)" == Darwin ]] || { printf 'Workspace gesture verification requires macOS.\n' >&2; exit 69; }
fluxion_root="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
app="${1:-$fluxion_root/../.runtime/Fluxion.app}"
app="$(CDPATH= cd -- "$app" && pwd)"
launcher="$app/Contents/MacOS/Fluxion"
[[ -x "$launcher" ]] || { printf 'Fluxion launcher is missing.\n' >&2; exit 69; }
check_root="$(mktemp -d "${TMPDIR:-/tmp}/fluxion-workspace-gesture-check.XXXXXX")"
profile="$check_root/profile"
artifact_dir="${FLUXION_WORKSPACE_GESTURE_ARTIFACT_DIR:-$check_root/evidence}"
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
  [[ ! -f "$check_root/browser.log" ]] || cp "$check_root/browser.log" "$artifact_dir/workspace-gestures.log"
  if [[ -f "$profile/prefs.js" ]]; then
    grep 'fluxion.workspaceGestureVerification' "$profile/prefs.js" > "$artifact_dir/workspace-gestures-report.txt" || true
  fi
  printf 'Workspace gesture fixture and logs retained: %s\n' "$check_root" >&2
}
trap cleanup EXIT
foreground() {
  owned || { printf 'Gesture driver lost its exact owned browser process.\n' >&2; return 1; }
  osascript - "$process_id" <<'APPLESCRIPT'
on run arguments
  set browserPID to (item 1 of arguments) as integer
  with timeout of 10 seconds
    tell application "System Events"
      set ownedProcess to first application process whose unix id is browserPID
      set frontmost of ownedProcess to true
      delay 0.15
      if (unix id of first application process whose frontmost is true) is not browserPID then error "Wrong foreground process"
    end tell
  end timeout
end run
APPLESCRIPT
}
FLUXION_PROFILE="$profile" FLUXION_WORKSPACE_GESTURE_TEST=1 FLUXION_WORKSPACE_GESTURE_DRIVER_DIR="$check_root" \
  "$launcher" about:blank >"$check_root/browser.log" 2>&1 &
process_id=$!
for ((attempt=0; attempt<480; attempt++)); do
  kill -0 "$process_id" 2>/dev/null || break
  if [[ -f "$check_root/foreground.ready" && ! -f "$check_root/foreground.sent" ]]; then
    foreground
    touch "$check_root/foreground.sent"
  fi
  sleep 0.25
done
if kill -0 "$process_id" 2>/dev/null; then printf 'Gesture verification exceeded its bounded driver wait.\n' >&2; exit 1; fi
result=0; wait "$process_id" || result=$?; process_id=""
if [[ "$result" != 0 ]] || ! grep -Fq 'user_pref("fluxion.workspaceGestureVerification.health", "native-routed-workspace-wheel-and-scroll-verified")' "$profile/prefs.js"; then
  [[ ! -f "$profile/prefs.js" ]] || grep 'fluxion.workspaceGestureVerification' "$profile/prefs.js" >&2 || true
  sed -n '1,180p' "$check_root/browser.log" >&2
  exit 1
fi
grep 'fluxion.workspaceGestureVerification' "$profile/prefs.js"
printf 'Verified trusted Gecko-routed workspace wheel navigation, momentum ownership, native vertical tab scrolling, collapsed/revealed sidebar scope, and unchanged webpage session history. Physical trackpad input is not claimed.\n'
