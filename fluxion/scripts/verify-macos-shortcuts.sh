#!/usr/bin/env bash
set -euo pipefail
[[ "$(uname -s)" == Darwin ]] || { printf 'The native shortcut verifier requires macOS.\n' >&2; exit 69; }
fluxion_root="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
app="${1:-$fluxion_root/../.runtime/Fluxion.app}"
launcher="$app/Contents/MacOS/Fluxion"
[[ -x "$launcher" ]] || { printf 'Missing Fluxion launcher: %s\n' "$launcher" >&2; exit 69; }
check_root="$(mktemp -d "${TMPDIR:-/tmp}/fluxion-shortcut-check.XXXXXX")"
profile="$check_root/profile"
browser_pid=""
foreground_requested=false
artifact_dir="${FLUXION_SHORTCUT_ARTIFACT_DIR:-}"
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
    [[ ! -f "$check_root/browser.log" ]] || cp "$check_root/browser.log" "$artifact_dir/shortcuts.log"
    if [[ -f "$profile/prefs.js" ]]; then
      grep 'user_pref("fluxion\.shortcutVerification\.' "$profile/prefs.js" > "$artifact_dir/shortcuts-evidence.txt" || true
    fi
  fi
  case "$check_root" in
    "${TMPDIR:-/tmp}"/fluxion-shortcut-check.*) rm -rf -- "$check_root" ;;
    *) printf 'Refusing unsafe shortcut-check cleanup: %s\n' "$check_root" >&2 ;;
  esac
}
trap cleanup EXIT
FLUXION_PROFILE="$profile" FLUXION_SHORTCUT_TEST=1 \
  FLUXION_SHORTCUT_FOREGROUND_ACK="$check_root/foreground-ready" \
  "$launcher" about:blank >"$check_root/browser.log" 2>&1 &
browser_pid=$!
for ((attempt=0; attempt<480; attempt++)); do
  if [[ -f "$profile/prefs.js" ]]; then
    if [[ "$foreground_requested" == false ]] && grep -Fq 'user_pref("fluxion.shortcutVerification.foreground", "requested")' "$profile/prefs.js"; then
      /usr/bin/osascript -e "tell application \"System Events\" to set frontmost of first application process whose unix id is $browser_pid to true" || {
        printf 'Could not activate the owned shortcut fixture process.\n' >&2; break;
      }
      touch "$check_root/foreground-ready"
      foreground_requested=true
    fi
    if grep -Fq 'user_pref("fluxion.shortcutVerification.error"' "$profile/prefs.js"; then break; fi
    if grep -Fq 'user_pref("fluxion.shortcutVerification.health", "packaged-settings-shortcut-capture-and-cross-window-save-verified")' "$profile/prefs.js" &&
        grep -Fq 'user_pref("fluxion.shortcutVerification.preferences.health", "live-general-appearance-and-homepage-draft-verified")' "$profile/prefs.js"; then
      printf 'Verified packaged Gecko Settings capture, cross-window shortcuts, live General/Appearance controls and draft preservation using synthetic DOM events, not OS keyboard input.\n'
      grep 'fluxion\.shortcutVerification\.' "$profile/prefs.js"
      exit 0
    fi
  fi
  kill -0 "$browser_pid" 2>/dev/null || break
  sleep 0.25
done
printf 'Native shortcut verification failed.\n' >&2
[[ ! -f "$profile/prefs.js" ]] || grep 'fluxion\.shortcutVerification\.' "$profile/prefs.js" >&2 || true
sed -n '1,140p' "$check_root/browser.log" >&2
exit 1
