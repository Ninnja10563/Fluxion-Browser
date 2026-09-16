#import "FluxionUpdaterBridge.h"
#import <AppKit/AppKit.h>
#import <Sparkle/Sparkle.h>
#include <limits.h>
#include <math.h>
#include <stdlib.h>
#include <string.h>

#ifdef FLUXION_UPDATER_TESTING
// Only a separately compiled, re-signed CI fixture may use loopback transport.
// No environment variable, preference, command, or page can change trust roots.
#ifndef FLUXION_UPDATER_TEST_PUBLIC_KEY
#error The isolated updater fixture requires an ephemeral public signing key.
#endif
static NSString *const FluxionFeed = @"http://127.0.0.1:38473/feed/appcast.xml";
static NSString *const FluxionPublicKey = @FLUXION_UPDATER_TEST_PUBLIC_KEY;
#else
static NSString *const FluxionFeed = @"https://raw.githubusercontent.com/Ninnja10563/Fluxion-Browser/update-channel/appcast.xml";
static NSString *const FluxionPublicKey = @"gG973RaE3suerMDAStvYEOGYnRlalJZRy3o9nA6m9Fg=";
#endif
static NSString *const FluxionBundleID = @"app.fluxion.browser";

static BOOL AllowedArchiveURL(NSURL *url) {
  if (!url || url.user || url.password || url.fragment || url.query) return NO;
#ifdef FLUXION_UPDATER_TESTING
  return [url.scheme isEqualToString:@"http"] && [url.host isEqualToString:@"127.0.0.1"] &&
    [url.port isEqual:@38473] && [url.path hasPrefix:@"/releases/"];
#else
  return [url.scheme isEqualToString:@"https"] && [url.host isEqualToString:@"github.com"] && !url.port &&
    [url.path hasPrefix:@"/Ninnja10563/Fluxion-Browser/releases/download/"];
#endif
}

static NSString *BoundedString(const char *value, size_t limit) {
  if (value == NULL || strnlen(value, limit) >= limit) return nil;
  return [[NSString alloc] initWithUTF8String:value];
}

static NSString *CanonicalPath(NSString *path) {
  if (![path isKindOfClass:NSString.class] || !path.isAbsolutePath) return nil;
  char resolved[PATH_MAX];
  return realpath(path.fileSystemRepresentation, resolved) ? [[NSString alloc] initWithUTF8String:resolved] : nil;
}

static BOOL ValidRelease(NSString *version, NSString *channel) {
  if (![version isKindOfClass:NSString.class] || ![channel isKindOfClass:NSString.class] || version.length > 64) return NO;
  NSString *pattern = [channel isEqualToString:@"preview"] ?
    @"\\A[0-9]{1,5}\\.[0-9]{1,5}\\.[0-9]{1,5}-preview\\.[1-9][0-9]{0,2}\\z" :
    [channel isEqualToString:@"stable"] ? @"\\A[0-9]{1,5}\\.[0-9]{1,5}\\.[0-9]{1,5}\\z" : nil;
  if (!pattern || [version rangeOfString:pattern options:NSRegularExpressionSearch].location == NSNotFound) return NO;
  return ![channel isEqualToString:@"preview"] || version.pathExtension.integerValue <= 255;
}

static NSString *NativeVersion(NSString *version, NSString *channel) {
  if (!ValidRelease(version, channel)) return nil;
  return [version stringByReplacingOccurrencesOfString:@"-preview." withString:@"b"];
}

@interface FluxionUpdaterBridge : NSObject <SPUUserDriver, SPUUpdaterDelegate>
@property(nonatomic, strong) SPUUpdater *updater;
@property(nonatomic, strong) NSBundle *host;
@property(nonatomic, copy) NSString *profile;
@property(nonatomic, copy) NSString *expectedVersion;
@property(nonatomic, copy) NSString *channel;
@property(nonatomic, copy) NSString *state;
@property(nonatomic, copy) NSString *message;
@property(nonatomic, copy) NSString *errorCode;
@property(nonatomic, copy) void (^cancelBlock)(void);
@property(nonatomic, copy) void (^retryBlock)(void);
@property(nonatomic) BOOL consent;
@property(nonatomic) BOOL available;
@property(nonatomic) BOOL cycleActive;
@property(nonatomic) uint64_t received;
@property(nonatomic) uint64_t total;
@property(nonatomic) double extraction;
@property(nonatomic) uint64_t revision;
- (BOOL)start:(NSString *)profile;
- (int)command:(NSDictionary *)command;
- (NSDictionary *)snapshot;
@end

