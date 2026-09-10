# Milestone release process

macOS milestone builds use `.github/workflows/macos-preview-release.yml` in two
passes:

Application assembly and the complete native integration verifier are separate
required CI steps. Independent runtime gates still run when another verifier
fails, but any failure prevents packaging and publication. Local builds retain
their default launch verification. The sleeping-tab race fixture uses its own
fresh profile so other tests cannot change its selected tab or workspace while
Gecko is flushing state.

Release inputs are locked in `fluxion/runtime/gecko-lock.json`. The downloader
accepts only the exact versioned Mozilla archive URL, verifies SHA-256 before
making a DMG available, and never overwrites an existing destination. The
workflow verifies Mozilla's original app signature before modifying the copy.
Both passes use the same reviewed Gecko bytes, though signing and packaging
metadata need not be byte-for-byte reproducible.

`Gecko security update watch` checks Mozilla's stable version daily and fails
when it differs from the lock. Review Mozilla's release/security notes, update
the version/URL/digest together using that release's official `SHA256SUMS`, run
the full native gates, and publish a new Fluxion DMG promptly. This check does
not install updates or claim users have the latest version. Preview application
updates are manual; Firefox's updater is blocked by `DisableAppUpdate` so it
cannot replace Fluxion with Firefox. Extension updates remain independent.

