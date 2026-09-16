# Build and runtime dependencies

The 0.70.1 updater integration remains unpublished. Its native build,
authenticated isolated-version installation, observer-canceled quit/retry and
same-profile relaunch passed; the final complete release run is still required.
See [the milestone](milestone-0.70.1.md) for exact evidence and limitations.

| Component | Purpose and boundary |
| --- | --- |
| Firefox/Gecko | Pinned in `runtime/gecko-lock.json`; supplies web rendering, JavaScript, isolation, networking and native browser services. No Chromium foundation is used. Mozilla and bundled third-party licenses are retained. |
| Sparkle 2.10.0 | Pinned in `runtime/sparkle-lock.json`; supplies native macOS update authentication, extraction, installation and relaunch. Requires macOS 12+. Its [full upstream license](../third_party/sparkle/LICENSE) includes its external dependencies. |
| Apple Command Line Tools | Build the native launcher/updater bridge; provide compiler, SDK and signing/packaging tools. Xcode's full IDE is not required for the existing command-line build route. |
| Python 3 | Build-time guarded Gecko-resource/policy patching and archive processing; not required by the installed app. |
| Node.js 20+ | Development tests, release metadata tooling and locked-runtime download helpers; not required by the installed app. |

The Sparkle release archive has an exact URL, size and SHA-256 lock. Packaging
must verify it before using the framework. The framework and Fluxion's
Objective-C bridge live in `Contents/Frameworks`; nested executable components
must be signed before signing the outer application. This does not make an
ad-hoc build Apple-notarized.

The updater's Ed25519 public key is embedded in the lock/application. The
maintainer's private signing key is not a source dependency: never commit it,
print it in logs, embed it in the app or upload it as a release artifact.
Ed25519 update authentication and Apple's Developer ID/notarization are
different trust boundaries; one does not substitute for the other.

No updater server is exposed to webpages. Only privileged browser chrome loads
the native bridge. Browser Memory's optional local model/runtime behavior is
documented separately in [architecture](architecture.md); ordinary browsing and
application updates do not require an AI provider.