@implementation FluxionUpdaterBridge

- (instancetype)init {
  self = [super init];
  if (self) { _state = @"unavailable"; _message = @"Updater has not been initialized."; _errorCode = @"not-started"; }
  return self;
}

- (void)transition:(NSString *)state message:(NSString *)message {
  self.state = state;
  self.message = message ?: @"";
  self.revision++;
}

- (void)fail:(NSString *)code message:(NSString *)message {
  self.errorCode = code;
  self.consent = NO;
  [self transition:@"error" message:message];
}

- (BOOL)safeHost {
  NSString *home = CanonicalPath(NSHomeDirectory());
  NSString *expected = [home stringByAppendingPathComponent:@"Library/Application Support/Fluxion/Profiles/default"];
  NSString *canonical = CanonicalPath(expected);
  // Sparkle relaunches the application bundle, not arbitrary command-line
  // arguments. Refuse custom/symlinked profiles rather than silently switch.
  if (!canonical || ![canonical isEqualToString:expected] || ![self.profile isEqualToString:canonical]) return NO;
  NSArray<NSString *> *args = NSProcessInfo.processInfo.arguments;
  NSUInteger profileCount = 0;
  for (NSUInteger index = 0; index < args.count; index++) {
    if ([args[index] isEqualToString:@"--profile"] || [args[index] isEqualToString:@"-profile"]) {
      if (index + 1 >= args.count || ![args[index + 1] isEqualToString:canonical]) return NO;
      profileCount++;
    }
  }
  if (profileCount != 1 || ![self.host.bundleIdentifier isEqualToString:FluxionBundleID]) return NO;
  NSString *bundlePath = CanonicalPath(self.host.bundlePath);
  if (![bundlePath.pathExtension isEqualToString:@"app"] || [bundlePath hasPrefix:@"/Volumes/"]) return NO;
  NSArray<NSRunningApplication *> *instances = [NSRunningApplication runningApplicationsWithBundleIdentifier:FluxionBundleID];
  if (instances.count != 1 || instances.firstObject.processIdentifier != NSProcessInfo.processInfo.processIdentifier) return NO;
  return [CanonicalPath(instances.firstObject.bundleURL.path) isEqualToString:bundlePath];
}

- (BOOL)start:(NSString *)profile {
  if (self.updater) return self.available && [self.profile isEqualToString:profile];
  self.host = NSBundle.mainBundle;
  self.profile = profile;
  if (![self safeHost]) {
    [self fail:@"unsupported-host" message:@"Install Fluxion outside the disk image and use its default profile with no other Fluxion process running."];
    return NO;
  }
  NSDictionary *info = self.host.infoDictionary;
  if (![info[@"SUFeedURL"] isEqual:FluxionFeed] || ![info[@"SUPublicEDKey"] isEqual:FluxionPublicKey] ||
      ![info[@"SURequireSignedFeed"] isEqual:@YES] || ![info[@"SUVerifyUpdateBeforeExtraction"] isEqual:@YES] ||
      ![info[@"SUSignedFeedFailureExpirationInterval"] isEqual:@0] ||
      ![info[@"SUEnableAutomaticChecks"] isEqual:@NO] || ![info[@"SUAutomaticallyUpdate"] isEqual:@NO]) {
    [self fail:@"unsafe-configuration" message:@"This build is missing Fluxion’s authenticated update configuration."];
    return NO;
  }
  self.updater = [[SPUUpdater alloc] initWithHostBundle:self.host applicationBundle:self.host userDriver:self delegate:self];
  self.updater.automaticallyChecksForUpdates = NO;
  self.updater.automaticallyDownloadsUpdates = NO;
  self.updater.sendsSystemProfile = NO;
  NSError *error = nil;
  if (![self.updater startUpdater:&error]) {
    [self fail:@"startup-failed" message:error.localizedDescription];
    return NO;
  }
  self.available = YES;
  self.errorCode = @"";
  [self transition:@"idle" message:@"Ready for an explicit update request."];
  return YES;
}

