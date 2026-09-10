#!/usr/bin/env bash
set -euo pipefail

[[ "$(uname -s)" == Darwin ]] || { printf 'The packaged Library verifier requires macOS.\n' >&2; exit 69; }
fluxion_root="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
app="${1:-$fluxion_root/../.runtime/Fluxion.app}"
launcher="$app/Contents/MacOS/Fluxion"
[[ -x "$launcher" ]] || { printf 'Fluxion launcher is missing: %s\n' "$launcher" >&2; exit 69; }
check_root="$(mktemp -d "${TMPDIR:-/tmp}/fluxion-library-check.XXXXXX")"
profile="$check_root/profile"
browser_log="$check_root/browser.log"
browser_pid=""
artifact_dir="${FLUXION_LIBRARY_ARTIFACT_DIR:-}"
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
  if [[ -n "$artifact_dir" ]]; then
    mkdir -p "$artifact_dir"
    [[ ! -f "$browser_log" ]] || cp "$browser_log" "$artifact_dir/library.log"
    if [[ -f "$profile/prefs.js" ]]; then
      grep 'user_pref("fluxion\.library\.verification\.' "$profile/prefs.js" > "$artifact_dir/library-evidence.txt" || true
    fi
  fi
  case "$check_root" in
    "${TMPDIR:-/tmp}"/fluxion-library-check.*) rm -rf -- "$check_root" ;;
    *) printf 'Refusing unsafe Library-check cleanup path: %s\n' "$check_root" >&2 ;;
  esac
}
trap cleanup EXIT

FLUXION_PROFILE="$profile" FLUXION_LIBRARY_SCALE_TEST=1 \
  "$launcher" about:blank >"$browser_log" 2>&1 &
browser_pid=$!
for ((attempt=0; attempt<720; attempt++)); do
  if [[ -f "$profile/prefs.js" ]]; then
    if grep -Fq 'user_pref("fluxion.library.verification.error"' "$profile/prefs.js"; then break; fi
    if grep -Fq 'user_pref("fluxion.library.verification.health", "full-places-search-and-pagination-verified")' "$profile/prefs.js"; then
      grep -Fq 'user_pref("fluxion.library.verification.interactionHealth", "roving-list-and-native-item-menu-verified")' "$profile/prefs.js" || {
        printf 'Native Library keyboard/menu evidence is missing.\n' >&2; break;
      }
      printf 'Verified full Places search, folder filtering, deterministic pagination, and latest-query results.\n'
      grep 'fluxion\.library\.verification\.report' "$profile/prefs.js"
      if [[ -n "${FLUXION_LIBRARY_SCREENSHOT:-}" ]]; then
        mkdir -p "$(dirname -- "$FLUXION_LIBRARY_SCREENSHOT")"
        /usr/sbin/screencapture -x "$FLUXION_LIBRARY_SCREENSHOT"
      fi
      exit 0
    fi
  fi
  kill -0 "$browser_pid" 2>/dev/null || break
  sleep 0.25
done
printf 'Packaged Library verification failed or timed out.\n' >&2
[[ ! -f "$profile/prefs.js" ]] || grep 'fluxion\.library\.verification\.' "$profile/prefs.js" >&2 || true
sed -n '1,160p' "$browser_log" >&2
exit 1
