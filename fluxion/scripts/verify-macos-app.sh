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
provider_log="$check_root/ollama-stub.log"
ai_request="$check_root/ai-request.json"
process_id=""
provider_process_id=""

cleanup() {
  if [[ -n "$process_id" ]] && kill -0 "$process_id" 2>/dev/null; then
    kill "$process_id" 2>/dev/null || true
    wait "$process_id" 2>/dev/null || true
  fi
  if [[ -n "$provider_process_id" ]] && kill -0 "$provider_process_id" 2>/dev/null; then
    kill "$provider_process_id" 2>/dev/null || true
    wait "$provider_process_id" 2>/dev/null || true
  fi
  rm -rf -- "$check_root"
}
trap cleanup EXIT

python3 "$fluxion_root/tests/fixtures/ollama-stub.py" 19876 "$ai_request" >"$provider_log" 2>&1 &
provider_process_id=$!
provider_attempt=0
while (( provider_attempt < 40 )); do
  if curl --fail --silent --show-error http://127.0.0.1:19876/api/tags >/dev/null; then
    break
  fi
  if ! kill -0 "$provider_process_id" 2>/dev/null; then
    printf 'The local AI provider fixture exited before Fluxion launched.\n' >&2
    sed -n '1,80p' "$provider_log" >&2
    exit 1
  fi
  sleep 0.25
  ((provider_attempt += 1))
done
if (( provider_attempt == 40 )); then
  printf 'The local AI provider fixture did not become ready.\n' >&2
  exit 1
fi

printf 'Verifying that the Flow tab sidebar loads...\n' >&2
FLUXION_PROFILE="$profile" FLUXION_VISUAL_GROUP_TEST=1 FLUXION_VISUAL_SPLIT_TEST=1 FLUXION_VISUAL_MEMORY_TEST=1 FLUXION_VISUAL_ENRICHMENT_TEST=1 FLUXION_VISUAL_GROUNDING_TEST=1 FLUXION_VISUAL_SETTINGS_TEST=1 FLUXION_VISUAL_SLEEP_TEST=1 FLUXION_VISUAL_PEEK_TEST=1 FLUXION_VISUAL_MULTISELECT_TEST=1 FLUXION_VISUAL_SHORTCUT_TEST=1 FLUXION_VISUAL_AI_TEST=1 FLUXION_VISUAL_AI_COMPARE_TEST=1 FLUXION_VISUAL_LIBRARY_TEST=1 FLUXION_VISUAL_BOOKMARK_FOLDER_TEST=1 FLUXION_VISUAL_PERMISSIONS_TEST=1 \
  "$launcher" https://example.com/ >"$log" 2>&1 &
process_id=$!

