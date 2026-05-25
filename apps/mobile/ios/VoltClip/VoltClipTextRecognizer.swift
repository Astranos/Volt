import AVFoundation
import ImageIO
import React
import UIKit
import Vision

@objc(VoltClipTextRecognizer)
class VoltClipTextRecognizer: NSObject, AVCapturePhotoCaptureDelegate {
  static let shared = VoltClipTextRecognizer()

  let session = AVCaptureSession()
  private let sessionQueue = DispatchQueue(label: "com.volt.clip.text.session")
  private let output = AVCapturePhotoOutput()
  private var videoDevice: AVCaptureDevice?
  private var isConfigured = false
  private var pendingResolve: RCTPromiseResolveBlock?
  private var pendingReject: RCTPromiseRejectBlock?
  private var pendingImageURL: URL?
  private weak var previewOverlayView: VoltClipTextCameraView?
  private var captureTimeoutWorkItem: DispatchWorkItem?
  private let selectionHaptic = UISelectionFeedbackGenerator()

  @objc static func requiresMainQueueSetup() -> Bool {
    false
  }

  @objc(captureAndRecognize:rejecter:)
  func captureAndRecognize(resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    VoltClipTextRecognizer.shared.captureText(resolve: resolve, rejecter: reject)
  }

  @objc(showPreview:y:width:height:)
  func showPreview(x: NSNumber, y: NSNumber, width: NSNumber, height: NSNumber) {
    VoltClipTextRecognizer.shared.showOverlayPreview(
      frame: CGRect(x: CGFloat(truncating: x), y: CGFloat(truncating: y), width: CGFloat(truncating: width), height: CGFloat(truncating: height))
    )
  }

  @objc(hidePreview)
  func hidePreview() {
    VoltClipTextRecognizer.shared.hideOverlayPreview()
  }

  @objc(setTorch:resolver:rejecter:)
  func setTorch(enabled: Bool, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    VoltClipTextRecognizer.shared.setTorch(enabled: enabled, resolve: resolve, rejecter: reject)
  }

  @objc(setZoom:resolver:rejecter:)
  func setZoom(factor: NSNumber, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    VoltClipTextRecognizer.shared.setZoom(factor: CGFloat(truncating: factor), resolve: resolve, rejecter: reject)
  }

  @objc(focusAt:y:resolver:rejecter:)
  func focusAt(x: NSNumber, y: NSNumber, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    VoltClipTextRecognizer.shared.focusAt(
      normalizedPoint: CGPoint(x: CGFloat(truncating: x), y: CGFloat(truncating: y)),
      resolve: resolve,
      rejecter: reject
    )
  }

  @objc(playSelectionHaptic)
  func playSelectionHaptic() {
    DispatchQueue.main.async {
      self.selectionHaptic.selectionChanged()
      self.selectionHaptic.prepare()
    }
  }

