#!/usr/bin/env bash
set -euo pipefail
[[ "$(uname -s)" == Darwin ]] || { printf 'Last-window verification requires macOS.\n' >&2; exit 69; }
fluxion_root="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
app="${1:-$fluxion_root/../.runtime/Fluxion.app}"
app="$(CDPATH= cd -- "$app" && pwd)"
launcher="$app/Contents/MacOS/Fluxion"
[[ -x "$launcher" ]] || { printf 'Packaged launcher missing.\n' >&2; exit 69; }
check_root="$(mktemp -d "${TMPDIR:-/tmp}/fluxion-last-window-check.XXXXXX")"
artifact_dir="${FLUXION_LAST_WINDOW_ARTIFACT_DIR:-$check_root/evidence}"
process_id=""
profile="$check_root/profile"
owned() {
  [[ -n "$process_id" ]] && kill -0 "$process_id" 2>/dev/null || return 1
  local command_line expected_prefix
  command_line="$(ps -ww -p "$process_id" -o command=)" || return 1
  expected_prefix="$app/Contents/MacOS/firefox --profile $profile"
  [[ "$command_line" == "$expected_prefix" || "$command_line" == "$expected_prefix "* ]]
}
cleanup() {
  if owned; then
    kill "$process_id" 2>/dev/null || true
    for ((attempt=0; attempt<40; attempt++)); do owned || break; sleep 0.25; done
    if owned; then kill -KILL "$process_id" 2>/dev/null || true; fi
    wait "$process_id" 2>/dev/null || true
  fi
  mkdir -p "$artifact_dir"
  for mode in seed restore existing existing-restore choice0 choice1; do
    for extension in log json; do
      [[ ! -f "$check_root/$mode.$extension" ]] || cp "$check_root/$mode.$extension" "$artifact_dir/$mode.$extension"
    done
  done
  for fixture_profile in profile existing choice0 choice1; do
    if [[ -f "$check_root/$fixture_profile/prefs.js" ]]; then
      grep 'fluxion.lastWindow' "$check_root/$fixture_profile/prefs.js" > "$artifact_dir/$fixture_profile-report.txt" || true
    fi
  done
  printf 'Last-window fixture retained at %s\n' "$check_root" >&2
}
trap cleanup EXIT
for mode in seed restore existing existing-restore choice0 choice1; do
  if [[ "$mode" == existing* ]]; then profile="$check_root/existing"; fi
  if [[ "$mode" == choice* ]]; then profile="$check_root/$mode"; fi
  printf 'Verifying native last-window stage %s...\n' "$mode" >&2
  FLUXION_PROFILE="$profile" FLUXION_LAST_WINDOW_TEST="$mode" FLUXION_LAST_WINDOW_DRIVER_DIR="$check_root" \
    "$launcher" > "$check_root/$mode.log" 2>&1 &
  process_id=$!
  for ((attempt=0; attempt<720; attempt++)); do
    kill -0 "$process_id" 2>/dev/null || break
    sleep 0.25
  done
  if kill -0 "$process_id" 2>/dev/null; then
    printf 'Last-window %s timed out.\n' "$mode" >&2
    sed -n '1,180p' "$check_root/$mode.log" >&2
    exit 1
  fi
  status=0
  wait "$process_id" || status=$?
  process_id=""
  [[ "$status" == 0 ]] || { printf 'Last-window %s exited %s.\n' "$mode" "$status" >&2; exit 1; }
  if [[ ! -s "$check_root/$mode.json" ]] || ! grep -Fq "user_pref(\"fluxion.lastWindow.$mode.health\", \"native-last-window-policy-verified\")" "$profile/prefs.js"; then
    [[ ! -f "$profile/prefs.js" ]] || grep 'fluxion.lastWindow' "$profile/prefs.js" >&2 || true
    sed -n '1,180p' "$check_root/$mode.log" >&2
    exit 1
  fi
  node -e 'const fs=require("node:fs");const evidence=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));if(evidence.error||!evidence.checks.length)process.exit(1);console.log(JSON.stringify(evidence));' "$check_root/$mode.json"
done
