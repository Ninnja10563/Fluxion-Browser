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
for system_tool in ditto plutil lipo codesign python3; do
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

runtime_file_digest() {
  shasum -a 256 "$1" | awk '{print $1}'
}

runtime_source_identity() {
  local source="$1"
  local executable="$2"
  local file
  for file in "$executable" \
      "$source/Contents/Info.plist" \
      "$source/Contents/Resources/application.ini" \
      "$source/Contents/Resources/platform.ini" \
      "$source/Contents/_CodeSignature/CodeResources"; do
    if [[ ! -f "$file" ]]; then
      printf 'Required upstream runtime identity file is missing: %s\n' "$file" >&2
      return 69
    fi
  done
  # Hash the small signed identity files, then inspect metadata for every runtime
  # file. ctime/inode detect same-path replacements and in-place library changes
  # without rereading the large Gecko libraries on each development launch.
  {
    shasum -a 256 "$executable" \
      "$source/Contents/Info.plist" \
      "$source/Contents/Resources/application.ini" \
      "$source/Contents/Resources/platform.ini" \
      "$source/Contents/_CodeSignature/CodeResources" | awk '{print $1}' || return
    find "$source" \( -type f -o -type l \) -exec stat -f '%N:%i:%.9Fm:%.9Fc:%z' {} + | LC_ALL=C sort || return
  } | shasum -a 256 | awk '{print $1}'
}

runtime_ini_value() {
  local file="$1" section="$2" key="$3"
  awk -F= -v section="$section" -v key="$key" '
    { sub(/\r$/, "") }
    /^\[/ { active = $0 == "[" section "]"; next }
    active && $1 == key { print substr($0, index($0, "=") + 1); exit }
  ' "$file"
}

upstream_identity="$(runtime_source_identity "$source_app" "$requested")"
upstream_resources="$source_app/Contents/Resources"
upstream_version="$(runtime_ini_value "$upstream_resources/application.ini" App Version)"
upstream_build_id="$(runtime_ini_value "$upstream_resources/application.ini" App BuildID)"
upstream_platform_version="$(runtime_ini_value "$upstream_resources/platform.ini" Build Milestone)"
upstream_platform_build_id="$(runtime_ini_value "$upstream_resources/platform.ini" Build BuildID)"
if [[ -z "$upstream_version" || -z "$upstream_build_id" || -z "$upstream_platform_version" || -z "$upstream_platform_build_id" ]]; then
  printf 'The upstream runtime does not identify its application and platform builds.\n' >&2
  exit 69
fi

runtime_parent="$fluxion_root/../.runtime"
runtime_app="$runtime_parent/Fluxion.app"
stamp="$runtime_parent/.fluxion-macos-stamp"
signature="$target_arch|$app_version|$requested|$upstream_identity|$(runtime_file_digest "${BASH_SOURCE[0]}")|$(runtime_file_digest "$fluxion_root/scripts/install-update-policy.py")|$(find "$fluxion_root/chrome" "$fluxion_root/actors" "$fluxion_root/modules" "$fluxion_root/runtime" "$fluxion_root/newtab" "$fluxion_root/assets" "$fluxion_root/packaging/macos" -type f -exec stat -f '%N:%m:%z' {} + | sort | shasum -a 256)"

if [[ ! -x "$runtime_app/Contents/MacOS/Fluxion" || ! -f "$stamp" || "$(<"$stamp")" != "$signature" ]]; then
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
  python3 "$fluxion_root/scripts/install-update-policy.py" "$resources/distribution" \
    "$fluxion_root/runtime/distribution/policies.json"

  bundled_root="$resources/fluxion"
  mkdir -p "$bundled_root"
  ditto "$fluxion_root/chrome" "$bundled_root/chrome"
  ditto "$fluxion_root/actors" "$bundled_root/actors"
  ditto "$fluxion_root/modules" "$bundled_root/modules"
  ditto "$fluxion_root/newtab" "$bundled_root/newtab"
  ditto "$fluxion_root/assets" "$bundled_root/assets"

  provenance="$bundled_root/runtime-provenance.json"
  plutil -create xml1 "$provenance"
  plutil -insert schemaVersion -integer 1 "$provenance"
  plutil -insert upstreamVersion -string "$upstream_version" "$provenance"
  plutil -insert upstreamBuildID -string "$upstream_build_id" "$provenance"
  plutil -insert platformVersion -string "$upstream_platform_version" "$provenance"
  plutil -insert platformBuildID -string "$upstream_platform_build_id" "$provenance"
  plutil -insert architectures -string "$firefox_architectures" "$provenance"
  plutil -insert executableSHA256 -string "$(runtime_file_digest "$requested")" "$provenance"
  plutil -insert signatureManifestSHA256 -string \
    "$(runtime_file_digest "$source_app/Contents/_CodeSignature/CodeResources")" "$provenance"
  plutil -insert sourceIdentity -string "$upstream_identity" "$provenance"
  plutil -convert json "$provenance"

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
