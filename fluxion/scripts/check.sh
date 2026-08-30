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
  scripts/verify-macos-app.sh \
  scripts/verify-macos-session.sh
node --check < runtime/fluxion.cfg
node --check chrome/core/url.js
node --check chrome/core/search.js
node --check chrome/core/ai-providers.js
node --check chrome/core/library-data.js
node --check chrome/core/permissions.js
node --check chrome/core/session-recovery.js
node --check chrome/core/tab-organisation.js
node --check chrome/core/tab-groups.js
node --check chrome/core/split-views.js
node --check chrome/core/memory-policy.js
node --check chrome/core/memory-content.js
node --check chrome/core/memory-ranking.js
node --check chrome/core/memory-grounding.js
node --check chrome/core/peek.js
node --check chrome/core/settings.js
node --check chrome/core/shortcuts.js
node --check chrome/core/tab-sleeping.js
node --check chrome/core/tab-selection.js
node --check chrome/core/workspaces.js
node --check chrome/fluxion-chrome.js
node --check chrome/fluxion-shortcuts.js
node --check chrome/fluxion-memory.js
node --check chrome/fluxion-ai.js
node --check chrome/fluxion-library.js
node --check chrome/fluxion-permissions.js
node --check chrome/fluxion-session-recovery.js
node --check chrome/fluxion-peek.js
node --check chrome/fluxion-settings.js
node --check chrome/fluxion-tab-sleeping.js
node --check chrome/fluxion-palette.js
node --check actors/FluxionMemoryPageChild.sys.mjs
node --check actors/FluxionMemoryPageParent.sys.mjs
node --check modules/FluxionMemoryStore.sys.mjs
node --test tests/*.test.js
python3 -c 'import ast, pathlib; ast.parse(pathlib.Path("tests/fixtures/ollama-stub.py").read_text(encoding="utf-8"))'

if [[ "$(uname -s)" == "Darwin" ]]; then
  xcrun clang -arch "$(uname -m)" -fsyntax-only -Wall -Wextra -Werror \
    packaging/macos/launcher.c
elif command -v cc >/dev/null 2>&1; then
  cc -fsyntax-only -Wall -Wextra -Werror -I tests/macos-stubs \
    packaging/macos/launcher.c
fi

printf 'Fluxion checks passed.\n'
