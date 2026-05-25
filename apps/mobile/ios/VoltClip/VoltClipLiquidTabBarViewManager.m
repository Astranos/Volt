#import <React/RCTViewManager.h>
#import <UIKit/UIKit.h>

@interface VoltClipLiquidTabBarViewManager : RCTViewManager
@end

@interface VoltClipLiquidGlassViewManager : RCTViewManager
@end

__attribute__((constructor)) static void VoltClipRegisterLiquidTabBarLegacyInterop(void)
{
  Class interopClass = NSClassFromString(@"RCTLegacyViewManagerInteropComponentView");
  SEL supportSelector = NSSelectorFromString(@"supportLegacyViewManagerWithName:");
  if (interopClass != Nil && [interopClass respondsToSelector:supportSelector]) {
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Warc-performSelector-leaks"
    [interopClass performSelector:supportSelector withObject:@"VoltClipLiquidTabBarView"];
    [interopClass performSelector:supportSelector withObject:@"VoltClipLiquidGlassView"];
#pragma clang diagnostic pop
  }
}

@implementation VoltClipLiquidTabBarViewManager

RCT_EXPORT_MODULE(VoltClipLiquidTabBarView)
RCT_EXPORT_VIEW_PROPERTY(selectedMode, NSString)
RCT_EXPORT_VIEW_PROPERTY(onModeChange, RCTDirectEventBlock)

+ (BOOL)requiresMainQueueSetup
{
  return YES;
}

- (UIView *)view
{
  Class viewClass = NSClassFromString(@"VoltClipLiquidTabBarView");
  if (viewClass == Nil) {
    UIView *fallbackView = [UIView new];
    fallbackView.backgroundColor = [UIColor colorWithWhite:1 alpha:0.14];
    return fallbackView;
  }

  return [viewClass new];
}

@end

@implementation VoltClipLiquidGlassViewManager

RCT_EXPORT_MODULE(VoltClipLiquidGlassView)
RCT_EXPORT_VIEW_PROPERTY(progress, NSNumber)
RCT_EXPORT_VIEW_PROPERTY(cornerRadius, NSNumber)
RCT_EXPORT_VIEW_PROPERTY(tone, NSString)

+ (BOOL)requiresMainQueueSetup
{
  return YES;
}

- (UIView *)view
{
  Class viewClass = NSClassFromString(@"VoltClipLiquidGlassView");
  if (viewClass == Nil) {
    UIView *fallbackView = [UIView new];
    fallbackView.backgroundColor = [UIColor colorWithWhite:0 alpha:0.56];
    fallbackView.userInteractionEnabled = NO;
    return fallbackView;
  }

  return [viewClass new];
}

@end
