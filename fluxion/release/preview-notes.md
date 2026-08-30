This is a downloadable Fluxion Gecko Foundation Preview for macOS.

It includes real Gecko webpage rendering, the Fluxion **Flow** vertical tab
sidebar, workspaces, navigation, Firefox's mature browser services, a separate
Fluxion profile, and a native universal launcher with Apple Silicon support.

This is an early development preview, not a stable release. Fluxion retains
Gecko's browser services and security boundaries while its independent product
interface is built out incrementally.

Version 0.19 gives Fluxion ownership of its native macOS application model:

- add a top-level **Flow** menu beside the familiar native browser menus;
- open the command palette and fast tab search with the user's current editable
  shortcut labels shown in the menu;
- select Expanded, Compact, or Focus sidebar modes and switch among the live,
  profile-persisted workspace list from native menu items;
- route History, Bookmarks, and Downloads into Fluxion Library and create a new
  workspace without reaching a Firefox-branded management surface;
- keep Gecko's standard File, Edit, View, History, Bookmarks, Tools, Window, and
  Help command implementations intact for platform behaviour and accessibility;
- replace the stale About route with the restrained
  `about:preferences#about` Fluxion surface, hide bundle file paths, and enforce
  that its displayed version matches the shipped application.

The macOS release gate now requires the native Flow menu health marker, checks
the packaged About version against `CFBundleShortVersionString`, opens the real
About Fluxion page, and captures that final independent product surface before
the DMG can be published.

Version 0.18 adds a dedicated site Permissions Center to Fluxion Settings:

- search every saved HTTP(S) site decision by origin, permission type, state,
  or browsing context without exposing page paths, queries, or credentials;
- inspect camera, microphone, location, notification, storage, autoplay, and
  future Gecko permission types with restrained allow/block/ask states;
- distinguish permanent, session, timed, policy-managed, and tab-specific
  expiry while identifying private and container-scoped records;
- reset one exact native permission, every decision for one site, or all saved
  decisions, with confirmation around broad destructive actions;
- observe Gecko's live `perm-changed` stream so decisions made by page prompts
  or other windows appear without restarting or maintaining shadow state.

The macOS release gate now creates native camera, microphone, and location
records in the packaged browser, removes only the location record through
Fluxion, and refuses publication unless the remaining live Gecko decisions are
visible in the custom Permissions surface.

Version 0.17 completes native bookmark-folder management in Fluxion Library:

- browse the actual Places folder hierarchy, including nested user folders and
  clearly named toolbar, menu, mobile, and other-bookmark roots;
- save the last ordinary webpage directly into the selected folder without
  bookmarking the internal Library page;
- filter bookmarks by folder, rename saved pages, and move them atomically with
  Gecko's required destination index;
- create top-level folders or subfolders and rename user-created folders;
- protect Places roots and tag pseudo-folders from invalid mutations;
- refuse non-empty folder deletion at the database API boundary, even if the
  visible child count became stale before confirmation;
- keep Gecko's advanced organizer available for bulk import/export workflows.

The macOS release gate now creates a real Places folder, moves and renames a
real bookmark into it, filters Fluxion Library to that folder, and requires the
resulting filed bookmark to be visible before the DMG can be published.

Version 0.16 introduces Fluxion Library as the primary history, bookmark, and
download surface:

- search recent history, saved bookmarks, folder context, download names, and
  source URLs in one restrained native-feeling interface;
- open or remove individual history and bookmark records from the real Gecko
  Places database with confirmation before destructive data changes;
- observe Gecko's live public download list—or only the private list in a
  private window—without polling or shadow download state;
- open completed files, reveal them in Finder, cancel active transfers, retry
  interrupted transfers, and remove list entries through native Download APIs;
- retain Gecko's full bookmark-folder organizer behind a concise management
  route while Fluxion's folder editor remains in development;
- route command-palette history, bookmark, and download actions directly into
  the independent Fluxion surface instead of Firefox-styled management pages.

The macOS release gate now writes a real visit and bookmark into the isolated
Places profile, adds a native Download object, and refuses the DMG unless all
three are visible in the packaged Fluxion Library after every earlier browser
gate passes.

Version 0.15 adds explicit, grounded comparison across selected tabs:

- Command-click or Shift-click two to four real Gecko tabs in Flow, then run
  **Compare Selected Pages** from the command palette;
- ask a focused comparison question and receive one answer with a separate
  visible title, URL, and bounded excerpt for every source page;
- cap every extracted page at 5.5 KB and refuse the whole request when any
  selected page is private, sensitive, password-bearing, or user-excluded;
- preserve cancellation, loopback/HTTPS restrictions, redirect refusal,
  credential isolation, and remote page-sharing consent from v0.14;
- never select, regroup, or move tabs on a model's behalf.

