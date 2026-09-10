#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  printf 'The real Gecko semantic model check must run on macOS.\n' >&2
  exit 69
fi

fluxion_root="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
app="${1:-$fluxion_root/../.runtime/Fluxion.app}"
launcher="$app/Contents/MacOS/Fluxion"
if [[ ! -x "$launcher" ]]; then
  printf 'Fluxion launcher is missing: %s\n' "$launcher" >&2
  exit 69
fi

check_root="$(mktemp -d "${TMPDIR:-/tmp}/fluxion-semantic-check.XXXXXX")"
profile="$check_root/profile"
log="$check_root/fluxion.log"
process_id=""
cleanup() {
  if [[ -n "$process_id" ]] && kill -0 "$process_id" 2>/dev/null; then
    kill "$process_id" 2>/dev/null || true
    for (( attempt = 0; attempt < 40; attempt += 1 )); do
      if ! kill -0 "$process_id" 2>/dev/null; then break; fi
      sleep 0.25
    done
    if kill -0 "$process_id" 2>/dev/null; then kill -KILL "$process_id" 2>/dev/null || true; fi
    wait "$process_id" 2>/dev/null || true
  fi
  find "$check_root" -depth -delete
}
trap cleanup EXIT

printf 'Verifying real Gecko local embeddings and nonliteral retrieval in a fresh profile...\n' >&2
FLUXION_PROFILE="$profile" FLUXION_SEMANTIC_MODEL_TEST=1 \
  "$launcher" about:blank >"$log" 2>&1 &
process_id=$!
for (( attempt = 0; attempt < 1040; attempt += 1 )); do
  if [[ -f "$profile/prefs.js" ]]; then
    if grep -q 'user_pref("fluxion.memory.semantic.health", "gecko-model-generated-vectors-and-recalled-nonliteral-evidence")' "$profile/prefs.js"; then
      printf 'Verified real Gecko model vectors and semantic-only plant evidence retrieval.\n' >&2
      exit 0
    fi
    if grep -q 'user_pref("fluxion.memory.semantic.error",' "$profile/prefs.js"; then break; fi
  fi
  if ! kill -0 "$process_id" 2>/dev/null; then break; fi
  sleep 0.25
done

printf 'The real local semantic model gate failed; keyword fallback does not pass this check.\n' >&2
if [[ -f "$profile/prefs.js" ]]; then
  grep 'user_pref("fluxion.memory.semantic\.' "$profile/prefs.js" >&2 || true
fi
sed -n '1,160p' "$log" >&2
exit 1
