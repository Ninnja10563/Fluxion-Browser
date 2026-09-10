#!/usr/bin/env bash
set -euo pipefail
[[ "$(uname -s)" == Darwin ]] || { printf 'Native tab adoption requires macOS.\n' >&2; exit 69; }
fluxion_root="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
app="${1:-$fluxion_root/../.runtime/Fluxion.app}"
launcher="$app/Contents/MacOS/Fluxion"
[[ -x "$launcher" ]] || { printf 'Missing Fluxion launcher: %s\n' "$launcher" >&2; exit 69; }
check_root="$(mktemp -d "${TMPDIR:-/tmp}/fluxion-tab-transfer-check.XXXXXX")"
profile="$check_root/profile"
browser_log="$check_root/browser.log"
server_log="$check_root/server.log"
browser_pid=""
server_pid=""
cleanup() {
  for pid in "$browser_pid" "$server_pid"; do
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      for ((stop_attempt=0; stop_attempt<40; stop_attempt++)); do
        kill -0 "$pid" 2>/dev/null || break
        sleep 0.25
      done
      if kill -0 "$pid" 2>/dev/null; then kill -KILL "$pid" 2>/dev/null || true; fi
      wait "$pid" 2>/dev/null || true
    fi
  done
  if [[ -n "${FLUXION_TAB_TRANSFER_ARTIFACT_DIR:-}" ]]; then
    mkdir -p "$FLUXION_TAB_TRANSFER_ARTIFACT_DIR"
    for log in "$browser_log" "$server_log"; do
      [[ ! -f "$log" ]] || cp "$log" "$FLUXION_TAB_TRANSFER_ARTIFACT_DIR/tab-transfer-$(basename "$log")"
    done
    if [[ -f "$profile/prefs.js" ]]; then
      grep 'user_pref("fluxion.tabTransfer.verification.' "$profile/prefs.js" > "$FLUXION_TAB_TRANSFER_ARTIFACT_DIR/tab-transfer-evidence.txt" || true
    fi
  fi
  case "$check_root" in
    "${TMPDIR:-/tmp}"/fluxion-tab-transfer-check.*) rm -rf -- "$check_root" ;;
    *) printf 'Refusing unsafe transfer cleanup path: %s\n' "$check_root" >&2 ;;
  esac
}
trap cleanup EXIT
node "$fluxion_root/scripts/tab-transfer-fixture.mjs" 0 >"$server_log" 2>&1 &
server_pid=$!
for ((attempt=0; attempt<80; attempt++)); do
  if [[ -s "$server_log" ]]; then break; fi
  kill -0 "$server_pid" 2>/dev/null || { cat "$server_log" >&2; exit 1; }
  sleep 0.1
done
origin="$(node -e 'const f=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8").split("\n")[0]); if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(f.origin))throw Error("Invalid transfer fixture origin");console.log(f.origin)' "$server_log")"
FLUXION_PROFILE="$profile" FLUXION_TAB_TRANSFER_TEST=1 FLUXION_TAB_TRANSFER_ORIGIN="$origin" \
  "$launcher" about:blank >"$browser_log" 2>&1 &
browser_pid=$!
for ((attempt=0; attempt<1200; attempt++)); do
  if [[ -f "$profile/prefs.js" ]]; then
    if grep -Fq 'user_pref("fluxion.tabTransfer.verification.health", "native-adoption-live-state-privacy-and-detach-verified")' "$profile/prefs.js" &&
       grep -Fq 'shipped-flow-context-menu-dom-command-adopts-live-document' "$profile/prefs.js"; then
      printf 'Native tab adoption retained live documents, history, pin/container/workspace state, privacy boundaries, and detached windows.\n' >&2
      grep 'user_pref("fluxion.tabTransfer.verification.' "$profile/prefs.js" >&2 || true
      exit 0
    fi
    if grep -Fq 'user_pref("fluxion.tabTransfer.verification.error",' "$profile/prefs.js"; then break; fi
  fi
  kill -0 "$browser_pid" 2>/dev/null && kill -0 "$server_pid" 2>/dev/null || break
  sleep 0.25
done
printf 'Native tab-transfer gate failed; URL recreation does not pass this check.\n' >&2
if [[ -f "$profile/prefs.js" ]]; then grep 'user_pref("fluxion.tabTransfer.verification.' "$profile/prefs.js" >&2 || true; fi
sed -n '1,180p' "$browser_log" >&2
exit 1
