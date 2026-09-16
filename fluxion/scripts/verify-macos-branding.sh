#!/usr/bin/env bash
set -euo pipefail
[[ "$(uname -s)" == Darwin ]] || { printf 'Branding verification requires macOS.\n' >&2; exit 69; }
fluxion_root="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
app="${1:-$fluxion_root/../.runtime/Fluxion.app}"
app="$(CDPATH= cd -- "$app" && pwd)"
launcher="$app/Contents/MacOS/Fluxion"
[[ -x "$launcher" ]] || { printf 'Fluxion launcher is missing.\n' >&2; exit 69; }
check_root="$(mktemp -d "${TMPDIR:-/tmp}/fluxion-branding-check.XXXXXX")"
profile="$check_root/profile"
artifact_dir="${FLUXION_BRANDING_ARTIFACT_DIR:-$check_root/captures}"
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
  [[ ! -f "$check_root/branding.log" ]] || cp "$check_root/branding.log" "$artifact_dir/branding.log"
  if [[ -f "$profile/prefs.js" ]]; then
    grep 'fluxion.branding.verification' "$profile/prefs.js" > "$artifact_dir/branding-report.txt" || true
  fi
  printf 'Branding fixture and logs retained at: %s\n' "$check_root" >&2
}
trap cleanup EXIT
foreground() {
  owned || { printf 'Branding driver lost its exact owned browser process.\n' >&2; return 1; }
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
native_key() {
  owned || { printf 'Branding keyboard driver lost its exact owned browser process.\n' >&2; return 1; }
  osascript - "$process_id" "$1" <<'APPLESCRIPT'
on run arguments
  set browserPID to (item 1 of arguments) as integer
  set actionName to item 2 of arguments
  with timeout of 10 seconds
    tell application "System Events"
      set ownedProcess to first application process whose unix id is browserPID
      if (unix id of first application process whose frontmost is true) is not browserPID then error "Wrong foreground process"
      tell ownedProcess
        if actionName is "branding-location" then
          keystroke "l" using command down
        else if actionName is "branding-location-escape" or actionName is "branding-location-revert" then
          key code 53
        else
          error "Unknown branding keyboard action"
        end if
      end tell
    end tell
  end timeout
end run
APPLESCRIPT
}
native_application_menu() {
  owned || { printf 'Branding menu driver lost its exact owned browser process.\n' >&2; return 1; }
  osascript - "$process_id" > "$artifact_dir/application-menu-labels.txt" <<'APPLESCRIPT'
on run arguments
  set browserPID to (item 1 of arguments) as integer
  with timeout of 10 seconds
    tell application "System Events"
      set ownedProcess to first application process whose unix id is browserPID
      if (unix id of first application process whose frontmost is true) is not browserPID then error "Wrong foreground process"
      tell ownedProcess
        set appItem to menu bar item 2 of menu bar 1
        click appItem
        repeat 50 times
          if exists menu 1 of appItem then exit repeat
          delay 0.05
        end repeat
        set labels to {name of appItem}
        repeat with menuItem in menu items of menu 1 of appItem
          set itemName to name of menuItem
          if itemName is not missing value and itemName is not "" then set end of labels to itemName
        end repeat
        set AppleScript's text item delimiters to linefeed
        return labels as text
      end tell
    end tell
  end timeout
end run
APPLESCRIPT
  owned || return 1
  screencapture -x "$artifact_dir/capture-branding-application-menu.png"
  [[ -s "$artifact_dir/capture-branding-application-menu.png" ]] || return 1
  # Escape dismisses this menu; none of its product/default/quit commands run.
  native_key branding-location-escape
  cp "$artifact_dir/application-menu-labels.txt" "$check_root/branding-application-menu.txt"
}
mkdir -p "$artifact_dir"
FLUXION_PROFILE="$profile" FLUXION_VERIFY_BRANDING=1 FLUXION_BRANDING_DRIVER_DIR="$check_root" \
  "$launcher" about:blank >"$check_root/branding.log" 2>&1 &
process_id=$!
for ((attempt=0; attempt<600; attempt++)); do
  kill -0 "$process_id" 2>/dev/null || break
  if [[ -f "$check_root/branding-foreground.ready" && ! -f "$check_root/branding-foreground.sent" ]]; then
    foreground
    touch "$check_root/branding-foreground.sent"
  fi
  if [[ -f "$check_root/branding-application-menu.ready" && ! -f "$check_root/branding-application-menu.sent" ]]; then
    native_application_menu
    touch "$check_root/branding-application-menu.sent"
  fi
  for action in branding-location branding-location-escape branding-location-revert; do
    if [[ -f "$check_root/$action.ready" && ! -f "$check_root/$action.sent" ]]; then
      native_key "$action"
      touch "$check_root/$action.sent"
    fi
  done
  for capture in capture-branding-default-browser capture-branding-security capture-branding-extensions; do
    if [[ -f "$check_root/$capture.ready" && ! -f "$check_root/$capture.sent" ]]; then
      owned || exit 1
      # The native popup may already be open. Refocusing changes Cocoa popup ordering.
      screencapture -x "$artifact_dir/$capture.png"
      [[ -s "$artifact_dir/$capture.png" ]] || exit 1
      touch "$check_root/$capture.sent"
    fi
  done
  sleep 0.25
done
if kill -0 "$process_id" 2>/dev/null; then printf 'Branding verification exceeded its bounded wait.\n' >&2; exit 1; fi
result=0; wait "$process_id" || result=$?; process_id=""
if [[ "$result" != 0 ]] || ! grep -Fq 'user_pref("fluxion.branding.verification.health", "native-branding-and-security-preservation-verified")' "$profile/prefs.js"; then
  [[ ! -f "$profile/prefs.js" ]] || grep 'fluxion.branding.verification' "$profile/prefs.js" >&2 || true
  sed -n '1,160p' "$check_root/branding.log" >&2
  exit 1
fi
printf 'Verified packaged native Fluxion names, supplied transparent mark, preserved warning meanings and live HTTPS security controls.\n'
