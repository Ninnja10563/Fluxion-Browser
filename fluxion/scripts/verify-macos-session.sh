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

  attempt=0
  while kill -0 "$process_id" 2>/dev/null && (( attempt < 240 )); do
    sleep 0.25
    ((attempt += 1))
  done
  if kill -0 "$process_id" 2>/dev/null; then
    printf 'Fluxion did not quit cleanly after %s.\n' "$name" >&2
    return 1
  fi
  wait "$process_id"
  process_id=""
}

run_stage \
  'normal session seed' \
  FLUXION_SESSION_SEED_TEST \
  'user_pref("fluxion.recovery.seed.health", "workspace-tabs-groups-split-seeded")'
run_stage \
  'normal session restoration' \
  FLUXION_SESSION_RESTORE_TEST \
  'user_pref("fluxion.recovery.restore.health", "workspace-tabs-groups-split-restored")'
run_stage \
  'private-window boundary' \
  FLUXION_PRIVATE_ISOLATION_TEST \
  'user_pref("fluxion.recovery.private.health", "private-memory-boundary-enforced")' \
  --private-window 'https://example.com/?fluxion-private-only=1'
run_stage \
  'post-private normal restoration' \
  FLUXION_PRIVATE_ABSENCE_TEST \
  'user_pref("fluxion.recovery.absence.health", "private-tabs-history-memory-excluded")'

printf 'Verified: native tabs, pins, groups, split views, and workspaces restored; private tabs were excluded from session, Places, and Browser Memory.\n' >&2
