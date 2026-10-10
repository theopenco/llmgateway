#import "LoungeAuth.h"
#import <AuthenticationServices/AuthenticationServices.h>
#import <React/RCTUtils.h>

@interface LoungeAuth () <ASWebAuthenticationPresentationContextProviding>
@property(nonatomic, strong) ASWebAuthenticationSession *session;
@property(nonatomic, strong) UIWindow *window;
@property(nonatomic, copy) RCTPromiseRejectBlock reject;
@property(nonatomic) NSUInteger generation;
@end

@implementation LoungeAuth

+ (NSString *)moduleName { return @"NativeLoungeAuth"; }
+ (BOOL)requiresMainQueueSetup { return YES; }

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
	(const facebook::react::ObjCTurboModule::InitParams &)params {
	return std::make_shared<facebook::react::NativeLoungeAuthSpecJSI>(params);
}

- (void)open:(NSString *)rawURL resolve:(RCTPromiseResolveBlock)resolve
	reject:(RCTPromiseRejectBlock)reject {
	dispatch_async(dispatch_get_main_queue(), ^{
		if (self.session) {
			reject(@"AUTH_BUSY", @"Finish the current sign-in first.", nil);
			return;
		}
		NSURL *url = [NSURL URLWithString:rawURL];
		BOOL local = [url.scheme isEqualToString:@"http"] &&
			([url.host isEqualToString:@"localhost"] || [url.host isEqualToString:@"127.0.0.1"]);
		if (!url.host.length || (![url.scheme isEqualToString:@"https"] && !local)) {
			reject(@"AUTH_URL", @"The sign-in address is invalid.", nil);
			return;
		}
		self.window = RCTKeyWindow();
		if (!self.window) {
			reject(@"AUTH_WINDOW", @"Return to The Lounge and try again.", nil);
			return;
		}
		NSUInteger generation = ++self.generation;
		self.reject = reject;
		__weak LoungeAuth *weakSelf = self;
		self.session = [[ASWebAuthenticationSession alloc]
			initWithURL:url callbackURLScheme:@"io.llmgateway.lounge"
			completionHandler:^(NSURL *callback, NSError *error) {
				dispatch_async(dispatch_get_main_queue(), ^{
					LoungeAuth *strongSelf = weakSelf;
					if (!strongSelf || strongSelf.generation != generation) return;
					strongSelf.session = nil;
					strongSelf.window = nil;
					strongSelf.reject = nil;
					if (error) {
						BOOL cancelled = [error.domain isEqualToString:ASWebAuthenticationSessionErrorDomain] &&
							error.code == ASWebAuthenticationSessionErrorCodeCanceledLogin;
						reject(cancelled ? @"AUTH_CANCELLED" : @"AUTH_FAILED",
							cancelled ? @"Sign-in cancelled." : @"Sign-in could not finish. Try again.", error);
					} else if (callback) {
						resolve(callback.absoluteString);
					} else {
						reject(@"AUTH_FAILED", @"Sign-in did not return a result. Try again.", nil);
					}
				});
			}];
		self.session.presentationContextProvider = self;
		if (![self.session start]) {
			self.generation++;
			self.session = nil;
			self.window = nil;
			self.reject = nil;
			reject(@"AUTH_FAILED", @"The sign-in browser could not open. Try again.", nil);
		}
	});
}

- (ASPresentationAnchor)presentationAnchorForWebAuthenticationSession:
	(ASWebAuthenticationSession *)session {
	return self.window;
}

- (void)cancel {
	dispatch_async(dispatch_get_main_queue(), ^{
		self.generation++;
		[self.session cancel];
		RCTPromiseRejectBlock reject = self.reject;
		self.session = nil;
		self.window = nil;
		self.reject = nil;
		if (reject) reject(@"AUTH_CANCELLED", @"Sign-in cancelled.", nil);
	});
}

- (void)invalidate { [self cancel]; }
@end
