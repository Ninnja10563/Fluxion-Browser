#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  printf 'The Fluxion session-recovery check must run on macOS.\n' >&2
  exit 69
fi

fluxion_root="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
app="${1:-$fluxion_root/../.runtime/Fluxion.app}"
launcher="$app/Contents/MacOS/Fluxion"
if [[ ! -x "$launcher" ]]; then
  printf 'Fluxion launcher is missing: %s\n' "$launcher" >&2
  exit 69
fi

check_root="$(mktemp -d "${TMPDIR:-/tmp}/fluxion-session-check.XXXXXX")"
profile="$check_root/profile"
process_id=""

cleanup() {
  if [[ -n "$process_id" ]] && kill -0 "$process_id" 2>/dev/null; then
    kill "$process_id" 2>/dev/null || true
    wait "$process_id" 2>/dev/null || true
  fi
  case "$check_root" in
    "${TMPDIR:-/tmp}"/fluxion-session-check.*) rm -rf -- "$check_root" ;;
    *) printf 'Refusing unsafe session-check cleanup path: %s\n' "$check_root" >&2 ;;
  esac
}
trap cleanup EXIT

run_stage() {
  local name="$1"
  local environment="$2"
  local marker="$3"
  local error_marker="${marker%%.health*}.error\""
  shift 3
  local log="$check_root/$name.log"
  printf 'Verifying packaged Fluxion %s...\n' "$name" >&2
  env FLUXION_PROFILE="$profile" "$environment=1" \
    "$launcher" "$@" >"$log" 2>&1 &
  process_id=$!

  local attempt=0
  while (( attempt < 480 )); do
    if [[ -f "$profile/prefs.js" ]] && grep -Fq "$marker" "$profile/prefs.js"; then
      break
    fi
    if [[ -f "$profile/prefs.js" ]] && grep -Fq "$error_marker" "$profile/prefs.js"; then
      printf 'Fluxion reported a terminal failure during %s.\n' "$name" >&2
      grep 'fluxion\.recovery' "$profile/prefs.js" >&2 || true
      sed -n '1,180p' "$log" >&2
      return 1
    fi
    if ! kill -0 "$process_id" 2>/dev/null; then
      printf 'Fluxion exited before the %s marker appeared.\n' "$name" >&2
      sed -n '1,180p' "$log" >&2
      [[ -f "$profile/prefs.js" ]] && grep 'fluxion\.recovery\..*\.error' "$profile/prefs.js" >&2 || true
      return 1
    fi
    sleep 0.25
    ((attempt += 1))
  done
  if (( attempt == 480 )); then
    printf 'Timed out waiting for Fluxion %s.\n' "$name" >&2
    [[ -f "$profile/prefs.js" ]] && grep 'fluxion\.recovery' "$profile/prefs.js" >&2 || true
    sed -n '1,180p' "$log" >&2
    return 1
  fi

  if [[ "$environment" == "FLUXION_CRASH_SEED_TEST" ]]; then
    if [[ ! -s "$profile/sessionstore-backups/recovery.jsonlz4" || -e "$profile/sessionstore.jsonlz4" ]]; then
      printf 'Crash seed did not leave only a live recovery checkpoint.\n' >&2
      return 1
    fi
    # The launcher execs Gecko, so this is the exact browser parent we own.
    # No quit request is sent: shutdown handlers cannot write a clean session.
    kill -KILL "$process_id"
    local crash_status=0
    wait "$process_id" || crash_status=$?
    process_id=""
    if (( crash_status != 137 )); then
      printf 'Expected SIGKILL exit137, received %s.\n' "$crash_status" >&2
      return 1
    fi
    if [[ -e "$profile/sessionstore.jsonlz4" ]]; then
      printf 'A clean session file unexpectedly appeared after SIGKILL.\n' >&2
      return 1
    fi
    printf 'Verified owned Gecko process terminated by SIGKILL after its periodic checkpoint.\n' >&2
    return 0
  fi

  attempt=0
  while kill -0 "$process_id" 2>/dev/null && (( attempt < 240 )); do
    sleep 0.25
    ((attempt += 1))
  done
  if kill -0 "$process_id" 2>/dev/null; then
    printf 'Fluxion did not quit cleanly after %s.\n' "$name" >&2
    return 1
  fi
  local exit_status=0
  wait "$process_id" || exit_status=$?
  if (( exit_status != 0 )); then
    printf 'Fluxion exited with status %s after %s.\n' "$exit_status" "$name" >&2
    sed -n '1,180p' "$log" >&2
    [[ -f "$profile/prefs.js" ]] && grep 'fluxion\.recovery\..*\.error' "$profile/prefs.js" >&2 || true
    return "$exit_status"
  fi
  process_id=""
}

