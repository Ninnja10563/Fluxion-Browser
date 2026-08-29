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

target_arch="${FLUXION_TARGET_ARCH:-$(uname -m)}"
case "$target_arch" in
  arm64|x86_64|universal2) ;;
  *)
    printf 'Unsupported FLUXION_TARGET_ARCH: %s\n' "$target_arch" >&2
    printf 'Expected arm64, x86_64, or universal2.\n' >&2
    exit 64
    ;;
esac
app_version="${FLUXION_APP_VERSION:-0.1.0}"
if [[ ! "$app_version" =~ ^[0-9]+(\.[0-9]+){0,2}$ ]]; then
  printf 'Invalid FLUXION_APP_VERSION: %s\n' "$app_version" >&2
  exit 64
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
firefox_architectures="$(lipo -archs "$requested" 2>/dev/null || true)"
required_architectures=("$target_arch")
if [[ "$target_arch" == "universal2" ]]; then
  required_architectures=(arm64 x86_64)
fi
for required_architecture in "${required_architectures[@]}"; do
  if [[ " $firefox_architectures " != *" $required_architecture "* ]]; then
    printf 'Firefox does not contain the required %s architecture.\n' \
      "$required_architecture" >&2
    printf 'Install the current universal macOS Firefox build.\n' >&2
    exit 69
  fi
done
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
signature="$target_arch|$app_version|$requested|$(stat -f '%m:%z' "$requested")|$(stat -f '%m:%z' "$fluxion_root/scripts/prepare-macos-runtime.sh")|$(stat -f '%m:%z' "$fluxion_root/runtime/fluxion.cfg")|$(stat -f '%m:%z' "$fluxion_root/runtime/defaults/pref/fluxion-autoconfig.js")|$(stat -f '%m:%z' "$fluxion_root/chrome/fluxion-chrome.js")|$(stat -f '%m:%z' "$fluxion_root/chrome/fluxion-memory.js")|$(stat -f '%m:%z' "$fluxion_root/chrome/fluxion-peek.js")|$(stat -f '%m:%z' "$fluxion_root/chrome/fluxion-settings.js")|$(stat -f '%m:%z' "$fluxion_root/chrome/fluxion-tab-sleeping.js")|$(stat -f '%m:%z' "$fluxion_root/chrome/fluxion-palette.js")|$(stat -f '%m:%z' "$fluxion_root/chrome/core/memory-policy.js")|$(stat -f '%m:%z' "$fluxion_root/chrome/core/memory-ranking.js")|$(stat -f '%m:%z' "$fluxion_root/chrome/core/peek.js")|$(stat -f '%m:%z' "$fluxion_root/chrome/core/settings.js")|$(stat -f '%m:%z' "$fluxion_root/chrome/core/tab-sleeping.js")|$(stat -f '%m:%z' "$fluxion_root/chrome/core/tab-selection.js")|$(stat -f '%m:%z' "$fluxion_root/chrome/core/search.js")|$(stat -f '%m:%z' "$fluxion_root/chrome/core/tab-groups.js")|$(stat -f '%m:%z' "$fluxion_root/chrome/core/split-views.js")|$(stat -f '%m:%z' "$fluxion_root/chrome/core/url.js")|$(stat -f '%m:%z' "$fluxion_root/chrome/core/workspaces.js")|$(stat -f '%m:%z' "$fluxion_root/newtab/index.html")|$(stat -f '%m:%z' "$fluxion_root/newtab/newtab.css")|$(stat -f '%m:%z' "$fluxion_root/about/index.html")|$(stat -f '%m:%z' "$fluxion_root/about/about.css")|$(stat -f '%m:%z' "$fluxion_root/assets/fluxion.svg")|$(stat -f '%m:%z' "$fluxion_root/packaging/macos/launcher.c")|$(stat -f '%m:%z' "$fluxion_root/packaging/macos/InfoPlist.strings")|$(stat -f '%m:%z' "$fluxion_root/packaging/macos/firefox-developer.entitlements.plist")"