- (BOOL)validConsent:(NSDictionary *)command {
  id consent = command[@"consent"];
  return [consent isKindOfClass:NSNumber.class] && CFGetTypeID((__bridge CFTypeRef)consent) == CFBooleanGetTypeID() &&
    [consent boolValue] && ValidRelease(command[@"version"], command[@"channel"]);
}

- (int)command:(NSDictionary *)command {
  NSString *action = command[@"action"];
  if (![action isKindOfClass:NSString.class]) return 2;
  NSSet *allowed = [NSSet setWithArray:@[@"action", @"version", @"channel", @"consent"]];
  for (id key in command) if (![allowed containsObject:key]) return 2;
  if ([action isEqualToString:@"cancel"]) {
    if (!self.cancelBlock) return 3;
    void (^cancel)(void) = self.cancelBlock;
    self.cancelBlock = nil; self.consent = NO;
    [self transition:@"cancelled" message:@"Update cancelled."];
    cancel(); return 0;
  }
  if ([action isEqualToString:@"dismiss"]) {
    if (self.cycleActive) return 3;
    self.errorCode = @"";
    [self transition:self.available ? @"idle" : @"unavailable" message:@""];
    return 0;
  }
  if (![action isEqualToString:@"install"] && ![action isEqualToString:@"retry"]) return 2;
  if (![self validConsent:command]) return 2;
  if (!self.available || ![self safeHost]) {
    [self fail:@"unsupported-host" message:@"Close other Fluxion processes and use the installed app’s default profile before updating."];
    return 1;
  }
  if ([action isEqualToString:@"retry"]) {
    if (!self.retryBlock || ![self.expectedVersion isEqual:command[@"version"]] || ![self.channel isEqual:command[@"channel"]]) return 3;
    self.consent = YES;
    [self transition:@"awaiting-quit" message:@"Finish or cancel Fluxion’s normal quit confirmation to continue."];
    self.retryBlock(); return 0;
  }
  if (self.cycleActive || !self.updater.canCheckForUpdates) return 3;
  self.expectedVersion = command[@"version"]; self.channel = command[@"channel"];
  self.consent = YES; self.cycleActive = YES;
  self.cancelBlock = nil; self.retryBlock = nil;
  self.errorCode = @""; self.received = 0; self.total = 0; self.extraction = 0;
  [self transition:@"checking" message:@"Authenticating the update feed…"];
  [self.updater checkForUpdates];
  return 0;
}

- (NSDictionary *)snapshot {
  return @{ @"schema": @1, @"revision": @(self.revision), @"available": @(self.available),
    @"state": self.state ?: @"unavailable", @"message": self.message ?: @"", @"error": self.errorCode ?: @"",
    @"version": self.expectedVersion ?: @"", @"channel": self.channel ?: @"",
    @"received": @(self.received), @"total": @(self.total), @"extraction": @(self.extraction),
    @"canCancel": @(self.cancelBlock != nil), @"canRetry": @(self.retryBlock != nil), @"busy": @(self.cycleActive),
    @"profilePolicy": @"default-only", @"quitPolicy": @"native-cancellable-apple-event" };
}

