#!/usr/bin/env bash
set -euo pipefail
[[ "$(uname -s)" == Darwin ]] || { printf 'The native workspace verifier requires macOS.\n' >&2; exit 69; }
fluxion_root="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
app="${1:-$fluxion_root/../.runtime/Fluxion.app}"
launcher="$app/Contents/MacOS/Fluxion"
[[ -x "$launcher" ]] || { printf 'Missing Fluxion launcher: %s\n' "$launcher" >&2; exit 69; }
check_root="$(mktemp -d "${TMPDIR:-/tmp}/fluxion-workspace-check.XXXXXX")"
profile="$check_root/profile"
browser_pid=""
artifact_dir="${FLUXION_WORKSPACE_ARTIFACT_DIR:-}"
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
    [[ ! -f "$check_root/browser.log" ]] || cp "$check_root/browser.log" "$artifact_dir/workspaces.log"
    if [[ -f "$profile/prefs.js" ]]; then
      grep 'user_pref("fluxion\.workspaceVerification\.' "$profile/prefs.js" > "$artifact_dir/workspaces-evidence.txt" || true
    fi
  fi
  case "$check_root" in
    "${TMPDIR:-/tmp}"/fluxion-workspace-check.*) rm -rf -- "$check_root" ;;
    *) printf 'Refusing unsafe workspace-check cleanup: %s\n' "$check_root" >&2 ;;
  esac
}
trap cleanup EXIT
FLUXION_PROFILE="$profile" FLUXION_WORKSPACE_TEST=1 \
  "$launcher" about:blank >"$check_root/browser.log" 2>&1 &
browser_pid=$!
for ((attempt=0; attempt<480; attempt++)); do
  if [[ -f "$profile/prefs.js" ]]; then
    if grep -Fq 'user_pref("fluxion.workspaceVerification.error"' "$profile/prefs.js"; then break; fi
    if grep -Fq 'user_pref("fluxion.workspaceVerification.health", "native-workspace-restoration-and-cross-window-editing-verified")' "$profile/prefs.js"; then
      printf 'Verified native workspace restoration, cross-window Flow focus, and Settings drafts.\n'
      grep 'fluxion\.workspaceVerification\.' "$profile/prefs.js"
      exit 0
    fi
  fi
  kill -0 "$browser_pid" 2>/dev/null || break
  sleep 0.25
done
printf 'Native workspace verification failed.\n' >&2
[[ ! -f "$profile/prefs.js" ]] || grep 'fluxion\.workspaceVerification\.' "$profile/prefs.js" >&2 || true
sed -n '1,140p' "$check_root/browser.log" >&2
exit 1
