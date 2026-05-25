import React
import UIKit

@objc(VoltClipClipboard)
class VoltClipClipboard: NSObject {
  @objc static func requiresMainQueueSetup() -> Bool {
    true
  }

  @objc(getString:rejecter:)
  func getString(resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    resolve(UIPasteboard.general.string ?? "")
  }

  @objc(getChangeCount:rejecter:)
  func getChangeCount(resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    resolve(UIPasteboard.general.changeCount)
  }
}
