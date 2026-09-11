#!/usr/bin/env bash
set -euo pipefail
[[ "$(uname -s)" == Darwin ]] || { printf 'Native accessibility verification requires macOS.\n' >&2; exit 69; }
fluxion_root="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
app="${1:-$fluxion_root/../.runtime/Fluxion.app}"
app="$(CDPATH= cd -- "$app" && pwd)"
launcher="$app/Contents/MacOS/Fluxion"
[[ -x "$launcher" ]] || { printf 'Missing Fluxion launcher.\n' >&2; exit 69; }
check_root="$(mktemp -d "${TMPDIR:-/tmp}/fluxion-settings-accessibility.XXXXXX")"
profile="$check_root/profile"
log="$check_root/browser.log"
process_id=""
owned() {
  [[ -n "$process_id" ]] && kill -0 "$process_id" 2>/dev/null || return 1
  local command_line expected
  command_line="$(ps -ww -p "$process_id" -o command=)" || return 1
  expected="$app/Contents/MacOS/firefox --profile $profile"
  [[ "$command_line" == "$expected" || "$command_line" == "$expected "* ]]
}
cleanup() {
  if [[ -n "${FLUXION_SETTINGS_ACCESSIBILITY_ARTIFACT_DIR:-}" ]]; then
    mkdir -p "$FLUXION_SETTINGS_ACCESSIBILITY_ARTIFACT_DIR"
    [[ ! -f "$log" ]] || cp "$log" "$FLUXION_SETTINGS_ACCESSIBILITY_ARTIFACT_DIR/browser.log"
    if [[ -f "$profile/prefs.js" ]]; then
      grep 'fluxion.settingsAccessibility' "$profile/prefs.js" > "$FLUXION_SETTINGS_ACCESSIBILITY_ARTIFACT_DIR/report.txt" || true
    fi
  fi
  if owned; then
    kill "$process_id" 2>/dev/null || true
    for ((attempt=0; attempt<40; attempt++)); do
      owned || break
      sleep 0.25
    done
    if owned; then kill -KILL "$process_id" 2>/dev/null || true; fi
    wait "$process_id" 2>/dev/null || true
  fi
  case "$check_root" in
    "${TMPDIR:-/tmp}"/fluxion-settings-accessibility.*) rm -rf -- "$check_root" ;;
    *) printf 'Refusing unsafe accessibility fixture cleanup: %s\n' "$check_root" >&2 ;;
  esac
}
trap cleanup EXIT
FLUXION_PROFILE="$profile" FLUXION_SETTINGS_ACCESSIBILITY_TEST=1 \
  "$launcher" about:blank >"$log" 2>&1 &
process_id=$!
for ((attempt=0; attempt<720; attempt++)); do
  for capture in "capture:narrow-workspaces" "capture-exclusions:narrow-exclusion-lists"; do
    capture_key="${capture%%:*}"
    capture_image="${capture#*:}"
  if [[ -f "$check_root/$capture_key.ready" && ! -f "$check_root/$capture_key.sent" ]]; then
    owned || exit 1
    [[ -n "${FLUXION_SETTINGS_ACCESSIBILITY_ARTIFACT_DIR:-}" ]] || exit 1
    osascript - "$process_id" <<'APPLESCRIPT'
on run arguments
  set browserPID to (item 1 of arguments) as integer
  tell application "System Events"
    set ownedProcess to first application process whose unix id is browserPID
    set frontmost of ownedProcess to true
    delay 0.25
    if (unix id of first application process whose frontmost is true) is not browserPID then error "Wrong foreground browser"
  end tell
end run
APPLESCRIPT
    mkdir -p "$FLUXION_SETTINGS_ACCESSIBILITY_ARTIFACT_DIR"
    owned || exit 1
    screencapture -x "$FLUXION_SETTINGS_ACCESSIBILITY_ARTIFACT_DIR/$capture_image.png"
    touch "$check_root/$capture_key.sent"
  fi
  done
  if [[ -f "$profile/prefs.js" ]]; then
    if grep -Fq 'user_pref("fluxion.settingsAccessibility.error"' "$profile/prefs.js"; then break; fi
    if grep -Fq 'user_pref("fluxion.settingsAccessibility.health", "native-control-names-and-descriptions-verified")' "$profile/prefs.js" &&
       grep -Fq 'user_pref("fluxion.settingsAccessibility.geometry.health", "all-settings-sections-fit-320-and-600px")' "$profile/prefs.js"; then
      printf 'Verified actual Gecko accessible field names and descriptions across five Settings sections.\n'
      printf 'Verified every Settings section at320px and600px with real permission expiry and workspace edits.\n'
      grep 'user_pref("fluxion.settingsAccessibility.report"' "$profile/prefs.js"
      exit 0
    fi
  fi
  kill -0 "$process_id" 2>/dev/null || break
  sleep 0.25
done
printf 'Native Settings accessibility verification failed.\n' >&2
[[ ! -f "$profile/prefs.js" ]] || grep 'fluxion\.settingsAccessibility\.' "$profile/prefs.js" >&2 || true
sed -n '1,160p' "$log" >&2
exit 1
