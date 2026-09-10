#!/usr/bin/env bash
set -euo pipefail
[[ "$(uname -s)" == Darwin ]] || { printf 'Native Memory privacy verification requires macOS.\n' >&2; exit 69; }
fluxion_root="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
app="${1:-$fluxion_root/../.runtime/Fluxion.app}"
launcher="$app/Contents/MacOS/Fluxion"
[[ -x "$launcher" ]] || { printf 'Missing Fluxion launcher: %s\n' "$launcher" >&2; exit 69; }
check_root="$(mktemp -d "${TMPDIR:-/tmp}/fluxion-memory-privacy.XXXXXX")"
profile="$check_root/profile"
log="$check_root/browser.log"
browser_pid=""
cleanup() {
  if [[ -n "$browser_pid" ]] && kill -0 "$browser_pid" 2>/dev/null; then
    kill "$browser_pid" 2>/dev/null || true
    for ((attempt=0; attempt<40; attempt++)); do
      kill -0 "$browser_pid" 2>/dev/null || break
      sleep 0.25
    done
    if kill -0 "$browser_pid" 2>/dev/null; then kill -KILL "$browser_pid" 2>/dev/null || true; fi
    wait "$browser_pid" 2>/dev/null || true
  fi
  case "$check_root" in
    "${TMPDIR:-/tmp}"/fluxion-memory-privacy.*) rm -rf -- "$check_root" ;;
    *) printf 'Refusing unsafe privacy fixture cleanup: %s\n' "$check_root" >&2 ;;
  esac
}
trap cleanup EXIT
FLUXION_PROFILE="$profile" FLUXION_MEMORY_PRIVACY_TEST=1 "$launcher" about:blank >"$log" 2>&1 &
browser_pid=$!
for ((attempt=0; attempt<480; attempt++)); do
  if [[ -f "$profile/prefs.js" ]]; then
    if grep -Fq 'user_pref("fluxion.memory.privacy.error"' "$profile/prefs.js"; then break; fi
    if grep -Fq 'user_pref("fluxion.memory.privacy.health", "native-vectors-cleared-across-windows")' "$profile/prefs.js"; then
      printf 'Verified deletion of actual native vector and mapping rows across disable/re-enable and windows.\n'
      grep 'user_pref("fluxion.memory.privacy.report"' "$profile/prefs.js"
      exit 0
    fi
  fi
  kill -0 "$browser_pid" 2>/dev/null || break
  sleep 0.25
done
printf 'Native Memory privacy verification failed.\n' >&2
[[ ! -f "$profile/prefs.js" ]] || grep 'fluxion\.memory\.privacy\.' "$profile/prefs.js" >&2 || true
sed -n '1,160p' "$log" >&2
exit 1
