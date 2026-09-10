#!/usr/bin/env bash
set -euo pipefail
[[ "$(uname -s)" == Darwin ]] || { printf 'Native corruption verification requires macOS.\n' >&2; exit 69; }
fluxion_root="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
app="${1:-$fluxion_root/../.runtime/Fluxion.app}"
launcher="$app/Contents/MacOS/Fluxion"
[[ -x "$launcher" ]] || { printf 'Missing Fluxion launcher: %s\n' "$launcher" >&2; exit 69; }
check_root="$(mktemp -d "${TMPDIR:-/tmp}/fluxion-memory-corruption.XXXXXX")"
profile="$check_root/profile"
artifact_dir="${FLUXION_MEMORY_CORRUPTION_ARTIFACT_DIR:-${RUNNER_TEMP:-$check_root}/fluxion-memory-corruption-evidence}"
mkdir -p "$artifact_dir"
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
    "${TMPDIR:-/tmp}"/fluxion-memory-corruption.*) rm -rf -- "$check_root" ;;
    *) printf 'Refusing unsafe fixture cleanup: %s\n' "$check_root" >&2 ;;
  esac
}
trap cleanup EXIT
for phase in seed check; do
  log="$artifact_dir/$phase.log"
  FLUXION_PROFILE="$profile" FLUXION_MEMORY_CORRUPTION_TEST="$phase" "$launcher" about:blank >"$log" 2>&1 &
  browser_pid=$!
  success=false
  if [[ "$phase" == seed ]]; then expected=native-corruption-baseline-seeded; else expected=native-corruption-retention-verified; fi
  for ((attempt=0; attempt<480; attempt++)); do
    if [[ -f "$profile/prefs.js" ]]; then
      if grep -Fq 'user_pref("fluxion.memory.corruptionVerification.error"' "$profile/prefs.js"; then break; fi
      if grep -Fq "user_pref(\"fluxion.memory.corruptionVerification.$phase.health\", \"$expected\")" "$profile/prefs.js"; then
        success=true; break
      fi
    fi
    kill -0 "$browser_pid" 2>/dev/null || break
    sleep 0.25
  done
  if [[ -f "$profile/prefs.js" ]]; then
    grep 'fluxion\.memory\.corruptionVerification\.' "$profile/prefs.js" >"$artifact_dir/$phase-prefs.txt" || true
  fi
  if [[ "$success" != true ]]; then
    printf 'Native Memory corruption %s failed.\n' "$phase" >&2
    [[ ! -f "$artifact_dir/$phase-prefs.txt" ]] || sed -n '1,80p' "$artifact_dir/$phase-prefs.txt" >&2
    sed -n '1,140p' "$log" >&2
    exit 1
  fi
  stop_browser || { printf 'Owned browser did not terminate gracefully; refusing success/restart.\n' >&2; exit 1; }
  grep 'user_pref("fluxion.memory.corruptionVerification.report"' "$profile/prefs.js"
done
printf 'Verified malformed policy retains native vector/mapping bytes across restart and direct Gecko manager initialization, while explicit purge still works. Synthetic storage vectors; no model inference.\n'