run_stage \
  'normal session seed' \
  FLUXION_SESSION_SEED_TEST \
  'user_pref("fluxion.recovery.seed.health", "two-window-workspaces-tabs-groups-stacked-split-seeded")'
run_stage \
  'normal session restoration' \
  FLUXION_SESSION_RESTORE_TEST \
  'user_pref("fluxion.recovery.restore.health", "two-window-workspaces-tabs-groups-stacked-split-restored")'
run_stage \
  'private-window boundary' \
  FLUXION_PRIVATE_ISOLATION_TEST \
  'user_pref("fluxion.recovery.private.health", "private-memory-boundary-enforced")'
run_stage \
  'post-private normal restoration' \
  FLUXION_PRIVATE_ABSENCE_TEST \
  'user_pref("fluxion.recovery.absence.health", "private-tabs-history-memory-excluded")'

run_stage \
  'custom startup preferences seed' \
  FLUXION_STARTUP_PREFERENCES_SEED_TEST \
  'user_pref("fluxion.recovery.preferencesSeed.health", "custom-homepage-startup-and-toolbar-seeded")'
run_stage \
  'saved homepage startup' \
  FLUXION_STARTUP_HOMEPAGE_TEST \
  'user_pref("fluxion.recovery.homepage.health", "saved-homepage-opened-by-gecko-startup")'
run_stage \
  'blank startup seed' \
  FLUXION_STARTUP_BLANK_SEED_TEST \
  'user_pref("fluxion.recovery.blankSeed.health", "blank-startup-seeded-with-homepage-retained")'
run_stage \
  'saved blank startup' \
  FLUXION_STARTUP_BLANK_TEST \
  'user_pref("fluxion.recovery.blank.health", "blank-startup-honored-with-homepage-retained")'

# Isolate crash evidence from every previous orderly shutdown and startup mode.
profile="$check_root/crash-profile"
run_stage \
  'abrupt crash checkpoint seed' \
  FLUXION_CRASH_SEED_TEST \
  'user_pref("fluxion.recovery.crashSeed.health", "periodic-session-checkpoint-ready-with-private-window-open")'
run_stage \
  'abrupt crash recovery' \
  FLUXION_CRASH_RESTORE_TEST \
  'user_pref("fluxion.recovery.crashRestore.health", "sigkill-session-restored-native-layout-with-private-evidence-excluded")'

printf 'Verified: two normal windows retained distinct SessionStore-owned workspaces and active pages with native tabs, pins, groups, stacked split orientation, workspace metadata, and keyword-only Browser Memory startup state restored; private tabs were excluded from session, Places, and Browser Memory.\n' >&2
printf 'Verified: custom homepage and blank startup choices were honored by Gecko on separate launches; the homepage preference survived both startup modes, and the native bookmarks toolbar visibly rendered its saved bookmark in both.\n' >&2
printf 'Verified: SIGKILL recovery restored two normal windows, workspace active pages, tabs, pins, groups and stacked split from a periodic disk checkpoint; private windows/history/Memory stayed excluded, with blank startup and resume-session-once disabled.\n' >&2
