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
  surfaces backed by Firefox services
- automated session/crash-recovery and private-window integration coverage
- signed macOS application bundle and native application menus

## Phase 3 — interaction model

- named/reorderable workspaces and Gecko-native tab groups (implemented)
- fuzzy command palette and high-volume tab search (initial command, tab,
  workspace, history, and bookmark search implemented)
- Gecko-native horizontal split view (implemented)
- vertical split orientation, peek pages, and configurable tab sleeping

## Phase 4 — local semantic history

- opt-in Gecko-local embeddings, sensitive-origin/domain exclusions, hybrid
  history ranker, and complete vector deletion controls (implemented)
- privacy-gated heading/body extraction and richer local metadata (implemented)
- inspectable Browser Memory answer evidence

## Phase 5 — optional AI providers

- disabled, Ollama, and OpenAI-compatible provider interfaces
- current-page questions, explicit tab comparison, and organisation suggestions
- no network AI dependency in ordinary browsing

## Phase 6 — release polish

- reduced-motion and accessibility audits
- performance, battery, memory, and hundreds-of-tabs profiling
- macOS notarization, Windows signing, Linux packages, and update service
- signed and notarized Apple Silicon DMGs attached to GitHub Releases for each
  stable, release-worthy milestone; early milestone DMGs remain clearly marked
  prereleases until Developer ID signing and notarization are configured