The macOS release gate now requires both a grounded current-page request and a
second two-page comparison request from the packaged universal app. The final
comparison and both cited source records must be visible before publishing.

Version 0.14 introduces the first optional generative-AI boundary:

- configure Disabled, local Ollama, or generic OpenAI-compatible providers in
  live Fluxion Settings without restarting;
- ask a question about the current page from the command palette and receive a
  concise answer beside the exact title, URL, and extracted source excerpt;
- keep AI disabled by default and keep ordinary browsing and deterministic
  Browser Memory fully functional without a model or provider;
- store compatible API keys in Firefox's encrypted Login Manager rather than
  preferences or source code;
- permit HTTP only on loopback, require HTTPS and explicit page-sharing consent
  remotely, omit browser credentials and cache, and cancel requests with Escape;
- reject private windows, password forms, sensitive routes, and user-excluded
  domains before any page text reaches a provider.

The macOS release gate now runs a loopback Ollama-compatible fixture and refuses
the DMG unless the packaged app sends a correctly bounded page-context request,
receives the grounded response, and visibly renders its source evidence.

Version 0.13 makes Browser Memory recall inspectable and grounded:

- present a concise best match derived only from the top stored history record;
- show a bounded source excerpt, match reason, domain, visit timing, workspace,
  and tab-group context alongside each result;
- rank exact heading, description, and page-body evidence ahead of weaker
  semantic neighbors;
- return an explicit insufficient-evidence response instead of inventing a
  browsing memory;
- keep the entire answer path deterministic and functional without generative
  AI or a network provider.

The macOS release gate now extracts a real HTTPS page, reads its evidence back
from the packaged local database, renders the grounded recall surface, and
requires that evidence to be visible before the DMG is created.

Version 0.12 enriches local Browser Memory with page evidence:

- extract bounded titles, descriptions, headings, and useful article/main text
  through a process-isolated Gecko window actor;
- generate embeddings on-device with Gecko's packaged model and store them in
  Fluxion's own local SQLite `vec0` database;
- combine content keyword matches and semantic similarity with the existing
  exact Places, recency, frequency, and workspace ranking signals;
- reject private windows, password forms, sensitive routes, non-web pages, and
  user-excluded domains before content reaches storage;
- delete enriched records and vectors when Browser Memory is cleared or a
  domain is excluded, without deleting ordinary browsing history.

Ordinary browsing remains fully functional with Browser Memory disabled.

Version 0.11 makes Fluxion's keyboard model user-editable:

- change the command palette, tab search, Flow sidebar, next-workspace, and
  previous-workspace shortcuts directly in Fluxion Settings;
- capture physical key combinations with correct Command-key presentation on
  macOS and Ctrl-key presentation on other platforms;
- reject unmodified keys, protected browser/macOS combinations, and conflicts
  with another Fluxion command before saving;
- persist the normalized shortcut map in the browser profile and update live
  command handlers immediately without restarting;
- reset individual actions while keeping Gecko's standard browser shortcuts
  clearly listed and untouched.

The macOS release gate now changes a shortcut in the packaged app, reads the
persisted value back, and visually inspects the Keyboard settings section.

Version 0.10 adds native multi-select workflows to Flow:

- Command-click individual tabs and Shift-click a visible range using familiar
  macOS selection semantics;
- retain Gecko's native `selectedTabs`, `TabMultiSelect`, split-pair selection,
  and accessibility state instead of maintaining a second selection model;
- batch duplicate, reload, pin/unpin, sleep, group, move to workspace, drag,
  and close from the same concise tab menu;
- make split pairs move atomically and keep actions scoped to one tab when the
  context-clicked tab is outside the current selection;
- show multi-selected rows with a quiet one-pixel boundary rather than a loud
  block of accent colour.

The macOS release gate now creates a real native Gecko multi-selection and
requires both selected rows to remain projected in Flow.

Version 0.9 adds secure, temporary Peek Pages:

- choose **Peek Link** from Gecko's native webpage link menu;
- open the real page in a real Gecko tab using the source document's existing
  principal, CSP, referrer, container, and history parameters;
- label the temporary page quietly in Flow and close it automatically when the
  user switches away;
- keep it as an ordinary tab, promote it beside the source as a native split,
  or close it without polluting recently closed tabs;
- discard unpromoted Peeks during restart/crash restoration while ordinary
  promoted tabs continue through SessionStore.

The macOS release gate now opens and renders a real HTTPS Peek Page before the
DMG can be packaged.

Version 0.8 adds real Gecko-native tab sleeping for large sessions:

- choose 5, 15, 30, or 60 minutes—or never—from live Fluxion Settings;
- flush current SessionStore state, release the content process through
  Gecko's native discard path, and restore the page when selected;
- never force a discard, allowing Gecko to protect unsaved forms and active
  page dialogs through its `beforeunload` checks;
