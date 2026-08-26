#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  printf 'Fluxion.app can only be built on macOS.\n' >&2
  exit 69
fi

fluxion_root="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ "${1:-}" == "--clean" ]]; then
  runtime_app="$fluxion_root/../.runtime/Fluxion.app"
  stamp="$fluxion_root/../.runtime/.fluxion-macos-stamp"
  case "$runtime_app" in
    "$fluxion_root"/../.runtime/Fluxion.app) ;;
    *) printf 'Refusing unsafe application path: %s\n' "$runtime_app" >&2; exit 70 ;;
  esac
  rm -rf -- "$runtime_app"
  rm -f -- "$stamp"
  shift
fi
if [[ $# -ne 0 ]]; then
  printf 'usage: %s [--clean]\n' "$0" >&2
  exit 64
fi

firefox="${FLUXION_FIREFOX_BIN:-}"
if [[ -z "$firefox" ]]; then
  for candidate in \
    "/Applications/Firefox.app/Contents/MacOS/firefox" \
    "${HOME:-}/Applications/Firefox.app/Contents/MacOS/firefox" \
    "/Applications/Firefox Developer Edition.app/Contents/MacOS/firefox" \
    "${HOME:-}/Applications/Firefox Developer Edition.app/Contents/MacOS/firefox"; do
    if [[ -x "$candidate" ]]; then
      firefox="$candidate"
      break
    fi
  done
fi

if [[ -z "$firefox" ]]; then
  printf '%s\n' \
    'Firefox.app was not found in /Applications or ~/Applications.' \
    'Install Firefox from https://www.mozilla.org/firefox/ or set FLUXION_FIREFOX_BIN.' >&2
  exit 69
fi

"$fluxion_root/scripts/prepare-macos-runtime.sh" "$firefox" >/dev/null
if [[ "${FLUXION_SKIP_LAUNCH_CHECK:-0}" != "1" ]]; then
  "$fluxion_root/scripts/verify-macos-app.sh" \
    "$fluxion_root/../.runtime/Fluxion.app"
fi
printf 'Built %s\n' "$fluxion_root/../.runtime/Fluxion.app"
printf 'Open it with: open "%s"\n' "$fluxion_root/../.runtime/Fluxion.app"
