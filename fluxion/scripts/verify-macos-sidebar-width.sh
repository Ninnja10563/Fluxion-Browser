#!/usr/bin/env bash
set -euo pipefail
[[ "$(uname -s)" == Darwin ]] || { printf 'Sidebar geometry verification requires macOS.\n' >&2; exit 69; }
fluxion_root="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
app="${1:-$fluxion_root/../.runtime/Fluxion.app}"
app="$(CDPATH= cd -- "$app" && pwd)"
launcher="$app/Contents/MacOS/Fluxion"
[[ -x "$launcher" ]] || exit 69
check_root="$(mktemp -d "${TMPDIR:-/tmp}/fluxion-sidebar-width-check.XXXXXX")"
profile="$check_root/profile"
process_id=""
owned() {
  [[ -n "$process_id" ]] && kill -0 "$process_id" 2>/dev/null || return 1
  local command_line expected_prefix
  command_line="$(ps -ww -p "$process_id" -o command=)" || return 1
  expected_prefix="$app/Contents/MacOS/firefox --profile $profile"
  [[ "$command_line" == "$expected_prefix" || "$command_line" == "$expected_prefix "* ]]
}
cleanup() {
  if [[ -n "${FLUXION_SIDEBAR_WIDTH_ARTIFACT_DIR:-}" ]]; then
    mkdir -p "$FLUXION_SIDEBAR_WIDTH_ARTIFACT_DIR"
    for phase_log in seed restore; do
      if [[ -f "$check_root/$phase_log.log" ]]; then
        cp "$check_root/$phase_log.log" "$FLUXION_SIDEBAR_WIDTH_ARTIFACT_DIR/$phase_log.log"
      fi
    done
    if [[ -f "$profile/prefs.js" ]]; then
      grep 'fluxion.sidebarWidth.verification' "$profile/prefs.js" > "$FLUXION_SIDEBAR_WIDTH_ARTIFACT_DIR/report.txt" || true
    fi
  fi
  if owned; then
    kill "$process_id" 2>/dev/null || true
    for ((attempt=0; attempt<40; attempt++)); do owned || break; sleep 0.25; done
    if owned; then kill -KILL "$process_id" 2>/dev/null || true; fi
    wait "$process_id" 2>/dev/null || true
  fi
  case "$check_root" in "${TMPDIR:-/tmp}"/fluxion-sidebar-width-check.*) rm -rf -- "$check_root";; esac
}
trap cleanup EXIT
native_action() {
  owned || { printf 'Sidebar driver lost its exact owned browser process.\n' >&2; return 1; }
  osascript - "$process_id" "$1" <<'APPLESCRIPT'
on run arguments
  set browserPID to (item 1 of arguments) as integer
  set actionName to item 2 of arguments
  tell application "System Events"
    set ownedProcess to first application process whose unix id is browserPID
    set frontmost of ownedProcess to true
    delay 0.15
    if (unix id of first application process whose frontmost is true) is not browserPID then error "Wrong foreground process"
    tell ownedProcess
      if actionName is "home" then key code 115
      if actionName is "end" then key code 119
      if actionName is "right" or actionName is "rtl-right" then key code 124
      if actionName is "escape" then key code 53
    end tell
  end tell
end run
APPLESCRIPT
}
for phase in seed restore; do
  FLUXION_PROFILE="$profile" FLUXION_SIDEBAR_WIDTH_TEST=1 FLUXION_SIDEBAR_WIDTH_PHASE="$phase" \
    FLUXION_SIDEBAR_WIDTH_DRIVER_DIR="$check_root" "$launcher" about:blank >"$check_root/$phase.log" 2>&1 &
  process_id=$!
  for ((attempt=0; attempt<600; attempt++)); do
    kill -0 "$process_id" 2>/dev/null || break
    for action in foreground home end right rtl-right escape capture; do
      if [[ -f "$check_root/$action.ready" && ! -f "$check_root/$action.sent" ]]; then
        native_action "$action"
        if [[ "$action" == capture ]]; then
          [[ -n "${FLUXION_SIDEBAR_WIDTH_ARTIFACT_DIR:-}" ]] || { printf 'Unexpected screenshot request without artifact directory.\n' >&2; exit 1; }
          mkdir -p "$FLUXION_SIDEBAR_WIDTH_ARTIFACT_DIR"
          sleep 0.25
          owned || exit 1
          screencapture -x "$FLUXION_SIDEBAR_WIDTH_ARTIFACT_DIR/sidebar-width.png"
        fi
        touch "$check_root/$action.sent"
      fi
    done
    sleep 0.25
  done
  if kill -0 "$process_id" 2>/dev/null; then printf 'Sidebar verification did not quit during %s.\n' "$phase" >&2; exit 1; fi
  result=0; wait "$process_id" || result=$?; process_id=""
  if [[ "$result" != 0 ]] || ! grep -Fq "user_pref(\"fluxion.sidebarWidth.verification.$phase.health\", \"native-sidebar-width-geometry-and-persistence-verified\")" "$profile/prefs.js"; then
    [[ ! -f "$profile/prefs.js" ]] || grep 'fluxion.sidebarWidth.verification' "$profile/prefs.js" >&2 || true
    sed -n '1,180p' "$check_root/$phase.log" >&2
    exit 1
  fi
  grep 'fluxion.sidebarWidth.verification' "$profile/prefs.js" >&2
done
printf 'Verified native sidebar sizing, layout modes, cross-window preference propagation and clean relaunch persistence.\n'
