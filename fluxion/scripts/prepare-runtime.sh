#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  printf 'usage: %s /path/to/firefox\n' "$0" >&2
  exit 64
fi

fluxion_root="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
requested="$1"

# Resolve distro wrapper symlinks but retain actual scripts where applicable.
resolved="$(readlink -f -- "$requested")"
if [[ ! -x "$resolved" ]]; then
  printf 'Firefox binary is not executable: %s\n' "$resolved" >&2
  exit 69
fi

source_dir="$(dirname -- "$resolved")"
runtime_dir="$fluxion_root/../.runtime/firefox"
stamp="$runtime_dir/.fluxion-stamp"
signature="$resolved|$(stat -c '%Y:%s' "$resolved")|$(stat -c '%Y:%s' "$fluxion_root/runtime/fluxion.cfg")|$(stat -c '%Y:%s' "$fluxion_root/runtime/defaults/pref/fluxion-autoconfig.js")"

if [[ ! -f "$stamp" || "$(<"$stamp")" != "$signature" ]]; then
  case "$runtime_dir" in
    "$fluxion_root"/../.runtime/firefox) ;;
    *) printf 'Refusing unsafe runtime path: %s\n' "$runtime_dir" >&2; exit 70 ;;
  esac

  rm -rf -- "$runtime_dir"
  mkdir -p "$runtime_dir"

  # A symlink farm keeps the overlay small. The executable itself is copied so
  # Gecko resolves its application directory to this overlay, not upstream.
  cp -as "$source_dir"/. "$runtime_dir"/
  rm -f -- "$runtime_dir/$(basename -- "$resolved")"
  cp -p -- "$resolved" "$runtime_dir/$(basename -- "$resolved")"

  if [[ -L "$runtime_dir/defaults" ]]; then
    rm -- "$runtime_dir/defaults"
    mkdir -p "$runtime_dir/defaults"
    if [[ -d "$source_dir/defaults" ]]; then
      cp -as "$source_dir/defaults"/. "$runtime_dir/defaults"/
    fi
  fi
  if [[ -L "$runtime_dir/defaults/pref" ]]; then
    rm -- "$runtime_dir/defaults/pref"
    mkdir -p "$runtime_dir/defaults/pref"
    if [[ -d "$source_dir/defaults/pref" ]]; then
      cp -as "$source_dir/defaults/pref"/. "$runtime_dir/defaults/pref"/
    fi
  fi

  cp -- "$fluxion_root/runtime/defaults/pref/fluxion-autoconfig.js" \
    "$runtime_dir/defaults/pref/fluxion-autoconfig.js"
  cp -- "$fluxion_root/runtime/fluxion.cfg" "$runtime_dir/fluxion.cfg"
  printf '%s' "$signature" > "$stamp"
fi

printf '%s\n' "$runtime_dir/$(basename -- "$resolved")"
