#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(VoltClipTextRecognizer, NSObject)

RCT_EXTERN_METHOD(captureAndRecognize:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(showPreview:(nonnull NSNumber *)x
                  y:(nonnull NSNumber *)y
                  width:(nonnull NSNumber *)width
                  height:(nonnull NSNumber *)height)

RCT_EXTERN_METHOD(hidePreview)

RCT_EXTERN_METHOD(setTorch:(BOOL)enabled
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(setZoom:(nonnull NSNumber *)factor
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(focusAt:(nonnull NSNumber *)x
                  y:(nonnull NSNumber *)y
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(playSelectionHaptic)

@end
