#!/usr/bin/env bash
set -euo pipefail

fluxion_root="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
profile="${TMPDIR:-/tmp}/fluxion-smoke-profile-$$"
process_id=""

cleanup() {
  if [[ -n "$process_id" ]] && kill -0 "$process_id" 2>/dev/null; then
    kill "$process_id" 2>/dev/null || true
    wait "$process_id" 2>/dev/null || true
  fi
  rm -rf -- "$profile"
}
trap cleanup EXIT

if [[ "$(uname -s)" != "Darwin" && -z "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]]; then
  printf '%s\n' \
    'No graphical display is available.' \
    'Run this check in a desktop session or under Xvfb; unit checks remain headless.' >&2
  exit 77
fi

FLUXION_PROFILE="$profile" "$fluxion_root/bin/fluxion" \
  "file://$fluxion_root/newtab/index.html" &
process_id=$!

attempt=0
while (( attempt < 80 )); do
  if [[ -f "$profile/prefs.js" ]] && \
      grep -q 'user_pref("fluxion.chrome.health", "flow-sidebar-loaded")' "$profile/prefs.js" && \
      grep -q 'user_pref("fluxion.palette.health", "command-palette-loaded")' "$profile/prefs.js"; then
    printf 'Gecko loaded Fluxion chrome and command palette successfully.\n'
    exit 0
  fi
  if ! kill -0 "$process_id" 2>/dev/null; then
    wait "$process_id"
    printf 'Gecko exited before Fluxion browser chrome loaded.\n' >&2
    exit 1
  fi
  sleep 0.25
  ((attempt += 1))
done

printf 'Timed out waiting for Fluxion browser chrome.\n' >&2
exit 1
