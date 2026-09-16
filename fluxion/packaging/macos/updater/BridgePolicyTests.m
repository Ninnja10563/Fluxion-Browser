// Native standalone policy tests. Link the pinned Sparkle framework; no updater
// is started, no network is used, and no application/profile is modified.
#import "FluxionUpdaterBridge.m"
#include <assert.h>
#include <stdio.h>

@interface TestHost : NSObject
@property(nonatomic, strong) NSDictionary *infoDictionary;
@end
@implementation TestHost
@end

@interface TestItem : NSObject
@property(nonatomic, copy) NSString *versionString;
@property(nonatomic, copy) NSString *displayVersionString;
@property(nonatomic, copy) NSString *channel;
@property(nonatomic, copy) NSString *installationType;
@property(nonatomic, strong) NSURL *fileURL;
@property(nonatomic) SPUAppcastSigningValidationStatus signingValidationStatus;
@property(nonatomic) BOOL isInformationOnlyUpdate;
@property(nonatomic) BOOL isDeltaUpdate;
@end
@implementation TestItem
@end

@interface TestBridge : FluxionUpdaterBridge
@property(nonatomic) BOOL contextSafe;
@end
@implementation TestBridge
- (BOOL)safeHost { return self.contextSafe; }
@end

int main(void) {
  @autoreleasepool {
    assert(ValidRelease(@"0.70.1-preview.1", @"preview"));
    assert(ValidRelease(@"0.70.1-preview.255", @"preview"));
    assert(!ValidRelease(@"0.70.1-preview.256", @"preview"));
    assert(!ValidRelease(@"0.70.1-preview.1", @"stable"));
    assert(!ValidRelease(@"0.70.1\n", @"stable"));
    assert(!ValidRelease(@"0.70.1", (id)@1));
    assert([NativeVersion(@"0.70.1-preview.2", @"preview") isEqualToString:@"0.70.1b2"]);
    assert([NativeVersion(@"0.70.1", @"stable") isEqualToString:@"0.70.1"]);
    assert(BoundedString("ok", 3) != nil && BoundedString("toolong", 3) == nil);

    SUStandardVersionComparator *compare = SUStandardVersionComparator.defaultComparator;
    assert([compare compareVersion:@"0.70.1b1" toVersion:@"0.70.1b2"] == NSOrderedAscending);
    assert([compare compareVersion:@"0.70.1b2" toVersion:@"0.70.1"] == NSOrderedAscending);
    assert([compare compareVersion:@"0.70.1" toVersion:@"0.70.1b2"] == NSOrderedDescending);

    TestBridge *subject = [[TestBridge alloc] init]; subject.contextSafe = YES; subject.available = YES;
    TestHost *host = [[TestHost alloc] init]; host.infoDictionary = @{ @"CFBundleVersion": @"0.70.1b1" };
    subject.host = (NSBundle *)host; subject.expectedVersion = @"0.70.1-preview.2"; subject.channel = @"preview"; subject.consent = YES;
    TestItem *item = [[TestItem alloc] init];
    item.versionString = @"0.70.1b2"; item.displayVersionString = subject.expectedVersion;
    item.channel = @"preview"; item.installationType = @"application";
    item.signingValidationStatus = SPUAppcastSigningValidationStatusSucceeded;
    item.fileURL = [NSURL URLWithString:@"https://github.com/Ninnja10563/Fluxion-Browser/releases/download/v0.70.1-preview.2/Fluxion.zip"];
    // The pure policy callback never messages its updater parameter. Supply a
    // nonnull inert token without constructing an actual updater/network cycle.
    SPUUpdater *updaterToken = (SPUUpdater *)[[NSObject alloc] init];
    BOOL (^accepts)(void) = ^{
      return [subject updater:updaterToken shouldProceedWithUpdate:(SUAppcastItem *)item updateCheck:SPUUpdateCheckUpdates error:NULL];
    };
    assert(accepts());
    item.signingValidationStatus = SPUAppcastSigningValidationStatusFailed; assert(!accepts());
    item.signingValidationStatus = SPUAppcastSigningValidationStatusSkipped; assert(!accepts());
    item.signingValidationStatus = SPUAppcastSigningValidationStatusSucceeded;
    item.displayVersionString = @"0.70.1-preview.3"; assert(!accepts()); item.displayVersionString = subject.expectedVersion;
    item.versionString = @"0.70.1b1"; assert(!accepts()); item.versionString = @"0.70.1b2";
    item.versionString = @"0.70.1b3"; assert(!accepts()); item.versionString = @"0.70.1b2";
    item.channel = @"stable"; assert(!accepts()); item.channel = @"preview";
    item.installationType = @"package"; assert(!accepts()); item.installationType = @"application";
    item.isDeltaUpdate = YES; assert(!accepts()); item.isDeltaUpdate = NO;
    item.isInformationOnlyUpdate = YES; assert(!accepts()); item.isInformationOnlyUpdate = NO;
    NSURL *goodURL = item.fileURL;
    for (NSString *bad in @[@"http://github.com/Ninnja10563/Fluxion-Browser/releases/download/v1/Fluxion.zip",
      @"https://github.com/Other/Fluxion-Browser/releases/download/v1/Fluxion.zip",
      @"https://github.com:443/Ninnja10563/Fluxion-Browser/releases/download/v1/Fluxion.zip",
      @"https://user@github.com/Ninnja10563/Fluxion-Browser/releases/download/v1/Fluxion.zip"]) {
      item.fileURL = [NSURL URLWithString:bad]; assert(!accepts());
    }
    item.fileURL = goodURL;
    subject.contextSafe = NO; assert(!accepts()); subject.contextSafe = YES;
    subject.consent = NO; assert(!accepts()); subject.consent = YES;

    assert(([subject command:@{ @"action": @"install", @"version": subject.expectedVersion, @"channel": @"preview", @"consent": @1 }] == 2));
    assert(([subject command:@{ @"action": @"install", @"version": subject.expectedVersion, @"channel": @"preview", @"consent": @YES, @"url": @"https://evil.invalid" }] == 2));
    __block NSUInteger retries = 0;
    subject.retryBlock = ^{ retries++; };
    assert(([subject command:@{ @"action": @"retry", @"version": @"0.70.1-preview.3", @"channel": @"preview", @"consent": @YES }] == 3));
    assert(([subject command:@{ @"action": @"retry", @"version": subject.expectedVersion, @"channel": @"preview", @"consent": @YES }] == 0 && retries == 1));
    __block NSUInteger cancellations = 0;
    subject.cancelBlock = ^{ cancellations++; };
    assert([subject command:@{ @"action": @"cancel" }] == 0 && cancellations == 1 && !subject.consent);
    assert([subject command:@{ @"action": @"cancel" }] == 3);
    __block SPUUserUpdateChoice choice = SPUUserUpdateChoiceDismiss;
    [subject showReadyToInstallAndRelaunch:^(SPUUserUpdateChoice value) { choice = value; }];
    assert(choice == SPUUserUpdateChoiceSkip);
    subject.consent = YES;
    [subject showReadyToInstallAndRelaunch:^(SPUUserUpdateChoice value) { choice = value; }];
    assert(choice == SPUUserUpdateChoiceInstall);
    char *snapshot = FluxionUpdaterCopyState(); assert(snapshot != NULL);
    assert(strstr(snapshot, "not-started") != NULL); FluxionUpdaterFree(snapshot);
    puts("Fluxion native updater policy and Sparkle version comparison tests passed.");
  }
  return 0;
}
