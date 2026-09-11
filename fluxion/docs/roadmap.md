# Roadmap

Fluxion is built in vertical slices. A phase is complete only when its visible
controls work and its failure paths have been tested.

## Phase 1 — Gecko foundation (implemented)

- Gecko runtime launch and isolated profile
- real navigation and native browser services
- Flow vertical tabs and tab actions
- workspace switching, persistence, and per-workspace active-page restoration
- sidebar states, keyboard operation, and custom new tab

## Phase 2 — browser fundamentals hardening

- Fluxion-owned history, bookmarks, downloads, permissions, and settings
  surfaces backed by Firefox services (settings, unified Library, native
  bookmark-folder editing, per-site permission management, and SearchService-
  owned palette routing implemented)
- full-database Library history/bookmark search, pre-limit folder filtering,
  bounded cursor pagination, stale-query isolation, and live native Places
  updates (implemented; representative very-large-profile timing remains)
- compact native Library item menus and one-entry-point result-list keyboard
  navigation, with focus retention, stale-action guards, and protected folders
  (implemented; Downloads retains its direct live transfer controls)
- automated multi-launch session recovery and private-window isolation coverage
  for multiple normal windows with distinct active workspaces, pins, native
  groups, split views, persistent restore-on-startup choice, Places, and Browser
  Memory (implemented), plus product-owned recently-closed menus and palette
  recovery over Gecko SessionStore (implemented)
- abrupt-process crash recovery gate with ordinary on-disk checkpoints, blank
  startup, two-window native layout/workspace restoration, and private evidence
  exclusion; real HTTP transfer, content upload/login forms, and native HTTP
  Basic authentication acceptance/cancellation/reload gates, plus a real macOS
  file-picker cancellation, Unicode-path selection, and byte-verified upload
  gate (implemented and passed in packaged macOS diagnostics;
  third-party authentication audits remain)
- signed macOS application bundle and native application menus (custom Flow
  menu, distinct trailing toolbar menu, and About route implemented; Developer
  ID signing remains)
- native macOS external URL/file delivery and same-profile command-line
  forwarding, with product-specific remoting identity and packaged native gates

## Phase 3 — interaction model

- native cross-window tab transfer with coherent workspace, pin, group, and
  split-page handling; normal/private separation and explicit Peek promotion
  before transfer (implemented; packaged live-document, menu/drag routing,
  hidden-workspace preservation, and adopted-tab clean/crash recovery passed;
  physical OS drag auditing remains)
- restored-page workspace reconciliation and stable cross-window workspace
  controls, including preserved Settings name drafts and keyboard focus
  (implemented; broader native interaction auditing continues)
- named/reorderable workspaces and Gecko-native tab groups (implemented,
  including live Settings management, safe cross-window tab migration, and a
  collapsed-group projection plus a focus-stable keyboard tree for headings
  and child pages)
- fuzzy command palette and high-volume tab search (initial command, tab,
  workspace, history, and bookmark search implemented; bounded ranking and live
  workspace-name/group context verified with 1,000 native tabs; slower
  structural-update samples still need performance work)
- snapshot-bound Flow menu actions and cancellation focus restoration
  (implemented with stale-target regression tests and native macOS tab/group
  menu keyboard navigation; broader pointer and assistive-technology audits
  remain)
- live General/Appearance preference controls with unsaved-draft preservation
  (implemented; two-window packaged verification passed); adjustable
  expanded/Focus-overlay width with pointer cancellation, keyboard access,
  draft-safe Settings, shared preferences and responsive bounds is implemented
  in the published 0.56 preview, with packaged pointer-capture, native keyboard,
  narrow-window geometry and clean-relaunch validation passed; physical OS
  pointer and assistive-technology audits remain
- all-section responsive Settings, including workspace editing, complete
  permission expiry and origin/context-specific permission-reset names
  (implemented in the published 0.57 preview; packaged checks passed at 320/600 pixel
  root widths across all ten sections without horizontal page scrolling)
