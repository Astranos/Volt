import AVFoundation
import React

@objc(VoltClipBarcodeScanner)
class VoltClipBarcodeScanner: RCTEventEmitter {
  private var hasListeners = false

  override static func requiresMainQueueSetup() -> Bool {
    false
  }

  override func supportedEvents() -> [String]! {
    ["candidate", "error"]
  }

  override func startObserving() {
    hasListeners = true
  }

  override func stopObserving() {
    hasListeners = false
  }

  @objc(start:resolver:rejecter:)
  func start(options: NSDictionary?, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    let fullFrame = options?["fullFrame"] as? Bool ?? false
    AVCaptureDevice.requestAccess(for: .video) { granted in
      if !granted {
        reject("camera_denied", "Camera permission is required to scan barcodes.", nil)
        return
      }

      VoltClipTextRecognizer.shared.startBarcodeScanning(
        onCandidate: { [weak self] value, format in
          guard let self, self.hasListeners else { return }
          self.sendEvent(
            withName: "candidate",
            body: [
              "value": value,
              "format": format,
            ]
          )
        },
        fullFrame: fullFrame,
        resolve: resolve,
        rejecter: reject
      )
    }
  }

  @objc(stop:rejecter:)
  func stop(resolve: @escaping RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    VoltClipTextRecognizer.shared.stopBarcodeScanning(resolve: resolve)
  }
}