  func captureText(resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
      guard let self else { return }

      if !granted {
        reject("camera_denied", "Camera permission is required to capture text.", nil)
        return
      }

      self.sessionQueue.async {
        do {
          try self.configureIfNeeded()
          guard self.pendingResolve == nil && self.pendingReject == nil else {
            reject("ocr_capture_in_progress", "A text capture is already in progress.", nil)
            return
          }

          self.pendingResolve = resolve
          self.pendingReject = reject
          self.scheduleCaptureTimeout()

          if !self.session.isRunning {
            self.session.startRunning()
          }

          let settings = AVCapturePhotoSettings()
          self.output.capturePhoto(with: settings, delegate: self)
        } catch {
          self.clearPendingCapture()
          reject("ocr_capture_failed", error.localizedDescription, error)
        }
      }
    }
  }

  func startPreview(completion: ((AVCaptureSession?) -> Void)? = nil) {
    AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
      guard let self, granted else {
        DispatchQueue.main.async {
          completion?(nil)
        }
        return
      }

      self.sessionQueue.async {
        do {
          try self.configureIfNeeded()
          if !self.session.isRunning {
            self.session.startRunning()
          }
          DispatchQueue.main.async {
            completion?(self.session)
          }
        } catch {
          DispatchQueue.main.async {
            completion?(nil)
          }
        }
      }
    }
  }

  func stopPreview() {
    sessionQueue.async {
      if self.session.isRunning {
        self.session.stopRunning()
      }
    }
  }

  private func showOverlayPreview(frame: CGRect) {
    DispatchQueue.main.async {
      guard frame.width > 1, frame.height > 1 else {
        return
      }

      let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
      let window =
        scenes.flatMap { $0.windows }.first(where: { $0.isKeyWindow })
        ?? scenes.first(where: { $0.activationState == .foregroundActive })?.windows.first
        ?? scenes.flatMap { $0.windows }.first
        ?? UIApplication.shared.windows.first

      guard let window else {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
          self.showOverlayPreview(frame: frame)
        }
        return
      }

      let overlayView = self.previewOverlayView ?? VoltClipTextCameraView(frame: frame)
      overlayView.isUserInteractionEnabled = false
      overlayView.layer.cornerRadius = 0
      overlayView.frame = frame
      if overlayView.superview !== window {
        overlayView.removeFromSuperview()
        window.insertSubview(overlayView, at: 0)
      }
      self.previewOverlayView = overlayView
      overlayView.startPreviewFromHost()
    }
  }

  private func hideOverlayPreview() {
    DispatchQueue.main.async {
      self.previewOverlayView?.removeFromSuperview()
      self.previewOverlayView = nil
    }
  }

  private func configureIfNeeded() throws {
    if isConfigured {
      return
    }

    guard
      let device = AVCaptureDevice.default(.builtInTripleCamera, for: .video, position: .back)
        ?? AVCaptureDevice.default(.builtInDualWideCamera, for: .video, position: .back)
        ?? AVCaptureDevice.default(.builtInDualCamera, for: .video, position: .back)
        ?? AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back)
        ?? AVCaptureDevice.default(for: .video)
    else {
      throw TextRecognizerError.cameraUnavailable
    }

    let input = try AVCaptureDeviceInput(device: device)
    guard session.canAddInput(input) else {
      throw TextRecognizerError.inputUnavailable
    }
    guard session.canAddOutput(output) else {
      throw TextRecognizerError.outputUnavailable
    }

    session.beginConfiguration()
    session.sessionPreset = .photo
    session.addInput(input)
    session.addOutput(output)
    session.commitConfiguration()
    videoDevice = device
    isConfigured = true
  }

  private func setTorch(enabled: Bool, resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    sessionQueue.async {
      do {
        try self.configureIfNeeded()
        guard let device = self.videoDevice, device.hasTorch else {
          reject("ocr_torch_unavailable", "Torch is not available on this device.", nil)
          return
        }

        try device.lockForConfiguration()
        device.torchMode = enabled ? .on : .off
        device.unlockForConfiguration()
        resolve(["enabled": enabled])
      } catch {
        reject("ocr_torch_failed", error.localizedDescription, error)
      }
    }
  }

  private func setZoom(factor: CGFloat, resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    sessionQueue.async {
      do {
        try self.configureIfNeeded()
        guard let device = self.videoDevice else {
          reject("ocr_zoom_unavailable", "Camera zoom is not available.", nil)
          return
        }

        let minZoom = max(device.minAvailableVideoZoomFactor, 0.5)
        let maxZoom = min(device.activeFormat.videoMaxZoomFactor, device.maxAvailableVideoZoomFactor, 4)
        let clampedZoom = max(minZoom, min(factor, maxZoom))
        try device.lockForConfiguration()
        device.videoZoomFactor = clampedZoom
        device.unlockForConfiguration()
        resolve(["factor": clampedZoom, "min": minZoom, "max": maxZoom])
      } catch {
        reject("ocr_zoom_failed", error.localizedDescription, error)
      }
    }
  }

  private func focusAt(normalizedPoint: CGPoint, resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    sessionQueue.async {
      do {
        try self.configureIfNeeded()
        guard let device = self.videoDevice else {
          reject("ocr_focus_unavailable", "Camera focus is not available.", nil)
          return
        }

        let fallbackPoint = CGPoint(
          x: max(0, min(normalizedPoint.x, 1)),
          y: max(0, min(normalizedPoint.y, 1))
        )
        let devicePoint = DispatchQueue.main.sync {
          self.previewOverlayView?.captureDevicePoint(fromNormalizedPoint: fallbackPoint) ?? fallbackPoint
        }

        try device.lockForConfiguration()
        if device.isFocusPointOfInterestSupported {
          device.focusPointOfInterest = devicePoint
          device.focusMode = .autoFocus
        }
        if device.isExposurePointOfInterestSupported {
          device.exposurePointOfInterest = devicePoint
          device.exposureMode = .continuousAutoExposure
        }
        device.unlockForConfiguration()
        resolve(["x": devicePoint.x, "y": devicePoint.y])
      } catch {
        reject("ocr_focus_failed", error.localizedDescription, error)
      }
    }
  }

  func photoOutput(
    _ output: AVCapturePhotoOutput,
    didFinishProcessingPhoto photo: AVCapturePhoto,
    error: Error?
  ) {
    if let error {
      finishWithError(code: "ocr_photo_failed", message: error.localizedDescription, error: error)
      return
    }

    guard
      let data = photo.fileDataRepresentation(),
      let imageSource = CGImageSourceCreateWithData(data as CFData, nil),
      let cgImage = CGImageSourceCreateImageAtIndex(imageSource, 0, nil)
    else {
      finishWithError(code: "ocr_photo_failed", message: "Unable to read captured image.", error: nil)
      return
    }

    let imageURL = saveCapturedImage(data)
    recognizeText(in: cgImage, imageURL: imageURL)
  }

  private func saveCapturedImage(_ data: Data) -> URL? {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("volt-clip-ocr-\(UUID().uuidString).jpg")
    do {
      try data.write(to: url, options: .atomic)
      return url
    } catch {
      return nil
    }
  }

  private func recognizeText(in image: CGImage, imageURL: URL?) {
    pendingImageURL = imageURL

    let request = VNRecognizeTextRequest { [weak self] request, error in
      guard let self else { return }

      if let error {
        self.finishWithError(code: "ocr_recognition_failed", message: error.localizedDescription, error: error)
        return
      }

      let observations = request.results as? [VNRecognizedTextObservation] ?? []
      let lines = observations.compactMap { observation in
        observation.topCandidates(1).first?.string.trimmingCharacters(in: .whitespacesAndNewlines)
      }.filter { !$0.isEmpty }

      self.finishWithText(lines.joined(separator: "\n"))
    }

    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true

    let handler = VNImageRequestHandler(cgImage: image, orientation: .right, options: [:])
    do {
      try handler.perform([request])
    } catch {
      finishWithError(code: "ocr_recognition_failed", message: error.localizedDescription, error: error)
    }
  }

  private func finishWithText(_ text: String) {
    sessionQueue.async {
      DispatchQueue.main.async {
        var result: [String: String] = ["text": text]
        if let imageURL = self.pendingImageURL {
          result["imageUri"] = imageURL.absoluteString
        }
        self.pendingResolve?(result)
        self.clearPendingCapture()
      }
    }
  }

  private func finishWithError(code: String, message: String, error: Error?) {
    sessionQueue.async {
      DispatchQueue.main.async {
        self.pendingReject?(code, message, error)
        self.clearPendingCapture()
      }
    }
  }

  private func scheduleCaptureTimeout() {
    captureTimeoutWorkItem?.cancel()
    let timeout = DispatchWorkItem { [weak self] in
      self?.finishWithError(code: "ocr_capture_timeout", message: "The text capture timed out. Try again.", error: nil)
    }
    captureTimeoutWorkItem = timeout
    DispatchQueue.main.asyncAfter(deadline: .now() + 12, execute: timeout)
  }

  private func clearPendingCapture() {
    captureTimeoutWorkItem?.cancel()
    captureTimeoutWorkItem = nil
    pendingResolve = nil
    pendingReject = nil
    pendingImageURL = nil
  }
}