- (NSString *)feedURLStringForUpdater:(SPUUpdater *)updater { return FluxionFeed; }
- (NSSet<NSString *> *)allowedChannelsForUpdater:(SPUUpdater *)updater {
  return [self.channel isEqualToString:@"preview"] ? [NSSet setWithObject:@"preview"] : [NSSet set];
}
- (BOOL)updater:(SPUUpdater *)updater shouldDownloadReleaseNotesForUpdate:(SUAppcastItem *)item { return NO; }
- (BOOL)updater:(SPUUpdater *)updater shouldProceedWithUpdate:(SUAppcastItem *)item updateCheck:(SPUUpdateCheck)check error:(NSError **)error {
  NSURL *url = item.fileURL;
  NSString *current = self.host.infoDictionary[@"CFBundleVersion"];
  BOOL channelMatches = [self.channel isEqualToString:@"preview"] ? [item.channel isEqualToString:@"preview"] :
    (item.channel == nil || [item.channel isEqualToString:@"stable"]);
  BOOL valid = [current isKindOfClass:NSString.class] && current.length > 0 && self.consent && [self safeHost] &&
    [item.displayVersionString isEqualToString:self.expectedVersion] &&
    [item.versionString isEqualToString:NativeVersion(self.expectedVersion, self.channel)] &&
    item.signingValidationStatus == SPUAppcastSigningValidationStatusSucceeded && channelMatches &&
    [item.installationType isEqualToString:@"application"] && !item.isInformationOnlyUpdate && !item.isDeltaUpdate &&
    AllowedArchiveURL(url) &&
    [[SUStandardVersionComparator defaultComparator] compareVersion:current toVersion:item.versionString] == NSOrderedAscending;
  if (!valid && error) *error = [NSError errorWithDomain:@"FluxionUpdater" code:1 userInfo:@{
    NSLocalizedDescriptionKey: @"The authenticated update does not match the version and channel you approved." }];
  return valid;
}
- (void)updater:(SPUUpdater *)updater didFinishUpdateCycleForUpdateCheck:(SPUUpdateCheck)check error:(NSError *)error {
  self.cycleActive = NO;
  self.cancelBlock = nil;
  self.consent = NO;
  if (error && ![self.state isEqualToString:@"error"] && ![self.state isEqualToString:@"current"] && ![self.state isEqualToString:@"cancelled"])
    [self fail:@"update-failed" message:error.localizedDescription];
  self.revision++;
}

