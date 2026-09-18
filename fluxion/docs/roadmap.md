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

- native default-browser status and explicit OS confirmation from custom
  General settings; physical Control shortcut recording, real HTML bookmark
  import and native Fluxion branding (published in 0.70)
- six last-window restoration stages, including explicit homepage→restore
  choice and normal quit/relaunch without test-forced saving; closing the final
  visible workspace tab preserves other workspaces' hidden pages (0.70).
  The reported original 0.69 profile and physical red-button audit remain.
- repeated macOS last-window close/reopen and relaunch, with preserved selected
  page, lazy tabs, pins and metadata; external requests and startup opt-outs
  retained, private data excluded (published in 0.69 with native gates)
- macOS pointer-focused shortcut recording and native Command+Option modifier
  handling; bookmarks visibility in custom General settings (published in 0.69)
- custom General/Privacy controls for smooth scrolling, hardware acceleration,
  download-location prompting, password saving, popup blocking and HTTPS-only
  mode (published in 0.68; exact asynchronous disk persistence, cross-window
  synchronization, policy locks and scoped resets verified without retuning
  defaults on Settings open)
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

- explicit current-workspace duplicate cleanup by exact URL and Gecko account
  container, preserving protected tabs, native unsaved-page prompts and undo
  (published in 0.73; actual native menu/confirmation, nonzero-container reopen,
  stale-consent rejection and real beforeunload cancellation verified).
  Canceled Peek closure retains its source, with nested-event regression tests.
- Focus retraction over Settings and the floating sidebar, including saved
  disabled autohide preferences without preference rewrites; viewport-inset
  heading and genuine navigation hit testing (published in 0.70.2).
- integrated pointer/keyboard colour field and paged theme editor, immediate
  stationary-pointer tab-close settling, native fullscreen toolbar reveal and
  actual eight-pixel content clipping (published in 0.70)
- existing Gecko containers in tab context menus, preserving source tabs and
  workspace placement without copying login/form/session data; actual account
  isolation verified (0.70). This is not automatic workspace/container mapping.
- fully hidden Focus navigation with top-edge/keyboard/popup reveal, six-pixel
  floating sidebar insets, matching New tab hover/close geometry, repeated
  four-workspace swipes, unified appearance preview/save/cancel editor and
  supplied application artwork (published in 0.69; physical trackpad and native
  OS colour-picker-dialog audits remain)
- workspace-associated account containers with tab placement independent of
  account identity ([audited design](workspace-containers.md); **not implemented,
  beyond the existing-container actions in 0.70**, pending automatic creation-routing,
  private-window and session/crash recovery gates)
- hover/focus workspace-heading options, native workspace menus, per-workspace
  light/dark color editing, centered bottom symbols and refined bidirectional
  swipe heuristics with a reduced-motion-aware 150ms transition (published in
  0.68; native menu keyboard activation, theme persistence and routed swipe
  verification passed); expanded/edge-revealed surfaces retain a shared layout
  with a thin outline and subtle corners only for the overlay, confirmed by
  actual captures and native no-reflow/hover-cycle checks
- coherent navigation/page-column alignment, equal address-field insets, quiet
  single-frame suggestions, single-workspace fresh defaults and horizontal
  sidebar workspace gestures (published in 0.67; native first-focus keyboard,
  real Places retrieval, pairwise geometry and trusted wheel-routing gates
  passed; the first wide popup capture has an unresolved backdrop omission,
  and physical-M3 first-open/trackpad checks remain)
- predictable collapse/expand with edge-hover reveal, keyboard/menu focus
  ownership, inline New tab and a bottom symbol workspace dock; optional
  cross-window light/dark chrome palettes with readable text and Reset
  (published in 0.66; native short-window/twelve-workspace, repeated hover,
  palette restart, content-boundary and Settings accessibility gates passed)
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
- linear sleeping ownership checks and ordinary workspace preference selection,
  plus live-input-validated command-palette organisation memoization (published
  0.71; reproducible frozen-source comparisons and mandatory 1,000-HTTPS-tab
  native palette gate passed; [milestone](milestone-0.71.md) records timing
  limits, while structural-update and physical M3 profiling remain)
- expanded sidebar heading aligned below actual native caption controls, with
  narrow-window fallback; scoped 120 ms animated Focus navigation and explicit
  native single/multiple tab-link copying (0.72; normal/fullscreen, RTL,
  reduced-motion, real menu and pasteboard checks passed; physical M3/trackpad
  assessment remains)
- directional Focus toolbar retention on upward exits, edge-to-edge hidden
  sidebar content and no implicit address focus after final-workspace-tab
  replacement (0.72.1; native OS-pointer, Cmd-W, fullscreen, reduced-motion,
  session and security gates passed; expanded/compact behavior retained)
- complete native Extensions empty-state product artwork and actual macOS
  application-menu branding evidence (0.72.2; real popup and OS-menu captures,
  native visibility-policy checks and strict resource verification passed)
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
  published 0.63 adds whole-group drag placement and intact split-pair drops
  into groups, with 30 structural operations and seven real-page state checks;
  physical-hardware profiling remains)
- native keyboard-close projection excludes still-attached closing Gecko tabs;
  pointer-close spacing survives same-window content focus transfer and canceled
  page-leave prompts restore surviving rows (published 0.65; extracted lifecycle
  regressions and real macOS Command-W/reopen checks passed)
- quieter single-band workspace controls, mode-aware workspace navigation,
  consistent thin page/Settings/Library frame and intrinsic Settings actions
  (published 0.65 following an unslop-ui audit; actual light/dark and split-page
  captures inspected, responsive Settings passed; a full-resolution user
  reference and broader physical interaction/accessibility audits remain)
- bounded page evidence traversal without DOM cloning or full text-node reads,
  with editable/form subtree pruning (implemented; native document-wide source
  and password selectors remain, and broader resource profiling is still needed)
- explicit in-app Fluxion release discovery (implemented, with preview-aware
  version checks, official asset validation, and manual download/installation;
  published 0.64 replaces anonymous API dependency with a verified, expiring
  public feed, serialized publication and native independent-release comparison;
  0.70.1 adds signed Sparkle installation/restart with explicit consent,
  cancellable quit, restored tabs and real signed-replacement verification;
  default-profile/single-process macOS scope remains)
- macOS notarization, Windows signing, Linux packages, and broader-profile
  automatic installation/update support
- signed and notarized Apple Silicon DMGs attached to GitHub Releases for each
  stable, release-worthy milestone; early milestone DMGs remain clearly marked
  prereleases until Developer ID signing and notarization are configured
