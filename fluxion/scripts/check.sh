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
  scripts/verify-macos-sleep.sh \
  scripts/verify-macos-memory.sh \
  scripts/verify-macos-memory-privacy.sh \
  scripts/verify-macos-memory-policy.sh \
  scripts/verify-macos-memory-corruption.sh \
  scripts/verify-macos-updates.sh \
  scripts/verify-macos-external-open.sh \
  scripts/verify-macos-settings-accessibility.sh \
  scripts/verify-macos-ai-privacy.sh \
  scripts/verify-macos-flow.sh \
  scripts/verify-macos-browsing.sh \
  scripts/verify-macos-file-picker.sh \
  scripts/verify-macos-tab-transfer.sh \
  scripts/verify-macos-shortcuts.sh \
  scripts/verify-macos-sidebar-width.sh \
  scripts/verify-macos-selection.sh \
  scripts/verify-macos-structure.sh \
  scripts/verify-macos-library.sh \
  scripts/verify-macos-workspaces.sh \
  scripts/verify-macos-default-bookmarks.sh \
  scripts/verify-macos-session.sh
node --check < runtime/fluxion.cfg
node --check scripts/download-gecko.mjs
node --check scripts/benchmark-tab-search.cjs
node --check scripts/browsing-fixture.mjs
node --check chrome/core/url.js
node --check chrome/core/search.js
node --check chrome/core/flow-navigation.js
node --check chrome/core/flow-tab-content.js
node --check chrome/core/index-scheduler.js
node --check chrome/core/ai-providers.js
node --check chrome/core/library-data.js
node --check chrome/core/library-query.js
node --check chrome/core/library-changes.js
node --check chrome/core/library-navigation.js
node --check chrome/core/library-downloads.js
node --check chrome/core/data-clearing.js
node --check chrome/core/theme.js
node --check chrome/core/permissions.js
node --check chrome/core/session-recovery.js
node --check chrome/core/tab-organisation.js
node --check chrome/core/tab-groups.js
node --check chrome/core/split-views.js
node --check chrome/core/memory-policy.js
node --check chrome/core/memory-content.js
node --check chrome/core/memory-search.js
node --check chrome/core/memory-context.js
node --check chrome/core/memory-ranking.js
node --check chrome/core/memory-grounding.js
node --check chrome/core/peek.js
node --check chrome/core/settings.js
node --check chrome/core/sidebar-width.js
node --check chrome/core/shortcuts.js
node --check chrome/core/tab-sleeping.js
node --check chrome/core/tab-selection.js
node --check chrome/core/tab-status.js
node --check chrome/core/tab-drop.js
node --check chrome/core/tab-transfer-drag.js
node --check chrome/core/flow-menu-session.js
node --check chrome/core/workspaces.js
node --check chrome/core/workspace-editor.js
node --check chrome/core/workspace-tabs.js
node --check chrome/fluxion-chrome.js
node --check chrome/fluxion-sidebar-width.js
node --check chrome/fluxion-sidebar-width-verification.js
node --check chrome/fluxion-selection-verification.js
node --check chrome/fluxion-structure-verification.js
node --check chrome/fluxion-flow-performance.js
node --check chrome/fluxion-browsing-verification.js
node --check chrome/fluxion-file-picker-verification.js
node --check chrome/fluxion-tab-transfer.js
node --check chrome/fluxion-window-tabs.js
node --check chrome/fluxion-tab-transfer-verification.js
node --check chrome/fluxion-shortcut-verification.js
node --check chrome/fluxion-library-verification.js
node --check chrome/fluxion-memory-privacy-verification.js
node --check chrome/fluxion-memory-policy-verification.js
node --check chrome/fluxion-memory-corruption-verification.js
node --check chrome/fluxion-memory-migration-verification.js
node --check chrome/fluxion-default-bookmarks-verification.js
node --check chrome/fluxion-update-verification.js
node --check chrome/fluxion-external-open-verification.js
node --check chrome/fluxion-settings-accessibility-verification.js
node --check chrome/fluxion-ai-privacy-verification.js
node --check chrome/fluxion-workspace-verification.js
node --check scripts/ai-privacy-fixture.mjs
node --check scripts/tab-transfer-fixture.mjs
node --check chrome/fluxion-data-clearing.js
node --check chrome/fluxion-theme.js
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
node --check actors/FluxionBrowsingVerificationChild.sys.mjs
node --check actors/FluxionBrowsingVerificationParent.sys.mjs
node --check actors/FluxionFilePickerVerificationChild.sys.mjs
node --check actors/FluxionFilePickerVerificationParent.sys.mjs
node --check actors/FluxionTabTransferVerificationChild.sys.mjs
node --check actors/FluxionTabTransferVerificationParent.sys.mjs
node --check modules/FluxionMemoryStore.sys.mjs
node --check modules/FluxionMemorySearch.sys.mjs
node --check modules/FluxionMemoryPolicy.sys.mjs
node --check modules/FluxionExclusionPolicy.sys.mjs
node --check chrome/fluxion-memory-policy-verification.js
bash -n scripts/verify-macos-memory-policy.sh
node --check modules/FluxionNativeMemory.sys.mjs
node --check modules/FluxionRelease.sys.mjs
node --check modules/FluxionUpdates.sys.mjs
node --check modules/FluxionAIControl.sys.mjs
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