- exclude selected, pinned, audio/PiP, shared, split-view, busy, private, and
  already sleeping tabs;
- show a quiet crescent state in Flow and provide a concise manual sleep action
  for eligible background tabs.

The macOS release gate now proves that a real background Gecko browser was
discarded before packaging the app.

Version 0.7 replaces the visible Firefox preferences page with live Fluxion
Settings:

- a restrained, compact preferences layout that remains beside the Flow tab
  sidebar instead of presenting an admin dashboard;
- startup, session restoration, homepage, external-link, and default-search
  controls backed by Gecko preferences and search services;
- immediate Flow sidebar mode and tab-density controls plus an independent
  animation switch that still respects macOS Reduce Motion;
- real tab warning and foreground-selection controls;
- Browser Memory opt-in, domain exclusions, and semantic-data deletion;
- confirmed actions to clear Gecko history, cookies/cache, or saved site
  permissions;
- an accurate keyboard reference for Fluxion and retained browser shortcuts.

The macOS release gate now opens the packaged settings surface and refuses to
publish unless the privileged controls are visible and connected.

Version 0.6 introduces the first usable Browser Memory milestone:

- opt in from the command palette; ordinary browsing remains AI-independent;
- search history by exact text and, on supported Macs, local semantic meaning;
- combine keyword evidence, vector similarity, recency, visit frequency, and
  active-workspace relevance without letting weak semantics beat exact terms;
- keep history and embeddings on-device with Gecko's local embedding runtime;
- reject Browser Memory access from private windows;
- automatically filter obvious auth, mail, account, billing, and payment URLs;
- exclude the current domain and its subdomains without deleting normal history;
- clear all semantic vectors and disable the feature from a visible control;
- fall back to exact local history search when the model is unavailable.

The macOS gate opens the packaged Browser Memory service and visually inspects
its dedicated search mode before a DMG can be published.

Version 0.5 adds a real Gecko-native split view to the Flow interaction model:

- place any two ordinary tabs side by side from a concise tab menu;
- choose the second page with fuzzy tab search from the command palette;
- open a blank page directly beside the current page;
- resize the two live Gecko panels with a directly manipulated divider;
- swap sides or separate the pair without losing either tab;
- treat paired tabs as one connected item when moving between workspaces;
- restore the split through Gecko SessionStore after restart or recovery;
- keep security state, dialogs, page processes, and navigation owned by Gecko.

The panel focus, divider, and inactive-site footer are restyled into Fluxion's
restrained visual system. The macOS release gate now refuses a build unless a
native split is live alongside Flow and a native tab group.

Version 0.4 integrates Gecko-native tab groups directly into Flow:

- compact group headings with collapse and expand state;
- group names and restrained colour indicators;
- drag tabs into groups or use the concise native context menu;
- reorder groups and move a whole group between workspaces;
- remove individual tabs from a group or ungroup without closing anything;
- include group names in high-volume tab search;
- retain Gecko SessionStore ownership of group membership and crash recovery.

The macOS release gate now creates a real native group and refuses the build
unless Fluxion renders it successfully.

Version 0.3 made Fluxion workspaces fully persistent and user-manageable:

- create and name workspaces directly from the Flow strip;
- rename and reorder workspaces through concise native context menus;
- choose one of five geometric symbols and five restrained accents;
- drag tabs directly onto workspace destinations;
- delete workspaces without losing tabs—open pages move to an adjacent space;
- search for the `New workspace` action from the command palette.

It also includes the version 0.2 independent browser-chrome foundation:

- a restrained navigation skin that retains Gecko's security-aware URL field;
- a flatter, denser Flow sidebar with a 44px compact rail;
- icon-only persistent pinned tabs and quieter workspace indicators;
- `Cmd/Ctrl+K` search across commands, tabs, workspaces, history, and bookmarks;
- `Cmd/Ctrl+Shift+A` high-volume open-tab search;
- a blank new-tab surface with immediate address-field focus;
- native macOS traffic-light controls and a real HTTPS rendering release gate;
- removal of inherited Firefox startup icon, onboarding, and visible app
  branding.

## Install

1. Download the `.dmg` file and open it.
2. Drag `Fluxion.app` to the Applications link.
3. Open Fluxion from Applications.

The preview is ad-hoc signed but not Apple-notarized. If macOS blocks the first
launch, right-click Fluxion and choose **Open**, or approve it under **System
Settings → Privacy & Security**. The attached `.sha256` file can be used to
verify the download.

Private browsing, downloads, permissions, PDF viewing, developer tools, media,
and WebExtensions continue to use Firefox/Gecko's existing implementations.
Platform passkeys are unavailable in this ad-hoc-signed preview because that
macOS entitlement requires an Apple provisioning profile.
