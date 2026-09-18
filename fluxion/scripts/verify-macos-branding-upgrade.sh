#!/usr/bin/env bash
set -euo pipefail
[[ "$(uname -s)" == Darwin ]] || { printf 'Branding upgrade verification requires macOS.\n' >&2; exit 69; }
fluxion_root="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
candidate="$(CDPATH= cd -- "${1:-$fluxion_root/../.runtime/Fluxion.app}" && pwd)"
check_root="$(mktemp -d "${TMPDIR:-/tmp}/fluxion-branding-upgrade.XXXXXX")"
# The launcher resolves its own bundle with realpath. macOS TMPDIR commonly
# uses /var (a /private/var alias) and a trailing slash; normalize before every
# PID ownership check so direct-runtime and launcher phases name one app.
check_root="$(CDPATH= cd -P -- "$check_root" && pwd -P)"
app="$check_root/Fluxion.app"
profile="$check_root/profile"
artifact_dir="${FLUXION_BRANDING_UPGRADE_ARTIFACT_DIR:-$check_root/evidence}"
process_id=""
mkdir -p "$artifact_dir" "$profile"
owned() {
  [[ -n "$process_id" ]] && kill -0 "$process_id" 2>/dev/null || return 1
  local line
  line="$(ps -ww -p "$process_id" -o command=)" || return 1
  [[ "$line" == "$app/Contents/MacOS/firefox --profile $profile"* ]]
}
cleanup() {
  if owned; then
    kill "$process_id" 2>/dev/null || true
    for ((i=0; i<40; i++)); do owned || break; sleep 0.25; done
    if owned; then kill -KILL "$process_id" 2>/dev/null || true; fi
    wait "$process_id" 2>/dev/null || true
  fi
  if [[ -f "$profile/prefs.js" ]]; then
    grep 'fluxion.branding.upgrade' "$profile/prefs.js" > "$artifact_dir/final-report.txt" || true
  fi
  printf 'Branding upgrade fixture retained at %s\n' "$check_root" >&2
}
trap cleanup EXIT
sign_fixture() {
  codesign --force --sign - --timestamp=none --options runtime \
    --entitlements "$fluxion_root/packaging/macos/firefox-developer.entitlements.plist" "$app/Contents/MacOS/firefox"
  codesign --force --sign - --timestamp=none "$app/Contents/MacOS/Fluxion"
  codesign --force --sign - --timestamp=none "$app"
  codesign --verify --deep --strict "$app"
}
capture_menu() {
  owned || return 1
  osascript - "$process_id" > "$check_root/cache-menu.txt" <<'APPLESCRIPT'
on run arguments
  set browserPID to (item 1 of arguments) as integer
  with timeout of 10 seconds
    tell application "System Events"
      set ownedProcess to first application process whose unix id is browserPID
      set frontmost of ownedProcess to true
      delay 0.15
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
  screencapture -x "$artifact_dir/$1-menu.png"
  osascript - "$process_id" <<'APPLESCRIPT'
on run arguments
  tell application "System Events"
    set browserPID to (item 1 of arguments) as integer
    if (unix id of first application process whose frontmost is true) is not browserPID then error "Wrong foreground process"
    tell (first application process whose unix id is browserPID) to key code 53
  end tell
end run
APPLESCRIPT
  cp "$check_root/cache-menu.txt" "$artifact_dir/$1-menu.txt"
  touch "$check_root/cache-menu.sent"
}
run_phase() {
  local phase="$1" result=0
  rm -f -- "$check_root/cache-menu.ready" "$check_root/cache-menu.sent" "$check_root/cache-menu.txt"
  if [[ "$phase" == seed || "$phase" == legacy ]]; then
    # Bypass only the new launcher policy to reproduce the pre-fix same-build
    # update path. The actual native cache and application menu remain intact.
    env -u FLUXION_CHROME_CACHE_ID -u FLUXION_CHROME_CACHE_PENDING \
      FLUXION_ROOT="$app/Contents/Resources/fluxion" MOZ_APP_REMOTINGNAME=fluxion \
      FLUXION_BRANDING_CACHE_PHASE="$phase" FLUXION_BRANDING_CACHE_DRIVER="$check_root" \
      "$app/Contents/MacOS/firefox" --profile "$profile" about:blank >"$artifact_dir/$phase.log" 2>&1 &
  else
    FLUXION_PROFILE="$profile" FLUXION_BRANDING_CACHE_PHASE="$phase" FLUXION_BRANDING_CACHE_DRIVER="$check_root" \
      "$app/Contents/MacOS/Fluxion" about:blank >"$artifact_dir/$phase.log" 2>&1 &
  fi
  process_id=$!
  for ((attempt=0; attempt<240; attempt++)); do
    kill -0 "$process_id" 2>/dev/null || break
    if [[ -f "$check_root/cache-menu.ready" && ! -f "$check_root/cache-menu.sent" ]]; then capture_menu "$phase"; fi
    sleep 0.25
  done
  if kill -0 "$process_id" 2>/dev/null; then printf 'Upgrade phase %s timed out\n' "$phase" >&2; return 1; fi
  wait "$process_id" || result=$?
  process_id=""
  grep 'fluxion.branding.upgrade' "$profile/prefs.js" > "$artifact_dir/$phase-report.txt" || true
  [[ "$result" == 0 ]] && grep -Fq "user_pref(\"fluxion.branding.upgrade.health\", \"$phase\")" "$profile/prefs.js"
}
ditto "$candidate" "$app"
python3 "$fluxion_root/scripts/seed-branding-cache-fixture.py" "$app/Contents/Resources"
sign_fixture
run_phase seed
[[ -d "$profile/startupCache" ]]
# Keep exactly the same app path, Gecko identity and profile. Only the brand
# resource bytes change, just as when an older Fluxion app is replaced in place.
ditto "$candidate/Contents/Resources/browser/omni.ja" "$app/Contents/Resources/browser/omni.ja"
sign_fixture
run_phase legacy
run_phase repaired
run_phase warm
printf 'Reproduced old cached native menu, verified same-profile repair, and retained warm-start caching.\n'