attempt=0
while (( attempt < 360 )); do
  if [[ -f "$profile/prefs.js" ]] && \
      grep -q 'user_pref("fluxion.chrome.health", "flow-sidebar-loaded")' "$profile/prefs.js" && \
      grep -q 'user_pref("fluxion.palette.health", "command-palette-loaded")' "$profile/prefs.js" && \
      grep -q 'user_pref("fluxion.memory.health", "local-memory-controls-loaded")' "$profile/prefs.js" && \
      grep -q 'user_pref("fluxion.memory.engine.health", "\(local-vector-store-opened\|lexical-fallback-available\)")' "$profile/prefs.js" && \
      grep -q 'user_pref("fluxion.memory.enrichment.health", "content-indexed-and-retrieved")' "$profile/prefs.js" && \
      grep -q 'user_pref("fluxion.memory.grounding.health", "grounded-evidence-visible")' "$profile/prefs.js" && \
      grep -q 'user_pref("fluxion.settings.health", "live-preferences-loaded")' "$profile/prefs.js" && \
      grep -q 'user_pref("fluxion.settings.visual.health", "settings-surface-visible")' "$profile/prefs.js" && \
      grep -q 'user_pref("fluxion.sleeping.health", "native-discard-scheduler-loaded")' "$profile/prefs.js" && \
      grep -q 'user_pref("fluxion.sleeping.visual.health", "native-tab-discarded")' "$profile/prefs.js" && \
      grep -q 'user_pref("fluxion.peek.health", "secure-context-link-peek-loaded")' "$profile/prefs.js" && \
      grep -q 'user_pref("fluxion.peek.visual.health", "temporary-gecko-tab-opened")' "$profile/prefs.js" && \
      grep -q 'user_pref("fluxion.multiselect.health", "native-multiselect-visible")' "$profile/prefs.js" && \
      grep -q 'user_pref("fluxion.shortcuts.health", "editable-shortcut-registry-loaded")' "$profile/prefs.js" && \
      grep -q 'user_pref("fluxion.shortcuts.visual.health", "custom-shortcut-persisted")' "$profile/prefs.js" && \
      grep -q 'user_pref("fluxion.ai.health", "privileged-provider-layer-loaded")' "$profile/prefs.js" && \
      grep -q 'user_pref("fluxion.ai.connection.health", "ollama-loopback-connected")' "$profile/prefs.js" && \
      grep -q 'user_pref("fluxion.ai.visual.health", "current-page-answer-visible")' "$profile/prefs.js" && \
      grep -q 'user_pref("fluxion.ai.compare.visual.health", "selected-pages-compared")' "$profile/prefs.js" && \
      grep -q 'user_pref("fluxion.library.health", "places-downloads-library-loaded")' "$profile/prefs.js" && \
      grep -q 'user_pref("fluxion.library.visual.health", "history-bookmarks-downloads-rendered")' "$profile/prefs.js" && \
      grep -q 'user_pref("fluxion.library.folders.visual.health", "folder-created-and-bookmark-moved")' "$profile/prefs.js" && \
      grep -q 'user_pref("fluxion.permissions.health", "native-permission-manager-loaded")' "$profile/prefs.js" && \
      grep -q 'user_pref("fluxion.permissions.visual.health", "real-permissions-enumerated-and-reset")' "$profile/prefs.js" && \
      grep -q 'user_pref("fluxion.permissions.surface.visual.health", "native-site-decisions-visible")' "$profile/prefs.js" && \
      grep -q 'user_pref("fluxion.groups.health", "native-group-rendered")' "$profile/prefs.js" && \
      grep -q 'user_pref("fluxion.splitview.health", "native-split-rendered")' "$profile/prefs.js" && \
      [[ -s "$ai_request" ]] && grep -q '"page_count": 2' "$ai_request"; then
    printf 'Verified: Fluxion chrome, Library history/bookmark folders/downloads, live settings and editable site permissions, grounded current-page questions and selected-page comparison, Peek Pages, native multi-select, tab sleeping, Browser Memory evidence, tab groups, and native split view loaded.\n' >&2
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
if [[ -f "$profile/prefs.js" ]]; then
  printf 'Observed Fluxion health markers:\n' >&2
  grep 'user_pref("fluxion\..*\.health"' "$profile/prefs.js" >&2 || true
  grep 'user_pref("fluxion\.memory\.enrichment\.\(stage\|error\)"' "$profile/prefs.js" >&2 || true
  grep 'user_pref("fluxion\.settings\.error"' "$profile/prefs.js" >&2 || true
  grep 'user_pref("fluxion\.ai\.visual\.error"' "$profile/prefs.js" >&2 || true
  grep 'user_pref("fluxion\.ai\.visual\.stage"' "$profile/prefs.js" >&2 || true
  grep 'user_pref("fluxion\.ai\.compare\.visual\.error"' "$profile/prefs.js" >&2 || true
  grep 'user_pref("fluxion\.library\.visual\.error"' "$profile/prefs.js" >&2 || true
  grep 'user_pref("fluxion\.library\.folders\.visual\.error"' "$profile/prefs.js" >&2 || true
  grep 'user_pref("fluxion\.permissions\.visual\.error"' "$profile/prefs.js" >&2 || true
fi
sed -n '1,80p' "$provider_log" >&2
sed -n '1,160p' "$log" >&2
exit 1
