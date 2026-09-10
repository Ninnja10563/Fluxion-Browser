#!/usr/bin/env bash
set -euo pipefail
[[ "$(uname -s)" == Darwin ]] || { printf 'Native update verification requires macOS.\n' >&2; exit 69; }
fluxion_root="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
app="${1:-$fluxion_root/../.runtime/Fluxion.app}"
launcher="$app/Contents/MacOS/Fluxion"
[[ -x "$launcher" ]] || { printf 'Missing Fluxion launcher: %s\n' "$launcher" >&2; exit 69; }
expected_release="$(node -p 'require(process.argv[1]).version' "$fluxion_root/package.json")"
check_root="$(mktemp -d "${TMPDIR:-/tmp}/fluxion-updates.XXXXXX")"
profile="$check_root/profile"
log="$check_root/browser.log"
process_id=""
cleanup() {
  if [[ -n "$process_id" ]] && kill -0 "$process_id" 2>/dev/null; then
    kill "$process_id" 2>/dev/null || true
    for ((attempt=0; attempt<40; attempt++)); do
      kill -0 "$process_id" 2>/dev/null || break
      sleep 0.25
    done
    if kill -0 "$process_id" 2>/dev/null; then kill -KILL "$process_id" 2>/dev/null || true; fi
    wait "$process_id" 2>/dev/null || true
  fi
  case "$check_root" in
    "${TMPDIR:-/tmp}"/fluxion-updates.*) rm -rf -- "$check_root" ;;
    *) printf 'Refusing unsafe update fixture cleanup: %s\n' "$check_root" >&2 ;;
  esac
}
trap cleanup EXIT
FLUXION_PROFILE="$profile" FLUXION_UPDATE_TEST=1 FLUXION_EXPECTED_RELEASE="$expected_release" \
  "$launcher" about:blank >"$log" 2>&1 &
process_id=$!
for ((attempt=0; attempt<240; attempt++)); do
  if [[ -f "$profile/prefs.js" ]]; then
    if grep -Fq 'user_pref("fluxion.updateVerification.error"' "$profile/prefs.js"; then break; fi
    if grep -Fq 'user_pref("fluxion.updateVerification.health", "explicit-release-check-without-automatic-download")' "$profile/prefs.js"; then
      printf 'Verified user-triggered release discovery with no cookies, referrer, or automatic asset downloads.\n'
      grep 'user_pref("fluxion.updateVerification.report"' "$profile/prefs.js"
      if [[ -n "${FLUXION_UPDATES_SCREENSHOT:-}" ]]; then
        osascript -e "tell application \"System Events\" to set frontmost of first application process whose unix id is $process_id to true" >/dev/null 2>&1 || true
        sleep 1
        screencapture -x "$FLUXION_UPDATES_SCREENSHOT"
      fi
      exit 0
    fi
  fi
  kill -0 "$process_id" 2>/dev/null || break
  sleep 0.25
done
printf 'Native update verification failed.\n' >&2
[[ ! -f "$profile/prefs.js" ]] || grep 'fluxion\.updateVerification\.' "$profile/prefs.js" >&2 || true
sed -n '1,160p' "$log" >&2
exit 1
