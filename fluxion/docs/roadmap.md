# Roadmap

Fluxion is built in vertical slices. A phase is complete only when its visible
controls work and its failure paths have been tested.

## Phase 1 — Gecko foundation (implemented)

- Gecko runtime launch and isolated profile
- real navigation and native browser services
- Flow vertical tabs and tab actions
- workspace switching and persistence
- sidebar states, keyboard operation, and custom new tab

## Phase 2 — browser fundamentals hardening

- Fluxion-owned history, bookmarks, downloads, permissions, and settings
  surfaces backed by Firefox services (settings, unified Library, native
  bookmark-folder editing, and per-site permission management implemented)
- automated multi-launch session recovery and private-window isolation coverage
  for workspaces, pins, native groups, split views, Places, and Browser Memory
  (implemented)
- signed macOS application bundle and native application menus (custom Flow
  menu, distinct trailing toolbar menu, and About route implemented; Developer
  ID signing remains)

## Phase 3 — interaction model

- named/reorderable workspaces and Gecko-native tab groups (implemented)
- fuzzy command palette and high-volume tab search (initial command, tab,
  workspace, history, and bookmark search implemented)
- Gecko-native side-by-side and stacked split orientations, Peek Pages, and
  configurable tab sleeping (implemented, including direct spatial
  drag-to-split and edge reordering)

## Phase 4 — local semantic history

- opt-in Gecko-local embeddings, sensitive-origin/domain exclusions, hybrid
  history ranker, and complete vector deletion controls (implemented)
- privacy-gated heading/body extraction and richer local metadata (implemented)
- inspectable Browser Memory answer evidence (implemented)

## Phase 5 — optional AI providers

- disabled, Ollama, and OpenAI-compatible provider interfaces (implemented)
- grounded, cancellable current-page questions with visible source evidence
  (implemented)
- explicit, source-backed selected-tab comparison (implemented)
- local organisation suggestions with explicit confirmation and no automatic
  tab movement (implemented)
- no network AI dependency in ordinary browsing (implemented)

## Phase 6 — release polish

- reduced-motion and accessibility audits (Flow and palette keyboard/focus
  semantics, inert keyboard-revealable non-reflowing Focus overlay, complete
  native tab-status descriptions, and static reduced-motion loading state
  implemented; broader platform audit remains)
- performance, battery, memory, and hundreds-of-tabs profiling (packaged
  200-tab Flow render gate and bounded activity/battery/media/memory-aware
  Browser Memory scheduler implemented; broader resource profiling remains)
- macOS notarization, Windows signing, Linux packages, and update service
- signed and notarized Apple Silicon DMGs attached to GitHub Releases for each
  stable, release-worthy milestone; early milestone DMGs remain clearly marked
  prereleases until Developer ID signing and notarization are configured