- Settings-owned shortcut capture and collision-aware customized-map loading,
  including valid swaps/cycles and cross-window preference synchronization
  (implemented; packaged DOM-event integration gate added)
- Gecko-native side-by-side and stacked split orientations, Peek Pages, and
  configurable tab sleeping (implemented, including direct spatial
  drag-to-split and edge reordering)

## Phase 4 — local semantic history

- source-duplication-invariant ranking and old exact-title/URL candidate
  retention before limits, with shared accent/Unicode candidate normalization
  and transactional migration of existing evidence (implemented)
- explicit saved extraction workspace/group context, separate from current-
  window open-tab context, with unknown legacy names left unknown and a
  transactional schema migration (implemented; not a per-visit context log)
- opt-in Gecko-local embeddings, independently selectable keyword-only recall,
  sensitive-origin/domain exclusions, hybrid history ranker, and complete
  vector deletion controls (implemented)
- privacy-gated heading/body extraction and richer local metadata (implemented)
- encoded sensitive-route classification and first-open cleanup of existing
  evidence (published in 0.59; native storage/startup and full release checks passed);
  named user-defined domain exclusion lists are published in 0.61, with
  pre-embedding native candidate filtering, conflict-safe editing and
  corrupt-policy restart retention verified by full native release gates
  (not automatic site categorization)
- inspectable Browser Memory answer evidence (implemented)
- history-removal propagation and invalidation of pending extraction, embeddings,
  and searches (implemented; native release verification covers exact URL
  deletion and preservation of unrelated evidence)

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
  native tab-status descriptions, static reduced-motion loading state, and
  live System/Light/Dark Gecko theme selection implemented; pointer-close
  stability now prevents shifted rows from receiving accidental repeat clicks;
  Settings fields expose their visible labels and help text to accessibility;
  broader platform audit remains)
- cross-platform command access after replacing PanelUI (native Fluxion Page
  and Tools menus with Gecko find/save/print/zoom/fullscreen/extensions and
  DevTools delegation, plus the same availability-checked actions in the
  universal command palette, implemented)
- performance, battery, memory, and hundreds-of-tabs profiling (packaged
  200-tab initial render and repeated content-update gates, stable in-place
  content updates, and bounded activity/battery/media/memory-aware
  Browser Memory scheduler implemented; broader resource profiling remains)
- preserve Flow row identity during ordinary same-workspace tab selection
  (implemented in published 0.58: 1,000-tab native selection/identity/mutation
  gate, correct native multi-selection event target, pinned/group/split state
  and collapsed-group structural fallback; broader hardware profiling remains)
- reduce redundant workspace-session work (0.58 avoids unchanged marker writes
  and duplicate same-call ownership reads, reducing the instrumented 1,000-tab
  selection path from 6,010 to 4,006 reads; authoritative passes and O(N) scans
  remain, with no cache across restoration events)
- preserve flat Flow rows through opening, closing and reordering, with
  minimal DOM moves and exact owned control-focus retention (published in 0.60;
  all combined native gates and packaging passed; published 0.62 extends keyed
  reconciliation to groups and splits with 21 native 1,000-tab operations,
  retained control/heading identity and global visible-order checks;
  physical-hardware profiling and whole-group drag interaction remain)
- bounded page evidence traversal without DOM cloning or full text-node reads,
  with editable/form subtree pruning (implemented; native document-wide source
  and password selectors remain, and broader resource profiling is still needed)
- explicit in-app Fluxion release discovery (implemented, with preview-aware
  version checks, official asset validation, and manual download/installation)
- macOS notarization, Windows signing, Linux packages, and authenticated
  automatic installation/update service
- signed and notarized Apple Silicon DMGs attached to GitHub Releases for each
  stable, release-worthy milestone; early milestone DMGs remain clearly marked
  prereleases until Developer ID signing and notarization are configured
