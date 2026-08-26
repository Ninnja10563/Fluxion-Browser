#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  printf 'usage: %s /Applications/Firefox.app/Contents/MacOS/firefox\n' "$0" >&2
  exit 64
fi
if [[ "$(uname -s)" != "Darwin" ]]; then
  printf 'The macOS runtime builder must run on macOS.\n' >&2
  exit 69
fi

fluxion_root="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
requested="$1"
case "$requested" in
  */Contents/MacOS/*) source_app="${requested%%/Contents/MacOS/*}" ;;
  *)
    printf 'Expected a Firefox.app executable, got: %s\n' "$requested" >&2
    exit 69
    ;;
esac

if [[ ! -d "$source_app" || ! -x "$requested" ]]; then
  printf 'Firefox application is not readable: %s\n' "$source_app" >&2
  exit 69
fi
if [[ "$(sysctl -in sysctl.proc_translated 2>/dev/null || printf '0')" == "1" ]]; then
  printf '%s\n' \
    'This Terminal is running through Rosetta.' \
    'Open a native Terminal window and run the builder again for an ARM64 Fluxion app.' >&2
  exit 69
fi
if [[ "$(uname -m)" == "arm64" ]]; then
  firefox_architectures="$(lipo -archs "$requested" 2>/dev/null || true)"
  if [[ " $firefox_architectures " != *" arm64 "* ]]; then
    printf '%s\n' \
      'The installed Firefox does not contain native Apple Silicon code.' \
      'Install the current macOS Firefox build before building Fluxion.' >&2
    exit 69
  fi
fi
for system_tool in ditto plutil lipo codesign; do
  if ! command -v "$system_tool" >/dev/null 2>&1; then
    printf 'Required macOS system tool is unavailable: %s\n' "$system_tool" >&2
    exit 69
  fi
done
if ! command -v xcrun >/dev/null 2>&1 || ! xcrun --find clang >/dev/null 2>&1; then
  printf '%s\n' \
    'Fluxion needs the Apple Command Line Tools to build its native launcher.' \
    'Install them once with: xcode-select --install' >&2
  exit 69
fi

runtime_parent="$fluxion_root/../.runtime"
runtime_app="$runtime_parent/Fluxion.app"
stamp="$runtime_parent/.fluxion-macos-stamp"
signature="$requested|$(stat -f '%m:%z' "$requested")|$(stat -f '%m:%z' "$fluxion_root/scripts/prepare-macos-runtime.sh")|$(stat -f '%m:%z' "$fluxion_root/runtime/fluxion.cfg")|$(stat -f '%m:%z' "$fluxion_root/runtime/defaults/pref/fluxion-autoconfig.js")|$(stat -f '%m:%z' "$fluxion_root/chrome/fluxion-chrome.js")|$(stat -f '%m:%z' "$fluxion_root/chrome/core/url.js")|$(stat -f '%m:%z' "$fluxion_root/chrome/core/workspaces.js")|$(stat -f '%m:%z' "$fluxion_root/newtab/index.html")|$(stat -f '%m:%z' "$fluxion_root/newtab/newtab.css")|$(stat -f '%m:%z' "$fluxion_root/assets/fluxion.svg")|$(stat -f '%m:%z' "$fluxion_root/packaging/macos/launcher.c")"

if [[ ! -f "$stamp" || "$(<"$stamp")" != "$signature" ]]; then
  case "$runtime_app" in
    "$fluxion_root"/../.runtime/Fluxion.app) ;;
    *) printf 'Refusing unsafe application path: %s\n' "$runtime_app" >&2; exit 70 ;;
  esac

  rm -rf -- "$runtime_app"
  mkdir -p "$runtime_parent"
  printf 'Creating native %s application from %s...\n' "$(uname -m)" "$source_app" >&2
  ditto "$source_app" "$runtime_app"

  resources="$runtime_app/Contents/Resources"
  macos="$runtime_app/Contents/MacOS"
  if [[ ! -d "$resources" || ! -d "$macos" ]]; then
    printf 'This Firefox.app has an unsupported directory layout.\n' >&2
    exit 69
  fi

  # Current Firefox macOS bundles no longer ship a physical defaults/pref
  # directory, but Gecko still scans it when administrators create one.
  mkdir -p "$resources/defaults/pref"
  cp "$fluxion_root/runtime/defaults/pref/fluxion-autoconfig.js" \
    "$resources/defaults/pref/fluxion-autoconfig.js"
  cp "$fluxion_root/runtime/fluxion.cfg" "$resources/fluxion.cfg"
  # Keep a second copy beside the executable for Firefox variants that resolve
  # default preferences and general.config.filename relative to the binary.
  mkdir -p "$macos/defaults/pref"
  cp "$fluxion_root/runtime/defaults/pref/fluxion-autoconfig.js" \
    "$macos/defaults/pref/fluxion-autoconfig.js"
  cp "$fluxion_root/runtime/fluxion.cfg" "$macos/fluxion.cfg"

  bundled_root="$resources/fluxion"
  mkdir -p "$bundled_root"
  ditto "$fluxion_root/chrome" "$bundled_root/chrome"
  ditto "$fluxion_root/newtab" "$bundled_root/newtab"
  ditto "$fluxion_root/assets" "$bundled_root/assets"

  xcrun clang -arch "$(uname -m)" -Os -Wall -Wextra -Werror \
    "$fluxion_root/packaging/macos/launcher.c" \
    -o "$macos/Fluxion"

  info="$runtime_app/Contents/Info.plist"
  plutil -replace CFBundleExecutable -string Fluxion "$info"
  plutil -replace CFBundleName -string Fluxion "$info"
  if ! plutil -replace CFBundleDisplayName -string Fluxion "$info" 2>/dev/null; then
    plutil -insert CFBundleDisplayName -string Fluxion "$info"
  fi
  plutil -replace CFBundleIdentifier -string app.fluxion.browser "$info"

  icon_work="$(mktemp -d "${TMPDIR:-/tmp}/fluxion-icon.XXXXXX")"
  if qlmanage -t -s 1024 -o "$icon_work" "$fluxion_root/assets/fluxion.svg" \
      >/dev/null 2>&1 && [[ -s "$icon_work/fluxion.svg.png" ]]; then
    iconset="$icon_work/Fluxion.iconset"
    mkdir -p "$iconset"
    for icon_spec in \
      '16 icon_16x16.png' \
      '32 icon_16x16@2x.png' \
      '32 icon_32x32.png' \
      '64 icon_32x32@2x.png' \
      '128 icon_128x128.png' \
      '256 icon_128x128@2x.png' \
      '256 icon_256x256.png' \
      '512 icon_256x256@2x.png' \
      '512 icon_512x512.png' \
      '1024 icon_512x512@2x.png'; do
      read -r icon_size icon_name <<<"$icon_spec"
      sips -z "$icon_size" "$icon_size" "$icon_work/fluxion.svg.png" \
        --out "$iconset/$icon_name" >/dev/null
    done
    iconutil -c icns "$iconset" -o "$resources/fluxion.icns"
    plutil -replace CFBundleIconFile -string fluxion.icns "$info"
  else
    printf 'Warning: macOS could not render the Fluxion icon; using the runtime icon.\n' >&2
  fi
  rm -rf -- "$icon_work"

  printf 'Signing the local Fluxion development application...\n' >&2
  codesign --force --sign - --timestamp=none "$macos/Fluxion"
  codesign --force --sign - --timestamp=none "$runtime_app"
  codesign --verify --deep --strict "$runtime_app"
  if command -v xattr >/dev/null 2>&1; then
    xattr -dr com.apple.quarantine "$runtime_app" 2>/dev/null || true
  fi

  printf '%s' "$signature" > "$stamp"
  printf 'Fluxion.app is ready.\n' >&2
fi

printf '%s\n' "$runtime_app/Contents/MacOS/Fluxion"
