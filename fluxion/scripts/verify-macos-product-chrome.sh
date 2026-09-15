#!/usr/bin/env bash
set -euo pipefail
[[ "$(uname -s)" == Darwin ]] || { printf 'Product chrome verification requires macOS.\n' >&2; exit 69; }
fluxion_root="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
app="${1:-$fluxion_root/../.runtime/Fluxion.app}"
app="$(CDPATH= cd -- "$app" && pwd)"
launcher="$app/Contents/MacOS/Fluxion"
[[ -x "$launcher" ]] || { printf 'Fluxion launcher is missing.\n' >&2; exit 69; }
check_root="$(mktemp -d "${TMPDIR:-/tmp}/fluxion-product-chrome-check.XXXXXX")"
profile="$check_root/profile"
artifact_dir="${FLUXION_PRODUCT_CHROME_ARTIFACT_DIR:-$check_root/captures}"
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
  [[ ! -f "$check_root/browser.log" ]] || cp "$check_root/browser.log" "$artifact_dir/product-chrome.log"
  if [[ -f "$profile/prefs.js" ]]; then
    grep 'fluxion.productChrome.verification' "$profile/prefs.js" > "$artifact_dir/product-chrome-report.txt" || true
  fi
  printf 'Product chrome fixture and logs retained at: %s\n' "$check_root" >&2
}
trap cleanup EXIT
foreground() {
  owned || { printf 'Product chrome capture driver lost its exact owned browser process.\n' >&2; return 1; }
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
mkdir -p "$artifact_dir" "$profile"
# Seed an existing enabled user preference before autoconfig runs. This fixture
# owns a newly created profile and never writes to the user's browsing profile.
printf '%s\n' 'user_pref("browser.ipProtection.enabled", true);' \
  'user_pref("fluxion.productChrome.fixture.seeded", "inherited-vpn-enabled");' > "$profile/prefs.js"
FLUXION_PROFILE="$profile" FLUXION_PRODUCT_CHROME_TEST=1 FLUXION_PRODUCT_CHROME_DRIVER_DIR="$check_root" \
  "$launcher" about:blank >"$check_root/browser.log" 2>&1 &
process_id=$!
for ((attempt=0; attempt<720; attempt++)); do
  kill -0 "$process_id" 2>/dev/null || break
  for action in capture-product-chrome-1280 capture-product-chrome-800 capture-product-suggestions-1280 capture-product-suggestions-800; do
    if [[ -f "$check_root/$action.ready" && ! -f "$check_root/$action.sent" ]]; then
      foreground
      owned || exit 1
      screencapture -x "$artifact_dir/$action.png"
      [[ -s "$artifact_dir/$action.png" ]] || { printf 'Product chrome screenshot is missing.\n' >&2; exit 1; }
      touch "$check_root/$action.sent"
    fi
  done
  sleep 0.25
done
if kill -0 "$process_id" 2>/dev/null; then printf 'Product chrome verification exceeded its bounded driver wait.\n' >&2; exit 1; fi
result=0; wait "$process_id" || result=$?; process_id=""
if [[ "$result" != 0 ]] || ! grep -Fq 'user_pref("fluxion.productChrome.verification.health", "native-product-policy-and-toolbar-geometry-verified")' "$profile/prefs.js"; then
  [[ ! -f "$profile/prefs.js" ]] || grep 'fluxion.productChrome.verification' "$profile/prefs.js" >&2 || true
  sed -n '1,180p' "$check_root/browser.log" >&2
  exit 1
fi
grep 'fluxion.productChrome.verification' "$profile/prefs.js"
printf 'Verified inherited VPN feature exclusion, actual nonoverlapping toolbar controls, balanced normal/focused address padding at 1280/800px, and native Places suggestion anchoring.\n'
