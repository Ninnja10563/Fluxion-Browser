#!/usr/bin/env bash
set -euo pipefail
[[ "$(uname -s)" == Darwin ]] || { printf 'Native AI privacy verification requires macOS.\n' >&2; exit 69; }
fluxion_root="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
app="${1:-$fluxion_root/../.runtime/Fluxion.app}"
launcher="$app/Contents/MacOS/Fluxion"
[[ -x "$launcher" ]] || { printf 'Missing Fluxion launcher.\n' >&2; exit 69; }
check_root="$(mktemp -d "${TMPDIR:-/tmp}/fluxion-ai-privacy.XXXXXX")"
profile="$check_root/profile"
log="$check_root/browser.log"
server_log="$check_root/server.log"
process_id=""
server_pid=""
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
  if [[ -n "$server_pid" ]]; then kill "$server_pid" 2>/dev/null || true; wait "$server_pid" 2>/dev/null || true; fi
  case "$check_root" in
    "${TMPDIR:-/tmp}"/fluxion-ai-privacy.*) rm -rf -- "$check_root" ;;
    *) printf 'Refusing unsafe AI fixture cleanup: %s\n' "$check_root" >&2 ;;
  esac
}
trap cleanup EXIT
node "$fluxion_root/scripts/ai-privacy-fixture.mjs" >"$server_log" 2>&1 &
server_pid=$!
for ((attempt=0; attempt<80; attempt++)); do
  if [[ -s "$server_log" ]] && node -e 'try {const row=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8").split("\n")[0]); process.exit(/^http:\/\/127\.0\.0\.1:\d+$/.test(row.origin)?0:1);} catch {process.exit(1)}' "$server_log"; then break; fi
  kill -0 "$server_pid" 2>/dev/null || { printf 'AI fixture server stopped.\n' >&2; exit 1; }
  sleep 0.1
done
(( attempt < 80 )) || { printf 'AI fixture server did not become ready.\n' >&2; exit 1; }
origin="$(node -e 'console.log(JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8").split("\n")[0]).origin)' "$server_log")"
FLUXION_PROFILE="$profile" FLUXION_AI_PRIVACY_TEST=1 FLUXION_AI_PRIVACY_ORIGIN="$origin" \
  "$launcher" about:blank >"$log" 2>&1 &
process_id=$!
for ((attempt=0; attempt<360; attempt++)); do
  if [[ -f "$profile/prefs.js" ]]; then
    if grep -Fq 'user_pref("fluxion.aiPrivacy.error"' "$profile/prefs.js"; then break; fi
    if grep -Fq 'user_pref("fluxion.aiPrivacy.health", "endpoint-credentials-and-sharing-revocation-verified")' "$profile/prefs.js"; then
      printf 'Verified real endpoint-scoped credentials and pending page-sharing revocation.\n'
      grep 'user_pref("fluxion.aiPrivacy.report"' "$profile/prefs.js"
      exit 0
    fi
  fi
  kill -0 "$process_id" 2>/dev/null || break
  sleep 0.25
done
printf 'Native AI privacy verification failed.\n' >&2
[[ ! -f "$profile/prefs.js" ]] || grep 'fluxion\.aiPrivacy\.' "$profile/prefs.js" >&2 || true
sed -n '1,160p' "$log" >&2
exit 1
