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
   `about:fluxion` page instead of an inherited Firefox route or exposed bundle
   file path.
2. Inspect the checks and screenshot. Fix the source instead of editing an
   already-built artifact.
3. Run the same commit and version with `publish=true`. Only that verified pass
   creates the Git tag and GitHub prerelease.
4. Stream the published DMG back from GitHub and compare its SHA-256 with the
   attached checksum.

Preview releases are ad-hoc signed and not notarized. A stable release requires
an Apple Developer ID, notarization, stapling, and an update channel owned by
Fluxion. The bundled upstream updater stays disabled because it would replace
Fluxion's signed product layer with a stock Firefox application; milestone
releases instead refresh Gecko from Mozilla's current universal build.
