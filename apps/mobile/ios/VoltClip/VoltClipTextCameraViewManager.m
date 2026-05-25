#import <React/RCTViewManager.h>
#import <UIKit/UIKit.h>

@interface VoltClipTextCameraViewManager : RCTViewManager
@end

__attribute__((constructor)) static void VoltClipRegisterTextCameraLegacyInterop(void)
{
  Class interopClass = NSClassFromString(@"RCTLegacyViewManagerInteropComponentView");
  SEL supportSelector = NSSelectorFromString(@"supportLegacyViewManagerWithName:");
  if (interopClass != Nil && [interopClass respondsToSelector:supportSelector]) {
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Warc-performSelector-leaks"
    [interopClass performSelector:supportSelector withObject:@"VoltClipTextCameraView"];
#pragma clang diagnostic pop
  }
}

@implementation VoltClipTextCameraViewManager

RCT_EXPORT_MODULE(VoltClipTextCameraView)
RCT_EXPORT_VIEW_PROPERTY(onPreviewState, RCTDirectEventBlock)

+ (BOOL)requiresMainQueueSetup
{
  return YES;
}

- (UIView *)view
{
  Class viewClass = NSClassFromString(@"VoltClipTextCameraView");
  if (viewClass == Nil) {
    UIView *fallbackView = [UIView new];
    fallbackView.backgroundColor = [UIColor systemRedColor];
    return fallbackView;
  }

  return [viewClass new];
}

@end
