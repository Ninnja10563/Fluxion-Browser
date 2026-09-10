#!/usr/bin/env bash
set -euo pipefail
[[ "$(uname -s)" == Darwin ]] || { printf 'Native structure verification requires macOS.\n' >&2; exit 69; }
fluxion_root="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
app="${1:-$fluxion_root/../.runtime/Fluxion.app}"
app="$(CDPATH= cd -- "$app" && pwd)"
launcher="$app/Contents/MacOS/Fluxion"
[[ -x "$launcher" ]] || exit 69
check_root="$(mktemp -d "${TMPDIR:-/tmp}/fluxion-structure-check.XXXXXX")"
profile="$check_root/profile"
log="$check_root/browser.log"
process_id=""
owned() {
  [[ -n "$process_id" ]] && kill -0 "$process_id" 2>/dev/null || return 1
  local command_line expected
  command_line="$(ps -ww -p "$process_id" -o command=)" || return 1
  expected="$app/Contents/MacOS/firefox --profile $profile"
  [[ "$command_line" == "$expected" || "$command_line" == "$expected "* ]]
}
cleanup() {
  if [[ -n "${FLUXION_STRUCTURE_ARTIFACT_DIR:-}" ]]; then
    mkdir -p "$FLUXION_STRUCTURE_ARTIFACT_DIR"
    [[ ! -f "$log" ]] || cp "$log" "$FLUXION_STRUCTURE_ARTIFACT_DIR/browser.log"
    if [[ -f "$profile/prefs.js" ]]; then grep 'fluxion.structure.verification' "$profile/prefs.js" > "$FLUXION_STRUCTURE_ARTIFACT_DIR/report.txt" || true; fi
  fi
  if owned; then
    kill "$process_id" 2>/dev/null || true
    for ((attempt=0; attempt<40; attempt++)); do owned || break; sleep 0.25; done
    if owned; then kill -KILL "$process_id" 2>/dev/null || true; fi
    wait "$process_id" 2>/dev/null || true
  fi
  case "$check_root" in "${TMPDIR:-/tmp}"/fluxion-structure-check.*) rm -rf -- "$check_root";; esac
}
trap cleanup EXIT
FLUXION_PROFILE="$profile" FLUXION_STRUCTURE_TEST=1 "$launcher" about:blank >"$log" 2>&1 &
process_id=$!
for ((attempt=0; attempt<600; attempt++)); do
  if [[ -f "$profile/prefs.js" ]]; then
    if grep -Fq 'user_pref("fluxion.structure.verification.error"' "$profile/prefs.js"; then break; fi
    if grep -Fq 'user_pref("fluxion.structure.verification.health", "keyed-1000-tab-structure-and-native-fallbacks-verified")' "$profile/prefs.js"; then
      grep 'fluxion.structure.verification' "$profile/prefs.js"
      exit 0
    fi
  fi
  kill -0 "$process_id" 2>/dev/null || break
  sleep 0.25
done
printf 'Native thousand-tab structural verification failed.\n' >&2
[[ ! -f "$profile/prefs.js" ]] || grep 'fluxion.structure.verification' "$profile/prefs.js" >&2 || true
sed -n '1,160p' "$log" >&2
exit 1
