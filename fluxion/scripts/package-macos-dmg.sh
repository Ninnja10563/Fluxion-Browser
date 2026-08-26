#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  printf 'Fluxion DMGs can only be packaged on macOS.\n' >&2
  exit 69
fi

fluxion_root="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
app="$fluxion_root/../.runtime/Fluxion.app"
output_dir="$fluxion_root/../dist"
version="0.4.0-preview.1"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app)
      app="${2:-}"
      shift 2
      ;;
    --output-dir)
      output_dir="${2:-}"
      shift 2
      ;;
    --version)
      version="${2:-}"
      shift 2
      ;;
    *)
      printf 'usage: %s [--app Fluxion.app] [--output-dir DIR] [--version VERSION]\n' \
        "$0" >&2
      exit 64
      ;;
  esac
done

if [[ ! "$version" =~ ^[0-9A-Za-z][0-9A-Za-z._-]*$ ]]; then
  printf 'Invalid release version: %s\n' "$version" >&2
  exit 64
fi
if [[ ! -d "$app" || ! -x "$app/Contents/MacOS/Fluxion" ]]; then
  printf 'Fluxion.app is missing or incomplete: %s\n' "$app" >&2
  exit 69
fi

launcher_architectures="$(lipo -archs "$app/Contents/MacOS/Fluxion")"
for required_architecture in arm64 x86_64; do
  if [[ " $launcher_architectures " != *" $required_architecture "* ]]; then
    printf 'Refusing to package a universal DMG without %s launcher code.\n' \
      "$required_architecture" >&2
    exit 69
  fi
done
codesign --verify --deep --strict "$app"

mkdir -p "$output_dir"
output_dir="$(CDPATH= cd -- "$output_dir" && pwd)"
dmg_name="Fluxion-${version}-macOS-universal.dmg"
dmg="$output_dir/$dmg_name"
stage="$(mktemp -d "${TMPDIR:-/tmp}/fluxion-dmg.XXXXXX")"

cleanup() {
  rm -rf -- "$stage"
}
trap cleanup EXIT

ditto "$app" "$stage/Fluxion.app"
ln -s /Applications "$stage/Applications"
hdiutil create \
  -volname "Fluxion ${version}" \
  -srcfolder "$stage" \
  -format UDZO \
  -ov \
  "$dmg"

(
  cd "$output_dir"
  shasum -a 256 "$dmg_name" > "$dmg_name.sha256"
)

printf 'Created %s\n' "$dmg"
printf 'Created %s.sha256\n' "$dmg"
