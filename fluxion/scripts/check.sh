#!/usr/bin/env bash
set -euo pipefail

fluxion_root="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$fluxion_root"

bash -n bin/fluxion scripts/prepare-runtime.sh scripts/check.sh scripts/smoke-gecko.sh
node --check chrome/core/url.js
node --check chrome/core/workspaces.js
node --check chrome/fluxion-chrome.js
node --test tests/*.test.js

printf 'Fluxion checks passed.\n'
