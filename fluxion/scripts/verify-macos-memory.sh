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
for (( attempt = 0; attempt < 1280; attempt += 1 )); do
  if [[ -f "$profile/prefs.js" ]]; then
    if grep -q 'user_pref("fluxion.memory.semantic.health", "gecko-model-generated-vectors-and-recalled-nonliteral-evidence")' "$profile/prefs.js" &&
       grep -Fq 'user_pref("fluxion.memory.migration.health", "native-v1-migration-preserved-evidence-and-vec0-bytes")' "$profile/prefs.js"; then
      grep -Fq 'user_pref("fluxion.memory.ranking.health", "old-exact-page-recalled-beyond-native-candidate-cap")' "$profile/prefs.js" || {
        printf 'Integrated exact-match ranking evidence is missing.\n' >&2; exit 1;
      }
      grep -Fq 'user_pref("fluxion.memory.unicode.health", "normalized-body-only-recall-preserves-original-evidence")' "$profile/prefs.js" || {
        printf 'Integrated normalized body-only recall evidence is missing.\n' >&2; exit 1;
      }
      printf 'Verified old exact-match and normalized body-only recall, real Gecko model vectors, and semantic-only plant evidence retrieval.\n' >&2
      exit 0
    fi
    if grep -Eq 'user_pref\("fluxion.memory.(semantic|migration).error",' "$profile/prefs.js"; then break; fi
  fi
  if ! kill -0 "$process_id" 2>/dev/null; then break; fi
  sleep 0.25
done

printf 'The real local semantic model gate failed; keyword fallback does not pass this check.\n' >&2
if [[ -f "$profile/prefs.js" ]]; then
  grep -E 'user_pref\("fluxion.memory.(semantic|ranking|unicode|migration)\.' "$profile/prefs.js" >&2 || true
fi
sed -n '1,160p' "$log" >&2
exit 1
