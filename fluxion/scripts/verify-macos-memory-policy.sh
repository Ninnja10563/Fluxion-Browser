#!/usr/bin/env bash
set -euo pipefail
[[ "$(uname -s)" == Darwin ]] || { printf 'Native Memory policy verification requires macOS.\n' >&2; exit 69; }
fluxion_root="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
app="${1:-$fluxion_root/../.runtime/Fluxion.app}"
launcher="$app/Contents/MacOS/Fluxion"
[[ -x "$launcher" ]] || { printf 'Missing Fluxion launcher: %s\n' "$launcher" >&2; exit 69; }
check_root="$(mktemp -d "${TMPDIR:-/tmp}/fluxion-memory-policy.XXXXXX")"
profile="$check_root/profile"
browser_pid=""
stop_browser() {
  if [[ -n "$browser_pid" ]]; then
    kill -TERM "$browser_pid" 2>/dev/null || true
    for ((attempt=0; attempt<120; attempt++)); do
      kill -0 "$browser_pid" 2>/dev/null || break
      sleep 0.25
    done
    if kill -0 "$browser_pid" 2>/dev/null; then return 1; fi
    wait "$browser_pid" 2>/dev/null || true
    browser_pid=""
  fi
}
cleanup() {
  if ! stop_browser; then
    kill -KILL "$browser_pid" 2>/dev/null || true
    wait "$browser_pid" 2>/dev/null || true
  fi
  case "$check_root" in
    "${TMPDIR:-/tmp}"/fluxion-memory-policy.*) rm -rf -- "$check_root" ;;
    *) printf 'Refusing unsafe fixture cleanup: %s\n' "$check_root" >&2 ;;
  esac
}
trap cleanup EXIT
for phase in seed check; do
  log="$check_root/$phase.log"
  FLUXION_PROFILE="$profile" FLUXION_MEMORY_POLICY_TEST="$phase" "$launcher" about:blank >"$log" 2>&1 &
  browser_pid=$!
  success=false
  if [[ "$phase" == seed ]]; then expected=prior-build-evidence-seeded; else expected=disabled-startup-policy-cleanup-verified; fi
  for ((attempt=0; attempt<360; attempt++)); do
    if [[ -f "$profile/prefs.js" ]]; then
      if grep -Fq 'user_pref("fluxion.memory.policyVerification.error"' "$profile/prefs.js"; then break; fi
      if grep -Fq "user_pref(\"fluxion.memory.policyVerification.$phase.health\", \"$expected\")" "$profile/prefs.js"; then
        success=true; break
      fi
    fi
    kill -0 "$browser_pid" 2>/dev/null || break
    sleep 0.25
  done
  if [[ "$success" != true ]]; then
    printf 'Native Memory policy %s failed.\n' "$phase" >&2
    [[ ! -f "$profile/prefs.js" ]] || grep 'fluxion\.memory\.policyVerification\.' "$profile/prefs.js" >&2 || true
    sed -n '1,140p' "$log" >&2
    exit 1
  fi
  grep 'user_pref("fluxion.memory.policyVerification.report"' "$profile/prefs.js"
  stop_browser || { printf 'Owned browser did not terminate gracefully; refusing restart.\n' >&2; exit 1; }
done
printf 'Verified ordinary disabled startup removes prior-build sensitive Memory evidence/vectors while preserving safe vector bytes and Places visits across a real relaunch. Synthetic storage vectors; no model inference.\n'
