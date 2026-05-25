import AVFoundation
import React

@objc(VoltClipBarcodeScanner)
class VoltClipBarcodeScanner: RCTEventEmitter, AVCaptureMetadataOutputObjectsDelegate {
  private let session = AVCaptureSession()
  private let sessionQueue = DispatchQueue(label: "com.volt.clip.barcode.session")
  private var hasListeners = false
  private var isConfigured = false

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

  @objc(start:rejecter:)
  func start(resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
      guard let self else { return }

      if !granted {
        reject("camera_denied", "Camera permission is required to scan barcodes.", nil)
        return
      }

      self.sessionQueue.async {
        do {
          try self.configureIfNeeded()
          if !self.session.isRunning {
            self.session.startRunning()
          }
          resolve(["running": true])
        } catch {
          reject("scanner_start_failed", error.localizedDescription, error)
        }
      }
    }
  }

  @objc(stop:rejecter:)
  func stop(resolve: @escaping RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    sessionQueue.async {
      if self.session.isRunning {
        self.session.stopRunning()
      }
      resolve(["running": false])
    }
  }

  private func configureIfNeeded() throws {
    if isConfigured {
      return
    }

    guard let device = AVCaptureDevice.default(for: .video) else {
      throw ScannerError.cameraUnavailable
    }

    let input = try AVCaptureDeviceInput(device: device)
    guard session.canAddInput(input) else {
      throw ScannerError.inputUnavailable
    }

    let output = AVCaptureMetadataOutput()
    guard session.canAddOutput(output) else {
      throw ScannerError.outputUnavailable
    }

    session.beginConfiguration()
    session.addInput(input)
    session.addOutput(output)
    output.setMetadataObjectsDelegate(self, queue: DispatchQueue.main)
    output.metadataObjectTypes = supportedMetadataTypes(from: output.availableMetadataObjectTypes)
    session.commitConfiguration()

    isConfigured = true
  }

  private func supportedMetadataTypes(from availableTypes: [AVMetadataObject.ObjectType]) -> [AVMetadataObject.ObjectType] {
    let preferredTypes: [AVMetadataObject.ObjectType] = [
      .qr,
      .ean13,
      .ean8,
      .upce,
      .code128,
      .code39,
      .code93,
      .dataMatrix,
      .pdf417,
      .aztec,
      .interleaved2of5,
      .itf14,
    ]

    return preferredTypes.filter { availableTypes.contains($0) }
  }

  func metadataOutput(
    _ output: AVCaptureMetadataOutput,
    didOutput metadataObjects: [AVMetadataObject],
    from connection: AVCaptureConnection
  ) {
    guard hasListeners else { return }

    for metadataObject in metadataObjects {
      guard
        let readableObject = metadataObject as? AVMetadataMachineReadableCodeObject,
        let value = readableObject.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines),
        !value.isEmpty
      else {
        continue
      }

      sendEvent(
        withName: "candidate",
        body: [
          "value": value,
          "format": metadataName(for: readableObject.type),
        ]
      )
      return
    }
  }

  private func metadataName(for type: AVMetadataObject.ObjectType) -> String {
    switch type {
    case .qr:
      return "qr"
    case .ean13:
      return "ean13"
    case .ean8:
      return "ean8"
    case .upce:
      return "upce"
    case .code128:
      return "code128"
    case .code39:
      return "code39"
    case .code93:
      return "code93"
    case .dataMatrix:
      return "datamatrix"
    case .pdf417:
      return "pdf417"
    case .aztec:
      return "aztec"
    case .interleaved2of5:
      return "itf"
    case .itf14:
      return "itf14"
    default:
      return type.rawValue
    }
  }
}

private enum ScannerError: LocalizedError {
  case cameraUnavailable
  case inputUnavailable
  case outputUnavailable

  var errorDescription: String? {
    switch self {
    case .cameraUnavailable:
      return "No camera is available on this device."
    case .inputUnavailable:
      return "The camera input could not be added."
    case .outputUnavailable:
      return "The barcode output could not be added."
    }
  }
}
