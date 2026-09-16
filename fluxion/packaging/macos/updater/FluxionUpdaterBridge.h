#ifndef FLUXION_UPDATER_BRIDGE_H
#define FLUXION_UPDATER_BRIDGE_H

#ifdef __cplusplus
extern "C" {
#endif

// Main-thread-only, process-wide ABI for privileged Gecko chrome/js-ctypes.
// Never unload the library while the application is alive: Sparkle owns async blocks.
// Return 0 on accepted operation, 1 for unsafe/unavailable host, 2 for invalid
// input, 3 for an action unavailable in the current state, 4 off the main thread.
__attribute__((visibility("default"))) int FluxionUpdaterStart(const char *profilePath);
// {"action":"install","version":"0.70.1-preview.1","channel":"preview","consent":true}
// Stable updates use channel="stable". Other actions: cancel, dismiss, retry.
// Retry must repeat version/channel/consent. No URL or public key is accepted.
__attribute__((visibility("default"))) int FluxionUpdaterCommand(const char *json);
// Owns a fresh UTF-8 JSON allocation; release with FluxionUpdaterFree, not ctypes.free.
__attribute__((visibility("default"))) char *FluxionUpdaterCopyState(void);
__attribute__((visibility("default"))) void FluxionUpdaterFree(char *value);

#ifdef __cplusplus
}
#endif
#endif
