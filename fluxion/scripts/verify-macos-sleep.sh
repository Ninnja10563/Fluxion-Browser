#!/usr/bin/env bash
set -euo pipefail
[[ "$(uname -s)" == Darwin ]] || { printf 'The native sleeping verifier requires macOS.\n' >&2; exit 69; }
fluxion_root="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
app="${1:-$fluxion_root/../.runtime/Fluxion.app}"
launcher="$app/Contents/MacOS/Fluxion"
[[ -x "$launcher" ]] || { printf 'Missing Fluxion launcher: %s\n' "$launcher" >&2; exit 69; }
check_root="$(mktemp -d "${TMPDIR:-/tmp}/fluxion-sleep-check.XXXXXX")"
profile="$check_root/profile"
browser_pid=""
cleanup() {
  if [[ -n "$browser_pid" ]] && kill -0 "$browser_pid" 2>/dev/null; then
    kill "$browser_pid" 2>/dev/null || true
    for ((stop_attempt=0; stop_attempt<40; stop_attempt++)); do
      kill -0 "$browser_pid" 2>/dev/null || break
      sleep 0.25
    done
    if kill -0 "$browser_pid" 2>/dev/null; then kill -KILL "$browser_pid" 2>/dev/null || true; fi
    wait "$browser_pid" 2>/dev/null || true
  fi
  case "$check_root" in
    "${TMPDIR:-/tmp}"/fluxion-sleep-check.*) rm -rf -- "$check_root" ;;
    *) printf 'Refusing unsafe sleeping-check cleanup: %s\n' "$check_root" >&2 ;;
  esac
}
trap cleanup EXIT
FLUXION_PROFILE="$profile" FLUXION_VISUAL_SLEEP_TEST=1 \
  "$launcher" about:blank >"$check_root/browser.log" 2>&1 &
browser_pid=$!
for ((attempt=0; attempt<240; attempt++)); do
  if [[ -f "$profile/prefs.js" ]]; then
    if grep -Fq 'user_pref("fluxion.sleeping.error"' "$profile/prefs.js"; then break; fi
    if grep -Fq 'user_pref("fluxion.sleeping.health", "native-discard-scheduler-loaded")' "$profile/prefs.js" &&
       grep -Fq 'user_pref("fluxion.sleeping.visual.health", "native-tab-discarded")' "$profile/prefs.js" &&
       grep -Fq 'user_pref("fluxion.sleeping.race.health", "pin-during-flush-kept-native-tab-live")' "$profile/prefs.js"; then
      printf 'Verified isolated native discard and pin-during-flush protection.\n'
      grep 'fluxion\.sleeping\.' "$profile/prefs.js"
      exit 0
    fi
  fi
  kill -0 "$browser_pid" 2>/dev/null || break
  sleep 0.25
done
printf 'Native sleeping verification failed.\n' >&2
[[ ! -f "$profile/prefs.js" ]] || grep 'fluxion\.sleeping\.' "$profile/prefs.js" >&2 || true
sed -n '1,120p' "$check_root/browser.log" >&2
exit 1
