# Native updater bridge

`FluxionUpdaterBridge.m` is a main-thread C ABI over the pinned Sparkle 2.10.0
framework. Privileged Gecko chrome loads it with js-ctypes and keeps the library
open for the process lifetime. It does not replace Gecko's application delegate,
execute shell commands, or expose its ABI to web content.

An explicit `install` command binds consent to a release and channel. The native
driver authenticates the feed, requires the exact approved display version and
its corresponding Apple bundle version, downloads the signed application, and
asks Sparkle to install. Sparkle sends a normal Apple quit event; Gecko retains
its ordinary unsaved-page confirmation and profile shutdown. A cancelled quit
leaves a version-bound `retry` action rather than forcing termination.

Sparkle relaunches the application bundle without arbitrary profile arguments.
The bridge consequently accepts only the canonical default Fluxion profile,
one running Fluxion application process, and an application outside `/Volumes`.
Unsupported profiles can continue using the separate manual DMG update route.

## Building and policy tests

Use the repository's pinned, checksum-verified Sparkle framework. Compile on
macOS with ARC, blocks, the macOS 12 deployment target, AppKit and Sparkle.
`libFluxionUpdater.dylib` lives alongside `Sparkle.framework` in
`Fluxion.app/Contents/Frameworks`; its runpath must include `@loader_path`.
Sign nested Sparkle executables/XPC services and the bridge before the app.

For the independent native policy executable, compile `BridgePolicyTests.m`
instead of compiling the bridge a second time: the test imports its implementation
so it can exercise private validation without exposing a production test ABI.
Example, with `$sparkle_dir` containing the verified `Sparkle.framework`:

```sh
xcrun clang -fobjc-arc -fblocks -mmacosx-version-min=12.0 \
  -Wall -Wextra -Wno-unused-parameter \
  -F "$sparkle_dir" -framework AppKit -framework Sparkle \
  -Wl,-rpath,"$sparkle_dir" BridgePolicyTests.m -o BridgePolicyTests
./BridgePolicyTests
```

These tests perform no network request and never instantiate an updater. They
exercise consent parsing, immutable origins, signed-feed status, exact release
binding, native Sparkle prerelease ordering, cancellation and retry callbacks.
Actual archive authentication, cancellation of Gecko quit, replacement and
same-profile relaunch require the separate native end-to-end gate.

## Isolated end-to-end fixture

Only that gate compiles with `FLUXION_UPDATER_TESTING=1` and
`FLUXION_UPDATER_TEST_PUBLIC_KEY` set to a quoted ephemeral public key. This
compile-time variant uses a fixed loopback feed at
`http://127.0.0.1:38473/feed/appcast.xml` and archive paths below
`http://127.0.0.1:38473/releases/`. The matching fixture Info.plist is required;
all signing, consent, profile, version and quit checks remain enabled.

The production binary has neither loopback constants nor any runtime trust-root
override. Do not distribute or promote the separately re-signed fixture app.
Never pass private key material as a compiler flag.

## Source-backed boundaries

- [Sparkle's custom user-driver API](https://sparkle-project.org/documentation/api-reference/Protocols/SPUUserDriver.html)
  provides progress, cancellation and retry callbacks.
- [Sparkle 2.10.0 installer progress source](https://github.com/sparkle-project/Sparkle/blob/2.10.0/Sparkle/InstallerProgress/InstallerProgressAppController.m)
  sends `NSRunningApplication.terminate` and waits for actual termination before
  replacement; relaunch uses the application URL.
- [The pinned update validator](https://github.com/sparkle-project/Sparkle/blob/2.10.0/Sparkle/SUUpdateValidator.m)
  verifies the archive and new application's signature. Ed25519-authenticated
  ad-hoc preview builds are not Apple-notarized builds.
- `SUSignedFeedFailureExpirationInterval=0`, authenticated item status and
  `SUVerifyUpdateBeforeExtraction` are independently required. This bridge does
  not allow unsigned-feed recovery or key rotation through untrusted metadata.
