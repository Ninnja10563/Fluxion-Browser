#!/usr/bin/env bash
set -euo pipefail
[[ "$(uname -s)" == Darwin && $# == 2 ]] || { printf 'Usage: install-sparkle.sh <Fluxion.app> <arm64|x86_64|universal2>\n' >&2; exit 64; }
fluxion_root="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
app="$1"; target_arch="$2"
[[ -f "$app/Contents/Info.plist" ]] || exit 64
case "$target_arch" in arm64|x86_64) flags=(-arch "$target_arch");; universal2) flags=(-arch arm64 -arch x86_64);; *) exit 64;; esac
cache="$fluxion_root/../.runtime/sparkle-2.10.0"
mkdir -p "$cache"
archive="$cache/Sparkle-2.10.0.tar.xz"
if [[ ! -f "$archive" ]]; then node "$fluxion_root/scripts/download-sparkle.mjs" "$archive"; fi
expected="$(node -p 'require(process.argv[1]).sha256' "$fluxion_root/runtime/sparkle-lock.json")"
[[ "$(shasum -a 256 "$archive" | awk '{print $1}')" == "$expected" ]] || { printf 'Sparkle cache digest mismatch.\n' >&2; exit 1; }
# Never trust a previously extracted tree merely because its archive is valid.
# Each build consumes a fresh extraction, preserving upstream symlinks/modes.
extracted="$(mktemp -d "$cache/distribution.XXXXXX")"
tar -xJf "$archive" -C "$extracted"
codesign --verify --deep --strict "$extracted/Sparkle.framework"
[[ ! -e "$cache/current" || -L "$cache/current" ]] || { printf 'Unexpected Sparkle cache entry.\n' >&2; exit 1; }
ln -sfn "$extracted" "$cache/current"
frameworks="$app/Contents/Frameworks"
mkdir -p "$frameworks"
ditto "$extracted/Sparkle.framework" "$frameworks/Sparkle.framework"
xcrun clang "${flags[@]}" -mmacosx-version-min=12.0 -fobjc-arc -fvisibility=hidden -dynamiclib -O2 -Wall -Wextra -Wno-unused-parameter -Werror \
  -F "$frameworks" -framework AppKit -framework Sparkle -Wl,-rpath,@loader_path \
  "$fluxion_root/packaging/macos/updater/FluxionUpdaterBridge.m" -o "$frameworks/libFluxionUpdater.dylib"
codesign --force --sign - --timestamp=none "$frameworks/libFluxionUpdater.dylib"
python3 - "$app/Contents/Info.plist" "$fluxion_root/runtime/sparkle-lock.json" "$fluxion_root/package.json" <<'PY'
import json, plistlib, re, sys
with open(sys.argv[1], 'rb') as stream: info = plistlib.load(stream)
with open(sys.argv[2], encoding='utf8') as stream: lock = json.load(stream)
with open(sys.argv[3], encoding='utf8') as stream: version = json.load(stream)['version']
match = re.fullmatch(r'(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-preview\.([1-9]\d{0,2}))?', version)
if not match or (match[4] and int(match[4]) > 255): raise SystemExit('Unsupported signed update version')
info.update(CFBundleVersion=version.replace('-preview.', 'b'), CFBundleShortVersionString=version.split('-')[0], FluxionReleaseVersion=version,
    LSMinimumSystemVersion=lock['minimumMacOS'], SUFeedURL=lock['feedURL'], SUPublicEDKey=lock['publicKey'],
    SUEnableAutomaticChecks=False, SUAutomaticallyUpdate=False, SUEnableSystemProfiling=False,
    SUShowReleaseNotes=False, SUEnableJavaScript=False, SUVerifyUpdateBeforeExtraction=True,
    SURequireSignedFeed=True, SUSignedFeedFailureExpirationInterval=0)
with open(sys.argv[1], 'wb') as stream: plistlib.dump(info, stream, sort_keys=False)
PY
