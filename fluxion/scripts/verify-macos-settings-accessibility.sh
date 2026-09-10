#!/usr/bin/env bash
set -euo pipefail
[[ "$(uname -s)" == Darwin ]] || { printf 'Native accessibility verification requires macOS.\n' >&2; exit 69; }
fluxion_root="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
app="${1:-$fluxion_root/../.runtime/Fluxion.app}"
launcher="$app/Contents/MacOS/Fluxion"
[[ -x "$launcher" ]] || { printf 'Missing Fluxion launcher.\n' >&2; exit 69; }
check_root="$(mktemp -d "${TMPDIR:-/tmp}/fluxion-settings-accessibility.XXXXXX")"
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
    "${TMPDIR:-/tmp}"/fluxion-settings-accessibility.*) rm -rf -- "$check_root" ;;
    *) printf 'Refusing unsafe accessibility fixture cleanup: %s\n' "$check_root" >&2 ;;
  esac
}
trap cleanup EXIT
FLUXION_PROFILE="$profile" FLUXION_SETTINGS_ACCESSIBILITY_TEST=1 \
  "$launcher" about:blank >"$log" 2>&1 &
process_id=$!
for ((attempt=0; attempt<240; attempt++)); do
  if [[ -f "$profile/prefs.js" ]]; then
    if grep -Fq 'user_pref("fluxion.settingsAccessibility.error"' "$profile/prefs.js"; then break; fi
    if grep -Fq 'user_pref("fluxion.settingsAccessibility.health", "native-control-names-and-descriptions-verified")' "$profile/prefs.js"; then
      printf 'Verified actual Gecko accessible field names and descriptions across five Settings sections.\n'
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