@objc(VoltClipTextCameraView)
class VoltClipTextCameraView: UIView {
  @objc var onPreviewState: RCTDirectEventBlock?

  override class var layerClass: AnyClass {
    AVCaptureVideoPreviewLayer.self
  }

  private var previewLayer: AVCaptureVideoPreviewLayer {
    layer as! AVCaptureVideoPreviewLayer
  }

  override init(frame: CGRect) {
    super.init(frame: frame)
    setup()
  }

  required init?(coder: NSCoder) {
    super.init(coder: coder)
    setup()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    previewLayer.frame = bounds
  }

  @objc override func reactSetFrame(_ frame: CGRect) {
    super.reactSetFrame(frame)
    previewLayer.frame = bounds
    if !bounds.isEmpty {
      startPreview()
    }
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()

    if window == nil {
      previewLayer.session = nil
      return
    }

    startPreview()
  }

  private func setup() {
    clipsToBounds = true
    backgroundColor = .black
    previewLayer.videoGravity = .resizeAspectFill
  }

  func startPreviewFromHost() {
    startPreview()
  }

  func captureDevicePoint(fromNormalizedPoint point: CGPoint) -> CGPoint {
    let layerPoint = CGPoint(x: bounds.width * point.x, y: bounds.height * point.y)
    return previewLayer.captureDevicePointConverted(fromLayerPoint: layerPoint)
  }

  private func startPreview() {
    previewLayer.session = VoltClipTextRecognizer.shared.session
    onPreviewState?(["state": "starting"])

    VoltClipTextRecognizer.shared.startPreview { [weak self] session in
      guard let self, self.window != nil else { return }
      guard let session else {
        self.onPreviewState?(["state": "failed"])
        return
      }
      self.previewLayer.session = session
      self.previewLayer.videoGravity = .resizeAspectFill
      self.onPreviewState?(["state": session.isRunning ? "ready" : "failed"])
    }
  }
}

private enum TextRecognizerError: LocalizedError {
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
      return "The photo output could not be added."
    }
  }
}