if [[ ! -f "$stamp" || "$(<"$stamp")" != "$signature" ]]; then
  case "$runtime_app" in
    "$fluxion_root"/../.runtime/Fluxion.app) ;;
    *) printf 'Refusing unsafe application path: %s\n' "$runtime_app" >&2; exit 70 ;;
  esac

  rm -rf -- "$runtime_app"
  mkdir -p "$runtime_parent"
  printf 'Creating %s application from %s...\n' "$target_arch" "$source_app" >&2
  ditto "$source_app" "$runtime_app"

  resources="$runtime_app/Contents/Resources"
  macos="$runtime_app/Contents/MacOS"
  if [[ ! -d "$resources" || ! -d "$macos" ]]; then
    printf 'This Firefox.app has an unsupported directory layout.\n' >&2
    exit 69
  fi

  # Current Firefox macOS bundles no longer ship a physical defaults/pref
  # directory, but Gecko still scans it when administrators create one. Keep
  # configuration under Resources: macOS code signing rejects data files placed
  # beside executable code in Contents/MacOS.
  mkdir -p "$resources/defaults/pref"
  cp "$fluxion_root/runtime/defaults/pref/fluxion-autoconfig.js" \
    "$resources/defaults/pref/fluxion-autoconfig.js"
  cp "$fluxion_root/runtime/fluxion.cfg" "$resources/fluxion.cfg"

  bundled_root="$resources/fluxion"
  mkdir -p "$bundled_root"
  ditto "$fluxion_root/chrome" "$bundled_root/chrome"
  ditto "$fluxion_root/newtab" "$bundled_root/newtab"
  ditto "$fluxion_root/about" "$bundled_root/about"
  ditto "$fluxion_root/assets" "$bundled_root/assets"

  launcher_arch_flags=(-arch "$target_arch")
  if [[ "$target_arch" == "universal2" ]]; then
    launcher_arch_flags=(-arch arm64 -arch x86_64)
  fi
  xcrun clang "${launcher_arch_flags[@]}" -Os -Wall -Wextra -Werror \
    "$fluxion_root/packaging/macos/launcher.c" \
    -o "$macos/Fluxion"

  info="$runtime_app/Contents/Info.plist"
  plutil -replace CFBundleExecutable -string Fluxion "$info"
  plutil -replace CFBundleName -string Fluxion "$info"
  if ! plutil -replace CFBundleDisplayName -string Fluxion "$info" 2>/dev/null; then
    plutil -insert CFBundleDisplayName -string Fluxion "$info"
  fi
  plutil -replace CFBundleIdentifier -string app.fluxion.browser "$info"
  plutil -replace CFBundleShortVersionString -string "$app_version" "$info"
  plutil -replace CFBundleVersion -string "$app_version" "$info"
  plutil -replace CFBundleGetInfoString -string "Fluxion $app_version" "$info"
  plutil -replace CFBundleSignature -string FLXN "$info"
  # CFBundleIconName points at Firefox's AppIcon in Assets.car and takes
  # precedence over CFBundleIconFile on current macOS releases.
  plutil -remove CFBundleIconName "$info" 2>/dev/null || true
  # Firefox's compiled asset catalogue contains another copy of AppIcon. The
  # native macOS startup placeholder can resolve it even after CFBundleIconName
  # is removed, briefly showing Firefox branding before Gecko paints chrome.
  # Fluxion uses the explicit ICNS below, so the inherited catalogue is neither
  # needed nor safe to keep in a branded application bundle.
  rm -f -- "$resources/Assets.car"
  plutil -replace NSCameraUsageDescription -string \
    'Only sites you allow within Fluxion can use the camera.' "$info"
  plutil -replace NSMicrophoneUsageDescription -string \
    'Only sites you allow within Fluxion can use the microphone.' "$info"
  plutil -replace NSLocationUsageDescription -string \
    'Only sites you allow within Fluxion can use location services.' "$info"
  plutil -replace NSLocationAlwaysAndWhenInUseUsageDescription -string \
    'Only sites you allow within Fluxion can use location services.' "$info"
  plutil -replace NSLocationWhenInUseUsageDescription -string \
    'Only sites you allow within Fluxion can use location services.' "$info"
  plutil -replace NSAppleEventsUsageDescription -string \
    'Fluxion uses Apple Events to communicate with other applications.' "$info"
  plutil -replace NSDownloadsFolderUsageDescription -string \
    'Fluxion needs access to Downloads to save and manage downloaded files.' "$info"
  plutil -replace NSDocumentsFolderUsageDescription -string \
    'Fluxion needs access to Documents to open and save files at your request.' "$info"
  plutil -replace NSDesktopFolderUsageDescription -string \
    'Fluxion needs access to Desktop to open and save files at your request.' "$info"
  plutil -replace NSRemovableVolumesUsageDescription -string \
    'Fluxion needs access to removable volumes to open and save files.' "$info"
  plutil -replace NSNetworkVolumesUsageDescription -string \
    'Fluxion needs access to network volumes to open and save files.' "$info"
  for localised_info in "$resources"/*.lproj/InfoPlist.strings; do
    [[ -e "$localised_info" ]] || continue
    ditto "$fluxion_root/packaging/macos/InfoPlist.strings" "$localised_info"
  done

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
    # Replace the inherited icon too so no legacy Launch Services path can
    # display Firefox branding while caches refresh.
    ditto "$resources/fluxion.icns" "$resources/firefox.icns"
  else
    printf 'macOS could not render the Fluxion icon; refusing a Firefox-branded build.\n' >&2
    exit 1
  fi
  rm -rf -- "$icon_work"

  printf 'Signing the local Fluxion development application...\n' >&2
  # Firefox's main Mach-O signature seals the enclosing Info.plist. Re-sign it
  # after changing the bundle identity with Mozilla's developer entitlement
  # model. Production Firefox includes restricted passkey entitlements that
  # macOS rejects when they are preserved in an ad-hoc signature.
  codesign --force --sign - --timestamp=none --options runtime \
    --entitlements \
      "$fluxion_root/packaging/macos/firefox-developer.entitlements.plist" \
    "$macos/firefox"
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
