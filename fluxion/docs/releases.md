# Milestone release process

macOS milestone builds use `.github/workflows/macos-preview-release.yml` in two
passes:

1. Run with `publish=false`. GitHub builds and ad-hoc signs the universal app,
   launches Gecko with an isolated profile, requires Flow, command palette,
   live Fluxion Settings, Browser Memory service, native tab-group, native split-view,
   and AI-provider health markers, validates application branding, packages the
   DMG, and preserves a chrome-inspection screenshot when the runner permits it.
   The hosted runner also opens either Gecko's semantic vector connection or
   its intentional low-spec lexical fallback. A loopback-only Ollama-compatible
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
   `about:preferences#about` product surface instead of an inherited Firefox
   route or exposed bundle file path.
   The interaction gate also creates three related ungrouped pages and requires
   the local **Suggest tab group** command, proposed name, and confirmation-only
   execution path to be available in the packaged command palette.
   A scale/accessibility gate then opens 200 temporary native tabs, bounds the
   Flow render, requires a single roving tab stop, drives ArrowDown, verifies
   selected-tab and DOM focus identity after rerender, and removes the fixture
   before capture.
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
   A Focus gate then collapses Flow to its real 3px layout rail, requires its
   translated controls to be inert and keyboard discoverable, reveals the
   232px surface, and compares Gecko's content rectangle before and after. Any
   horizontal shift or resize blocks publication; the gate then restores the
   prior Flow mode so the inspection screenshot represents settled browsing.
   A workspace-resume gate records different active native tabs in Focus and
   Build, switches away and back, and refuses publication unless each workspace
   returns to its own page with exactly one SessionStore ownership marker.
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
   A separate four-launch gate then seeds and cleanly quits a normal session,
   restores its per-workspace active pages plus workspace/pin/group/split state,
   switches between both remembered pages, opens and quits a private session,
   and restores normal mode again. Publication is blocked if the private URL
   appears in restored tabs, Gecko Places, or Browser Memory.
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
