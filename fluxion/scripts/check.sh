#!/usr/bin/env bash
set -euo pipefail

fluxion_root="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$fluxion_root"

bash -n \
  bin/fluxion \
  scripts/build-macos.sh \
  scripts/package-macos-dmg.sh \
  scripts/prepare-macos-runtime.sh \
  scripts/prepare-runtime.sh \
  scripts/check.sh \
  scripts/smoke-gecko.sh \
  scripts/verify-macos-app.sh
node --check chrome/core/url.js
node --check chrome/core/workspaces.js
node --check chrome/fluxion-chrome.js
node --test tests/*.test.js

if [[ "$(uname -s)" == "Darwin" ]]; then
  xcrun clang -arch "$(uname -m)" -fsyntax-only -Wall -Wextra -Werror \
    packaging/macos/launcher.c
elif command -v cc >/dev/null 2>&1; then
  cc -fsyntax-only -Wall -Wextra -Werror -I tests/macos-stubs \
    packaging/macos/launcher.c
fi

printf 'Fluxion checks passed.\n'
