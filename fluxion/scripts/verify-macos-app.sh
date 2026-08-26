#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  printf 'The Fluxion.app integration check must run on macOS.\n' >&2
  exit 69
fi

fluxion_root="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
app="${1:-$fluxion_root/../.runtime/Fluxion.app}"
launcher="$app/Contents/MacOS/Fluxion"
if [[ ! -x "$launcher" ]]; then
  printf 'Fluxion launcher is missing: %s\n' "$launcher" >&2
  exit 69
fi

check_root="$(mktemp -d "${TMPDIR:-/tmp}/fluxion-app-check.XXXXXX")"
profile="$check_root/profile"
log="$check_root/fluxion.log"
process_id=""

cleanup() {
  if [[ -n "$process_id" ]] && kill -0 "$process_id" 2>/dev/null; then
    kill "$process_id" 2>/dev/null || true
    wait "$process_id" 2>/dev/null || true
  fi
  rm -rf -- "$check_root"
}
trap cleanup EXIT

printf 'Verifying that the Flow tab sidebar loads...\n' >&2
FLUXION_PROFILE="$profile" FLUXION_VISUAL_GROUP_TEST=1 FLUXION_VISUAL_SPLIT_TEST=1 FLUXION_VISUAL_MEMORY_TEST=1 \
  "$launcher" https://example.com/ >"$log" 2>&1 &
process_id=$!

attempt=0
while (( attempt < 240 )); do
  if [[ -f "$profile/prefs.js" ]] && \
      grep -q 'user_pref("fluxion.chrome.health", "flow-sidebar-loaded")' "$profile/prefs.js" && \
      grep -q 'user_pref("fluxion.palette.health", "command-palette-loaded")' "$profile/prefs.js" && \
      grep -q 'user_pref("fluxion.memory.health", "local-memory-controls-loaded")' "$profile/prefs.js" && \
      grep -q 'user_pref("fluxion.memory.engine.health", "\(local-vector-store-opened\|lexical-fallback-available\)")' "$profile/prefs.js" && \
      grep -q 'user_pref("fluxion.groups.health", "native-group-rendered")' "$profile/prefs.js" && \
      grep -q 'user_pref("fluxion.splitview.health", "native-split-rendered")' "$profile/prefs.js"; then
    printf 'Verified: Fluxion chrome, palette, Browser Memory controls, tab groups, and native split view loaded.\n' >&2
    if [[ -n "${FLUXION_CAPTURE_PATH:-}" ]] && command -v screencapture >/dev/null 2>&1; then
      # prefs.js is flushed as soon as Fluxion chrome initialises. Give Gecko a
      # few more frames to replace macOS's startup placeholder, then foreground
      # the process so the artifact represents the browser users actually see.
      sleep 4
      if command -v osascript >/dev/null 2>&1; then
        osascript -e \
          "tell application \"System Events\" to set frontmost of first application process whose unix id is $process_id to true" \
          >/dev/null 2>&1 || true
        sleep 1
      fi
      if screencapture -x "$FLUXION_CAPTURE_PATH"; then
        printf 'Captured Fluxion chrome at %s\n' "$FLUXION_CAPTURE_PATH" >&2
      else
        printf 'Warning: macOS runner could not capture the Fluxion window.\n' >&2
      fi
    fi
    exit 0
  fi
  if ! kill -0 "$process_id" 2>/dev/null; then
    printf 'Fluxion exited before its sidebar loaded.\n' >&2
    sed -n '1,160p' "$log" >&2
    exit 1
  fi
  sleep 0.25
  ((attempt += 1))
done

printf '%s\n' \
  'Fluxion.app opened Gecko but the Flow sidebar did not load.' \
  'The build is invalid and will not be presented as successful.' >&2
sed -n '1,160p' "$log" >&2
exit 1
