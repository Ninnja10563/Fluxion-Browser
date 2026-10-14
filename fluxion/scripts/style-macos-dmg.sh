#!/usr/bin/env bash
set -euo pipefail
[[ "$(uname -s)" == Darwin && $# == 2 && ( "$1" == configure || "$1" == verify ) && -f "$2" ]] || exit 64
mode="$1"
disk_image="$2"
fluxion_root="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
mount_root="$(mktemp -d "${TMPDIR:-/tmp}/fluxion-dmg-layout.XXXXXX")"
mount_path="$mount_root/volume"
mkdir "$mount_path"
mounted=false
detach_image() {
  local attempt
  for attempt in 1 2 3 4 5; do
    if hdiutil detach "$mount_path"; then mounted=false; return 0; fi
    sleep 2
  done
  return 1
}
cleanup() {
  if [[ "$mounted" == true ]] && ! detach_image; then
    printf 'Retaining mounted DMG for inspection: %s\n' "$mount_path" >&2
    return
  fi
  rm -rf -- "$mount_root"
}
trap cleanup EXIT
attach_options=(-nobrowse -mountpoint "$mount_path")
if [[ "$mode" == verify ]]; then attach_options+=(-readonly); fi
hdiutil attach "$disk_image" "${attach_options[@]}"
mounted=true
[[ -d "$mount_path/Fluxion.app" && -L "$mount_path/Applications" ]]
[[ "$(readlink "$mount_path/Applications")" == /Applications ]]
if ! window_id="$(osascript "$fluxion_root/packaging/macos/dmg-layout.applescript" "$mode" "$mount_path" 2>"$mount_root/finder.log")"; then
  cat "$mount_root/finder.log" >&2
  if [[ -n "${FLUXION_DMG_ARTIFACT_DIR:-}" ]]; then
    mkdir -p "$FLUXION_DMG_ARTIFACT_DIR"
    cp "$mount_root/finder.log" "$FLUXION_DMG_ARTIFACT_DIR/$mode-failure.txt"
    screencapture -x "$FLUXION_DMG_ARTIFACT_DIR/$mode-failure.png" || true
  fi
  exit 1
fi
[[ "$window_id" =~ ^[0-9]+$ ]]
[[ -s "$mount_path/.DS_Store" && -s "$mount_path/.background/background.tiff" ]]
if [[ "$mode" == verify ]]; then
  codesign --verify --deep --strict "$mount_path/Fluxion.app"
  sleep 1
  screencapture -x -o -l "$window_id" "$mount_root/install-window.png"
  [[ -s "$mount_root/install-window.png" ]]
  if [[ -n "${FLUXION_DMG_ARTIFACT_DIR:-}" ]]; then
    mkdir -p "$FLUXION_DMG_ARTIFACT_DIR"
    cp "$mount_root/install-window.png" "$FLUXION_DMG_ARTIFACT_DIR/install-window.png"
  fi
  xcrun swift "$fluxion_root/packaging/macos/verify-dmg-background.swift" \
    "$mount_path/.background/background.tiff" "$mount_root/install-window.png" > "$mount_root/background-check.txt"
  if [[ -n "${FLUXION_DMG_ARTIFACT_DIR:-}" ]]; then
    mkdir -p "$FLUXION_DMG_ARTIFACT_DIR"
    cp "$mount_root/install-window.png" "$FLUXION_DMG_ARTIFACT_DIR/install-window.png"
    cp "$mount_root/background-check.txt" "$FLUXION_DMG_ARTIFACT_DIR/background-check.txt"
    printf 'Verified read-only DMG: icon view, 640x444 window, 96px icons at 180/460, embedded Retina background, Applications link, unchanged app signature.\n' > "$FLUXION_DMG_ARTIFACT_DIR/layout.txt"
  fi
fi
detach_image