- (void)showUpdatePermissionRequest:(SPUUpdatePermissionRequest *)request reply:(void (^)(SUUpdatePermissionResponse *))reply {
  reply([[SUUpdatePermissionResponse alloc] initWithAutomaticUpdateChecks:NO automaticUpdateDownloading:@NO sendSystemProfile:NO]);
}
- (void)showUserInitiatedUpdateCheckWithCancellation:(void (^)(void))cancellation {
  self.cancelBlock = cancellation;
  [self transition:@"checking" message:@"Authenticating the update feed…"];
}
- (void)showUpdateFoundWithAppcastItem:(SUAppcastItem *)item state:(SPUUserUpdateState *)state reply:(void (^)(SPUUserUpdateChoice))reply {
  self.cancelBlock = nil;
  NSError *error = nil;
  if (![self updater:self.updater shouldProceedWithUpdate:item updateCheck:SPUUpdateCheckUpdates error:&error]) {
    [self fail:@"update-mismatch" message:error.localizedDescription]; reply(SPUUserUpdateChoiceDismiss); return;
  }
  [self transition:@"downloading" message:@"Downloading the signed update…"];
  reply(SPUUserUpdateChoiceInstall);
}
- (void)showUpdateReleaseNotesWithDownloadData:(SPUDownloadData *)data {}
- (void)showUpdateReleaseNotesFailedToDownloadWithError:(NSError *)error {}
- (void)showUpdateNotFoundWithError:(NSError *)error acknowledgement:(void (^)(void))acknowledgement {
  self.cancelBlock = nil; self.consent = NO;
  [self transition:@"current" message:@"No matching newer update is currently available."];
  acknowledgement();
}
- (void)showUpdaterError:(NSError *)error acknowledgement:(void (^)(void))acknowledgement {
  self.cancelBlock = nil; self.retryBlock = nil;
  [self fail:@"update-failed" message:[error.localizedDescription substringToIndex:MIN(error.localizedDescription.length, 2048)]];
  acknowledgement();
}
- (void)showDownloadInitiatedWithCancellation:(void (^)(void))cancellation {
  self.cancelBlock = cancellation; self.received = 0;
  [self transition:@"downloading" message:@"Downloading the signed update…"];
}
- (void)showDownloadDidReceiveExpectedContentLength:(uint64_t)length { self.total = length; self.revision++; }
- (void)showDownloadDidReceiveDataOfLength:(uint64_t)length {
  self.received = UINT64_MAX - self.received < length ? UINT64_MAX : self.received + length; self.revision++;
}
- (void)showDownloadDidStartExtractingUpdate {
  self.cancelBlock = nil;
  [self transition:@"extracting" message:@"Verifying and preparing the update…"];
}
- (void)showExtractionReceivedProgress:(double)progress {
  if (isfinite(progress)) self.extraction = fmin(1, fmax(0, progress)); self.revision++;
}
- (void)showReadyToInstallAndRelaunch:(void (^)(SPUUserUpdateChoice))reply {
  if (!self.consent || ![self safeHost]) {
    [self fail:@"installation-cancelled" message:@"Installation stopped because its consent or application context changed."];
    reply(SPUUserUpdateChoiceSkip); return;
  }
  [self transition:@"awaiting-quit" message:@"The signed update is ready. Fluxion will ask to quit normally before restarting."];
  // Sparkle sends an ordinary Apple quit event; Gecko keeps its unsaved-page
  // confirmation and shutdown/profile-flush lifecycle. Never force termination.
  reply(SPUUserUpdateChoiceInstall);
}
- (void)showInstallingUpdateWithApplicationTerminated:(BOOL)terminated retryTerminatingApplication:(void (^)(void))retry {
  self.retryBlock = terminated ? nil : retry;
  [self transition:terminated ? @"installing" : @"awaiting-quit"
    message:terminated ? @"Installing the verified update…" : @"Waiting for Fluxion to quit. If you cancelled, you can retry when ready."];
}
- (void)showUpdateInstalledAndRelaunched:(BOOL)relaunched acknowledgement:(void (^)(void))acknowledgement {
  self.retryBlock = nil; self.cycleActive = NO; self.consent = NO;
  [self transition:@"installed" message:relaunched ? @"Update installed and Fluxion restarted." : @"Update installed."];
  acknowledgement();
}
- (void)dismissUpdateInstallation {
  self.cancelBlock = nil; self.retryBlock = nil; self.consent = NO;
  self.revision++;
}
- (void)showUpdateInFocus { self.revision++; }
@end

static FluxionUpdaterBridge *bridge;

int FluxionUpdaterStart(const char *profilePath) {
  if (!NSThread.isMainThread) return 4;
  @autoreleasepool {
    NSString *profile = BoundedString(profilePath, PATH_MAX);
    if (!profile) return 2;
    if (!bridge) bridge = [[FluxionUpdaterBridge alloc] init];
    return [bridge start:profile] ? 0 : 1;
  }
}

int FluxionUpdaterCommand(const char *json) {
  if (!NSThread.isMainThread) return 4;
  @autoreleasepool {
    NSString *input = BoundedString(json, 4096);
    if (!input) return 2;
    id command = [NSJSONSerialization JSONObjectWithData:[input dataUsingEncoding:NSUTF8StringEncoding] options:0 error:NULL];
    if (![command isKindOfClass:NSDictionary.class]) return 2;
    if (!bridge) return 1;
    return [bridge command:command];
  }
}

char *FluxionUpdaterCopyState(void) {
  if (!NSThread.isMainThread) return NULL;
  @autoreleasepool {
    NSDictionary *state = bridge ? [bridge snapshot] : @{ @"schema": @1, @"available": @NO, @"state": @"unavailable", @"error": @"not-started" };
    NSData *data = [NSJSONSerialization dataWithJSONObject:state options:NSJSONWritingSortedKeys error:NULL];
    if (!data || data.length > 65536) return NULL;
    char *result = malloc(data.length + 1);
    if (!result) return NULL;
    memcpy(result, data.bytes, data.length); result[data.length] = '\0';
    return result;
  }
}

void FluxionUpdaterFree(char *value) { free(value); }