1. Run with `publish=false`. GitHub builds and ad-hoc signs the universal app,
   launches Gecko with an isolated profile, requires Flow, command palette,
   live Fluxion Settings, Browser Memory service, native tab-group, native split-view,
   and AI-provider health markers, validates application branding, packages the
   DMG, and preserves a chrome-inspection screenshot when the runner permits it.
   The UI suite exercises Gecko's semantic capability or its intentional
   low-spec lexical fallback. A separate fresh-profile gate must generate real
   Gecko embeddings and retrieve plant evidence for a nonliteral query;
   lexical fallback cannot pass that semantic gate. A loopback-only Ollama-compatible
   fixture must receive a grounded page payload from the packaged app and the
   resulting cited answer must be visible before packaging can proceed. The
   fixture then requires a second request containing two explicitly selected
   page contexts and Fluxion must render both sources. The final gate seeds a
   real Places visit, bookmark, and native download-list record, opens Fluxion
   Library, and requires all three backends to render before capture. It then
   creates a Places folder, moves and renames the test bookmark using the public
   mutation API, filters Library to that folder, and requires the filed record
   to be visible. Finally, it writes real camera, microphone, and location
   decisions through Gecko's permission manager, resets the exact location
   record through Fluxion, and requires the remaining native decisions to be
   visible in the Permissions settings surface. The last identity gate requires
   Fluxion's native Flow application menu to exist, verifies that the bundled
   About version matches the application bundle version, and captures the real
   `about:preferences?fluxion=about` product surface instead of an inherited Firefox
   route or exposed bundle file path.
   The interaction gate also creates three related ungrouped pages and requires
   the local **Suggest tab group** command, proposed name, and confirmation-only
   execution path to be available in the packaged command palette.
   A scale/accessibility gate then opens 200 temporary native tabs, bounds the
   Flow render, requires a single roving tab stop, drives ArrowDown, verifies
   selected-tab and DOM focus identity after rerender, and removes the fixture
   before capture.
   A loopback-only browsing gate performs a real Gecko HTTP download, checks
   its bytes and Library controls, and submits that downloaded file through a
   content document's multipart form. A content login form must produce a
   server redirect and an HttpOnly cookie-backed session. A fixed-command test
   actor is registered only when this fixture is explicitly enabled, matches
   loopback HTTP, and checks the exact origin and port on every command;
   it accepts no content-initiated privileged requests. This does not automate
   the operating system file picker or claim arbitrary third-party login coverage.
   An isolated Library gate seeds 360 native Places history records and 550
   bookmarks in one folder, plus a wrong-folder decoy. It traverses bounded pages
   without omissions or duplicates, returns to the exact first page under tied
   timestamps, searches older records and Unicode titles beyond the old caps,
   and requires a final search to win over previous pending work. Native history
   deletion and bookmark rename/removal must update the visible results without
   an explicit Library refresh. Native geometry checks also require a deep-scroll
   sticky pager, retained reading focus/scroll after a bookmark title update,
   and unclipped bookmark controls in a narrow window. A separate Library
   screenshot is preserved.
   A separate native Memory privacy gate inserts explicit valid tensors tied
   to actual Places visits and reads both native vector and mapping tables
   after the real Places startup-completion boundary. It verifies seeded visits
   through canonical history and the attached database before inserting vectors;
   an insert completion callback alone is not accepted as persistence evidence.
   It checks the native tables
   across provider disable/re-enable and clearing from a second window. It
   retains the real storage connection while disabled, so a null feature-gated
   accessor cannot masquerade as successful deletion. This is a cleanup test,
   not model-inference evidence; the real semantic retrieval gate remains
   separate. The same gate reads an excluded page's actual vector bytes before
   and after a second-window exclusion, requires its content-free replacement
   and retained mapping, and verifies exclusion from keyword results. Fresh
   indexing after explicit re-enablement is permitted.
   A separate fresh-profile Flow gate repeats 24 batches of 20 native title/audio
   updates across 200 visible tabs. It requires stable row and control identity,
   scroll, focus, selection, workspace controls, and no structural removals;
   unrelated and off-workspace events must not mutate the visible sidebar.
   It also drives native mute/unmute and records event-to-frame p50/p95/max in
   the Actions log. The sleeping gate pins a tab during its real asynchronous
   SessionStore flush, requires it to remain live, then unpins it and requires
   a subsequent eligible request to discard through Gecko.
   The split gate drives the same Gecko-native pair through stacked and
   side-by-side layouts, requires both panel geometries to change, and verifies
   that the native splitter remains between live browser panels. The
   multi-launch gate seeds a stacked pair and refuses restoration unless its
   orientation returns with the native split identity.
   A tab-status gate then projects picture-in-picture, loading,
   camera/microphone sharing, crash, and audio state from real Gecko tab
   elements, verifies visible and accessible output, clicks Fluxion's media
   control, and refuses publication unless Gecko records mute and the action
   rerenders as Unmute.
   A spatial-drop gate then presents the real Flow split feedback on a native
   tab row, creates and separates side-by-side and stacked Gecko pairs through
   the same drop application path, performs an edge reorder, and rejects the
   build unless native pair order, orientation, and tab order all match the
   pointer intent.
   A pointer-close gate then creates three ordinary native tabs, clicks the
   middle row's real Flow close control, and repeats a click at the exact same
   screen coordinates. Packaging stops unless only that tab closes, the next
   row retains its position while the pointer is stationary, and the inert
   placeholder compresses away after a pointer move.
   A collapsed-group gate then creates a separate three-page native group and
   one following page, collapses the group around its selected member, and
   rejects the build unless Flow retains exactly that active row with an honest
   `+2` hidden count. It drives Arrow Down into the next visible page, requires
   Gecko selection and DOM focus to agree after rerender, and requires the
   inactive group to return to one heading row. This compact gate completes in
   an isolated app launch before the broader fixtures begin changing
   selection or intentionally holding Flow geometry. It then focuses that
   heading, expands it with Right Arrow, collapses it with Left Arrow, and
   requires the heading to remain the only roving Tab stop after each native
   state change. The pointer-close gate waits for this keyboard fixture to
   release Flow before it begins its own intentional geometry hold. Both
   assertions must pass in this separate profile before the complete suite
   starts in another process. The complete suite still renders native groups;
   separating these interactions prevents unrelated synthetic tab selections
   from corrupting their measurements.
   A Focus gate then collapses Flow to its real 3px layout rail, requires its
   translated controls to be inert and keyboard discoverable, reveals the
   232px surface, and compares Gecko's content rectangle before and after. Any
   horizontal shift or resize blocks publication; the gate then restores the
   prior Flow mode so the inspection screenshot represents settled browsing.
   A workspace-resume gate records different active native tabs in Focus and
   Build, switches away and back, and refuses publication unless each workspace
   returns to its own page with exactly one SessionStore ownership marker.
   A workspace-settings gate then drives the real creation form, inline name,
   symbol, accent, and reorder controls, confirms their preference projection,
   assigns a native tab to the new workspace, and deletes it through the shared
   controller. Packaging stops unless the workspace disappears from both UI
   and persistence while the live tab migrates to the adjacent destination.
   A toolbar-menu gate then requires Firefox PanelUI to be absent from the
   visible toolbar, checks the mounted Fluxion control and its full concise
   command set, executes New Tab through the actual menu listener, verifies the
   workspace-aware Gecko tab, and requires Back plus the URL field to retain
   useful geometry for the settled inspection screenshot. The automated capture
   does not force AppKit into modal native-menu tracking.
   A page-tools gate then resolves every Find, Save, Print, Zoom, Full Screen,
   Add-ons command and lazy Gecko Developer Tools controller against the
   packaged browser chrome. It drives Zoom In and Actual Size through the
   actual menuitems and refuses the build unless the live selected browser
   returns to 100 percent.
   A palette-command gate selects an ordinary live page, requires the available
   native page, bookmark, extension, and Developer Tools actions to appear,
   then drives Zoom In and Actual Size through actual keyboard selection. The
   gate leaves a settled query visible for screenshot inspection.
   A closed-tab gate then closes a real web tab, requires the SessionStore row
   to appear in Fluxion's native menu and first in palette ranking, restores it
   by pressing Return, and proves that its persisted workspace identity and
   closed-tab count round-trip exactly.
   A web-search gate switches Gecko to another installed engine, resolves and
   opens the selected palette fallback through that engine, verifies workspace
   placement, restores the original default, and requires the settled palette
   to name the restored engine.
   An appearance gate then enables Gecko's installed Dark theme through the
   same controller used by Settings and palette commands, opens the real
   Appearance section, and requires its selection plus the computed browser-
   chrome color scheme to update before capture. Its geometry assertion also
   requires the Settings rail and content to begin after Flow. The Library gate
   applies the same non-overlap assertion to its own navigation and records.
   A browsing-data gate then opens Fluxion's direct command surface through the
   same privileged controller used by Settings and refuses publication unless
   Gecko's native sanitizer dialog exposes a time range, at least five data
   categories, and working Cancel/Clear actions in the packaged browser. It
   then activates Gecko's real Cancel button, verifies the cancellation result,
   and captures the settled browser instead of an unreadable modal backdrop.
   A background-work gate defers an extracted page in Fluxion's real indexing
   scheduler, proves it is absent while the queue is paused, then requires the
   same page and its evidence to appear after the scheduler resumes. This blocks
   publication if Browser Memory bypasses its bounded serial queue.
   It then creates a separate Places visit and Memory record, deletes that URL
   through Gecko history, and requires its extracted evidence to disappear
   while the unrelated indexed page remains available.
   The Memory palette gate changes a query after real results arrive and presses
   Return both during debounce and during the next asynchronous search. No
   previous result may open, and the current search must still complete before
   the grounding fixture continues.
   An embedding-settings gate then drives the live Search & Memory selector to
   Keywords only, requires Gecko's ML and semantic-history gates to turn off,
   retrieves the extracted page through lexical evidence, and restores Gecko's
   local semantic mode. After the scale gate cleans up its 200 tabs, the app
   settles on Search & Memory and packaging waits for the embedding row to
   remain visible for inspection.
   A separate four-launch gate then seeds two normal windows and cleanly quits
   the process. It restores each window's distinct SessionStore-owned workspace
   and active page plus shared workspace names/order/symbols/accents,
   pin/group/split state, and keyword-only Browser Memory choice. The gate
   switches workspaces in the primary window while requiring the companion to
   remain in Life, opens and closes a real private window inside the restored
   app, cleanly quits, and restores both normal windows again without enabling
   ML. Fluxion's startup configuration must preserve Gecko's restore-previous-
   session preference through every one of those launches.
   The seed opens the enriched Browser Memory SQLite store, so each clean quit
   also proves its profile-before-change shutdown blocker awaited connection
   closure instead of relying on process termination.
   Publication is blocked if the windows merge, either active workspace falls
   back to the profile-wide default, any workspace metadata changes, or the
   private URL appears in restored tabs, Gecko Places, or Browser Memory.
   Four more launches exercise saved homepage/blank startup choices and the
   bookmarks toolbar. Finally, a separate profile seeds the native two-window
   layout with a private window still open, observes a periodic disk checkpoint,
   and is terminated by SIGKILL. Its relaunch must report actual crash recovery
   with blank startup and resume-once disabled, restore the native layout and
   workspace choices, and exclude private evidence. No clean-session file may
   be present at the crash boundary.
2. Inspect the checks and screenshot. Fix the source instead of editing an
   already-built artifact.
3. Run the same commit and version with `publish=true`. Only that verified pass
   creates the Git tag and GitHub prerelease.
4. Stream the published DMG back from GitHub and compare its SHA-256 with the
   attached checksum.

DMG creation writes each attempt to a private filename and promotes only a
completed image. The packager retries bounded `hdiutil` resource-contention
failures because Finder and recently terminated Gecko helpers can briefly hold
the source bundle on hosted macOS runners; it never force-detaches a volume or
reuses a partial image.

Preview releases are ad-hoc signed and not notarized. A stable release requires
an Apple Developer ID, notarization, stapling, and an update channel owned by
Fluxion. The bundled upstream updater stays disabled because it would replace
Fluxion's signed product layer with a stock Firefox application; milestone
releases instead refresh Gecko from Mozilla's current universal build.
