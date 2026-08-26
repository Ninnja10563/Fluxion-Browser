# Milestone release process

macOS milestone builds use `.github/workflows/macos-preview-release.yml` in two
passes:

1. Run with `publish=false`. GitHub builds and ad-hoc signs the universal app,
   launches Gecko with an isolated profile, requires both the Flow and command
   palette health markers, validates application branding, packages the DMG,
   and preserves a chrome-inspection screenshot when the runner permits it.
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
