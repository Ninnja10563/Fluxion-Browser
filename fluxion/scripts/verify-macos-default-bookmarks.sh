#!/usr/bin/env bash
set -euo pipefail
[[ "$(uname -s)" == Darwin ]] || { printf 'Default bookmark verification requires macOS.\n' >&2; exit 69; }
fluxion_root="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
app="${1:-$fluxion_root/../.runtime/Fluxion.app}"
launcher="$app/Contents/MacOS/Fluxion"
[[ -x "$launcher" ]] || { printf 'Fluxion launcher is missing.\n' >&2; exit 69; }
check_root="$(mktemp -d "${TMPDIR:-/tmp}/fluxion-defaults-check.XXXXXX")"
profile="$check_root/profile"
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
    "${TMPDIR:-/tmp}"/fluxion-defaults-check.*) rm -rf -- "$check_root" ;;
    *) printf 'Refusing unsafe defaults fixture cleanup.\n' >&2 ;;
  esac
}
trap cleanup EXIT
for phase in seed restore; do
  FLUXION_PROFILE="$profile" FLUXION_DEFAULT_BOOKMARKS_TEST="$phase" \
    "$launcher" about:blank >"$check_root/$phase.log" 2>&1 &
  process_id=$!
  for ((attempt=0; attempt<480; attempt++)); do
    kill -0 "$process_id" 2>/dev/null || break
    sleep 0.25
  done
  if kill -0 "$process_id" 2>/dev/null; then
    printf 'Default bookmark fixture did not quit cleanly during %s.\n' "$phase" >&2
    exit 1
  fi
  result=0
  wait "$process_id" || result=$?
  process_id=""
  if [[ "$result" != 0 ]] || ! grep -Fq "user_pref(\"fluxion.defaults.verification.$phase.health\", \"native-defaults-and-user-bookmarks-verified\")" "$profile/prefs.js"; then
    printf 'Native default bookmark verification failed during %s.\n' "$phase" >&2
    [[ ! -f "$profile/prefs.js" ]] || grep 'fluxion.defaults' "$profile/prefs.js" >&2 || true
    sed -n '1,140p' "$check_root/$phase.log" >&2
    exit 1
  fi
done
printf 'Verified fresh-profile Fluxion defaults and unchanged existing user bookmarks after restart.\n'
