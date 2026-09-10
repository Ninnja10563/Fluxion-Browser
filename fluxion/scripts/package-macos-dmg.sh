#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  printf 'Fluxion DMGs can only be packaged on macOS.\n' >&2
  exit 69
fi

fluxion_root="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
app="$fluxion_root/../.runtime/Fluxion.app"
output_dir="$fluxion_root/../dist"
version=""
version_provided=false

while [[ $# -gt 0 ]]; do
  if [[ "$1" == --app || "$1" == --output-dir || "$1" == --version ]]; then
    if [[ $# -lt 2 || -z "$2" ]]; then
      printf 'Option %s requires a nonempty value.\n' "$1" >&2
      exit 64
    fi
  fi
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
      version_provided=true
      shift 2
      ;;
    *)
      printf 'usage: %s [--app Fluxion.app] [--output-dir DIR] [--version VERSION]\n' \
        "$0" >&2
      exit 64
      ;;
  esac
done

if [[ "$version_provided" == true && ! "$version" =~ ^[0-9A-Za-z][0-9A-Za-z._-]*$ ]]; then
  printf 'Invalid release version: %s\n' "$version" >&2
  exit 64
fi
if [[ ! -d "$app" || ! -x "$app/Contents/MacOS/Fluxion" ]]; then
  printf 'Fluxion.app is missing or incomplete: %s\n' "$app" >&2
  exit 69
fi

# The supplied app may come from a different checkout or an older release.
# Validate its own signed/bundled metadata before touching output or invoking
# expensive packaging tools. Settings constants are parsed as data, not run.
version="$(python3 - "$app" "$version" <<'PY'
import pathlib
import plistlib
import re
import sys

try:
    app = pathlib.Path(sys.argv[1])
    settings = (app / 'Contents/Resources/fluxion/chrome/fluxion-settings.js').read_text(encoding='utf-8')
    def constant(name):
        matches = re.findall(r'\bconst\s+' + name + r'\s*=\s*"([^"\r\n]+)"\s*;', settings)
        if len(matches) != 1:
            raise ValueError(f'missing or ambiguous bundled {name}')
        return matches[0]
    release = constant('PRODUCT_RELEASE')
    number = r'(?:0|[1-9][0-9]*)'
    if not re.fullmatch(number + r'\.' + number + r'\.' + number + r'(?:-preview\.' + number + r')?', release):
        raise ValueError('invalid bundled product release')
    base = release.split('-', 1)[0]
    with (app / 'Contents/Info.plist').open('rb') as handle:
        info = plistlib.load(handle)
    if not isinstance(info, dict):
        raise ValueError('application Info.plist is not a dictionary')
    if constant('PRODUCT_VERSION') != base or any(info.get(key) != base for key in ('CFBundleShortVersionString', 'CFBundleVersion')):
        raise ValueError('bundled Settings release and application bundle versions disagree')
    if sys.argv[2] and sys.argv[2] != release:
        raise ValueError(f'requested version {sys.argv[2]} does not match packaged release {release}')
    print(release)
except (OSError, ValueError, plistlib.InvalidFileException) as error:
    print(f'Refusing mismatched or incomplete Fluxion release metadata: {error}', file=sys.stderr)
    sys.exit(65)
PY
)"

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
attempt_dmg=""

cleanup() {
  if [[ -n "$attempt_dmg" && "$attempt_dmg" == "$output_dir"/."$dmg_name".attempt-*.dmg ]]; then
    rm -f -- "$attempt_dmg"
  fi
  rm -rf -- "$stage"
}
trap cleanup EXIT

ditto "$app" "$stage/Fluxion.app"
ln -s /Applications "$stage/Applications"
create_attempt=1
while (( create_attempt <= 4 )); do
  attempt_dmg="$output_dir/.${dmg_name}.attempt-${create_attempt}.dmg"
  rm -f -- "$attempt_dmg"
  if hdiutil create \
      -volname "Fluxion ${version}" \
      -srcfolder "$stage" \
      -format UDZO \
      -ov \
      "$attempt_dmg"; then
    mv -f -- "$attempt_dmg" "$dmg"
    attempt_dmg=""
    break
  fi
  rm -f -- "$attempt_dmg"
  if (( create_attempt == 4 )); then
    printf 'Unable to create the Fluxion DMG after %d attempts.\n' "$create_attempt" >&2
    exit 1
  fi
  printf 'hdiutil was temporarily unavailable; retrying DMG creation (%d/4).\n' \
    "$((create_attempt + 1))" >&2
  sleep "$((create_attempt * 2))"
  ((create_attempt += 1))
done

(
  cd "$output_dir"
  shasum -a 256 "$dmg_name" > "$dmg_name.sha256"
)

printf 'Created %s\n' "$dmg"
printf 'Created %s.sha256\n' "$dmg"
