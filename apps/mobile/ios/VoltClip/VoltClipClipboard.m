#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(VoltClipClipboard, NSObject)

RCT_EXTERN_METHOD(getString:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(getChangeCount:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
