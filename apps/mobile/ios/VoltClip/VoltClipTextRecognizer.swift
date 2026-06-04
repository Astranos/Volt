import AVFoundation
import CoreImage
import ImageIO
import React
import UIKit
import Vision

@objc(VoltClipTextRecognizer)
class VoltClipTextRecognizer: RCTEventEmitter, AVCapturePhotoCaptureDelegate, AVCaptureMetadataOutputObjectsDelegate, AVCaptureVideoDataOutputSampleBufferDelegate {
  static let shared = VoltClipTextRecognizer()

  let session = AVCaptureSession()
  private let sessionQueue = DispatchQueue(label: "com.volt.clip.text.session")
  private let ciContext = CIContext(options: nil)
  private let output = AVCapturePhotoOutput()
  private let metadataOutput = AVCaptureMetadataOutput()
  private let videoOutput = AVCaptureVideoDataOutput()
  private var videoDevice: AVCaptureDevice?
  private var latestVideoFrame: CIImage?
  private var isConfigured = false
  private var barcodeCallback: (([String: Any]) -> Void)?
  private var pendingResolve: RCTPromiseResolveBlock?
  private var pendingReject: RCTPromiseRejectBlock?
  private var pendingPhotoResolve: RCTPromiseResolveBlock?
  private var pendingPhotoReject: RCTPromiseRejectBlock?
  private var pendingPhotoPreviewRect: CGRect?
  private var pendingImageURL: URL?
  private var pendingImageData: Data?
  private var pendingImageSize: CGSize?
  fileprivate weak var previewOverlayView: VoltClipTextCameraView?
  private var captureTimeoutWorkItem: DispatchWorkItem?
  private let selectionHaptic = UISelectionFeedbackGenerator()
  private var hasListeners = false
  private var latestDeviceOrientation: UIDeviceOrientation = .portrait
  private let relayImageMaxDimension: CGFloat = 960
  private let relayImageCompressionQuality: CGFloat = 0.6

  override init() {
    super.init()
    UIDevice.current.beginGeneratingDeviceOrientationNotifications()
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(deviceOrientationDidChange),
      name: UIDevice.orientationDidChangeNotification,
      object: nil
    )
    updateLatestDeviceOrientation()
  }

  deinit {
    NotificationCenter.default.removeObserver(self)
    UIDevice.current.endGeneratingDeviceOrientationNotifications()
  }

  override static func requiresMainQueueSetup() -> Bool {
    false
  }

  override func supportedEvents() -> [String]! {
    ["capture", "orientation"]
  }

  override func startObserving() {
    hasListeners = true
    emitDeviceOrientation()
  }

  override func stopObserving() {
    hasListeners = false
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

  @objc(capturePhotoInPreviewRect:y:width:height:resolver:rejecter:)
  func capturePhotoInPreviewRect(
    x: NSNumber,
    y: NSNumber,
    width: NSNumber,
    height: NSNumber,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    VoltClipTextRecognizer.shared.capturePhoto(
      previewRect: CGRect(
        x: CGFloat(truncating: x),
        y: CGFloat(truncating: y),
        width: CGFloat(truncating: width),
        height: CGFloat(truncating: height)
      ),
      resolve: resolve,
      rejecter: reject
    )
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
          self.applyCurrentCaptureOrientation()
          self.output.capturePhoto(with: settings, delegate: self)
        } catch {
          self.clearPendingCapture()
          reject("ocr_capture_failed", error.localizedDescription, error)
        }
      }
    }
  }

  func capturePhoto(previewRect: CGRect, resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
      guard let self else { return }

      if !granted {
        reject("camera_denied", "Camera permission is required to capture photos.", nil)
        return
      }

      self.sessionQueue.async {
        do {
          try self.configureIfNeeded()
          guard self.pendingResolve == nil && self.pendingReject == nil && self.pendingPhotoResolve == nil && self.pendingPhotoReject == nil else {
            reject("photo_capture_in_progress", "A photo capture is already in progress.", nil)
            return
          }

          self.pendingPhotoResolve = resolve
          self.pendingPhotoReject = reject
          self.pendingPhotoPreviewRect = previewRect
          self.scheduleCaptureTimeout()

          if !self.session.isRunning {
            self.session.startRunning()
          }

          self.applyCurrentCaptureOrientation()
          self.finishVideoFramePhotoCapture()
        } catch {
          self.clearPendingCapture()
          reject("photo_capture_failed", error.localizedDescription, error)
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

  func startBarcodeScanning(
    onCandidate: @escaping ([String: Any]) -> Void,
    fullFrame: Bool,
    resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
      guard let self else { return }

      if !granted {
        reject("camera_denied", "Camera permission is required to scan barcodes.", nil)
        return
      }

      self.sessionQueue.async {
        do {
          try self.configureIfNeeded()
          self.barcodeCallback = onCandidate
          self.metadataOutput.rectOfInterest = fullFrame ? CGRect(x: 0, y: 0, width: 1, height: 1) : CGRect(x: 0.18, y: 0.18, width: 0.64, height: 0.64)
          DispatchQueue.main.async {
            self.metadataOutput.setMetadataObjectsDelegate(self, queue: DispatchQueue.main)
          }
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

  func stopBarcodeScanning(resolve: @escaping RCTPromiseResolveBlock) {
    sessionQueue.async {
      self.barcodeCallback = nil
      DispatchQueue.main.async {
        self.metadataOutput.setMetadataObjectsDelegate(nil, queue: nil)
      }
      resolve(["running": self.session.isRunning])
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
    stopPreview()
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
    guard session.canAddOutput(output), session.canAddOutput(metadataOutput), session.canAddOutput(videoOutput) else {
      throw TextRecognizerError.outputUnavailable
    }

    session.beginConfiguration()
    session.sessionPreset = .photo
    session.addInput(input)
    session.addOutput(output)
    session.addOutput(metadataOutput)
    videoOutput.alwaysDiscardsLateVideoFrames = true
    videoOutput.videoSettings = [
      kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA
    ]
    videoOutput.setSampleBufferDelegate(self, queue: sessionQueue)
    session.addOutput(videoOutput)
    metadataOutput.metadataObjectTypes = supportedMetadataTypes(from: metadataOutput.availableMetadataObjectTypes)
    metadataOutput.rectOfInterest = CGRect(x: 0.18, y: 0.18, width: 0.64, height: 0.64)
    session.commitConfiguration()
    applyCurrentCaptureOrientation()
    videoDevice = device
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
    guard let barcodeCallback else { return }

    for metadataObject in metadataObjects {
      guard
        let readableObject = metadataObject as? AVMetadataMachineReadableCodeObject,
        let value = readableObject.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines),
        !value.isEmpty
      else {
        continue
      }

      barcodeCallback(barcodeCandidatePayload(for: readableObject, value: value))
      return
    }
  }

  private func barcodeCandidatePayload(
    for readableObject: AVMetadataMachineReadableCodeObject,
    value: String
  ) -> [String: Any] {
    let transformedObject = DispatchQueue.main.sync {
      previewOverlayView?.transformedMachineReadableCodeObject(for: readableObject)
    }
    let displayObject = transformedObject ?? readableObject
    var payload: [String: Any] = [
      "value": value,
      "format": metadataName(for: readableObject.type),
    ]

    let bounds = displayObject.bounds
    if !bounds.isNull && !bounds.isEmpty {
      payload["bounds"] = [
        "x": bounds.origin.x,
        "y": bounds.origin.y,
        "width": bounds.size.width,
        "height": bounds.size.height,
      ]
    }

    if !displayObject.corners.isEmpty {
      payload["corners"] = displayObject.corners.map { point in
        ["x": point.x, "y": point.y]
      }
    }

    return payload
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

  func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
    guard let imageBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else {
      return
    }

    latestVideoFrame = CIImage(cvPixelBuffer: imageBuffer)
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
    if pendingPhotoResolve != nil || pendingPhotoReject != nil {
      finishPhotoCapture(photo: photo, error: error)
      return
    }

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

    let fallbackOrientation = cgImageOrientation(for: currentVideoOrientation())
    let orientation = imageOrientation(from: imageSource, fallback: fallbackOrientation)
    let relayImage = prepareRelayImage(from: data)
    let imageURL = saveCapturedImage(relayImage.data)
    pendingImageData = relayImage.data
    pendingImageSize = relayImage.size
    emitCapturedImage(imageURL: imageURL, imageData: relayImage.data, imageSize: relayImage.size)
    recognizeText(in: cgImage, orientation: orientation, imageURL: imageURL)
  }

  private func finishPhotoCapture(photo: AVCapturePhoto, error: Error?) {
    if let error {
      finishPhotoWithError(code: "photo_capture_failed", message: error.localizedDescription, error: error)
      return
    }

    guard
      let data = photo.fileDataRepresentation(),
      let sourceImage = UIImage(data: data)?.normalizedForVoltRelay(),
      let croppedImage = cropImageToPreviewRect(sourceImage)
    else {
      finishPhotoWithError(code: "photo_capture_failed", message: "Unable to prepare the captured photo.", error: nil)
      return
    }

    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    format.opaque = true
    let outputData = UIGraphicsImageRenderer(size: croppedImage.size, format: format).jpegData(withCompressionQuality: 0.72) { context in
      UIColor.white.setFill()
      context.fill(CGRect(origin: .zero, size: croppedImage.size))
      croppedImage.draw(in: CGRect(origin: .zero, size: croppedImage.size))
    }

    DispatchQueue.main.async {
      self.pendingPhotoResolve?([
        "dataUrl": "data:image/jpeg;base64,\(outputData.base64EncodedString())",
        "size": "\(outputData.count)",
        "width": "\(Int(croppedImage.size.width))",
        "height": "\(Int(croppedImage.size.height))",
      ])
      self.clearPendingCapture()
    }
  }

  private func finishVideoFramePhotoCapture(retryCount: Int = 0) {
    guard let sourceImage = latestVideoFrame else {
      if retryCount < 3 {
        sessionQueue.asyncAfter(deadline: .now() + 0.08) { [weak self] in
          self?.finishVideoFramePhotoCapture(retryCount: retryCount + 1)
        }
      } else {
        finishPhotoWithError(code: "photo_capture_failed", message: "Camera preview is not ready yet.", error: nil)
      }
      return
    }

    guard let croppedImage = cropVideoFrameToPreviewRect(sourceImage) else {
      finishPhotoWithError(code: "photo_capture_failed", message: "Unable to crop the preview frame.", error: nil)
      return
    }

    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    format.opaque = true
    let outputData = UIGraphicsImageRenderer(size: croppedImage.size, format: format).jpegData(withCompressionQuality: 0.72) { context in
      UIColor.white.setFill()
      context.fill(CGRect(origin: .zero, size: croppedImage.size))
      croppedImage.draw(in: CGRect(origin: .zero, size: croppedImage.size))
    }

    DispatchQueue.main.async {
      self.pendingPhotoResolve?([
        "dataUrl": "data:image/jpeg;base64,\(outputData.base64EncodedString())",
        "size": "\(outputData.count)",
        "width": "\(Int(croppedImage.size.width))",
        "height": "\(Int(croppedImage.size.height))",
      ])
      self.clearPendingCapture()
    }
  }

  private func cropVideoFrameToPreviewRect(_ image: CIImage) -> UIImage? {
    let cropRect = DispatchQueue.main.sync { () -> CGRect? in
      guard
        let previewView = self.previewOverlayView,
        let previewRect = self.pendingPhotoPreviewRect,
        previewView.bounds.width > 1,
        previewView.bounds.height > 1
      else {
        return nil
      }

      let normalizedRect = previewView.metadataOutputRect(fromLayerRect: previewRect)
      let imageBounds = image.extent
      return CGRect(
        x: imageBounds.minX + (normalizedRect.origin.x * imageBounds.width),
        y: imageBounds.minY + ((1 - normalizedRect.origin.y - normalizedRect.height) * imageBounds.height),
        width: normalizedRect.width * imageBounds.width,
        height: normalizedRect.height * imageBounds.height
      )
      .integral
      .intersection(imageBounds)
    }

    let fallbackSize = min(image.extent.width, image.extent.height)
    let fallbackRect = CGRect(
      x: image.extent.midX - (fallbackSize / 2),
      y: image.extent.midY - (fallbackSize / 2),
      width: fallbackSize,
      height: fallbackSize
    )
    let resolvedCropRect = (cropRect?.isNull == false && cropRect?.isEmpty == false) ? cropRect! : fallbackRect
    let cropped = image.cropped(to: resolvedCropRect)
    guard let cgImage = ciContext.createCGImage(cropped, from: resolvedCropRect) else {
      return nil
    }
    return UIImage(cgImage: cgImage, scale: 1, orientation: .up)
  }

  private func cropImageToPreviewRect(_ image: UIImage) -> UIImage? {
    guard let cgImage = image.cgImage else { return nil }
    let cropRect = DispatchQueue.main.sync { () -> CGRect? in
      guard
        let previewView = self.previewOverlayView,
        let previewRect = self.pendingPhotoPreviewRect,
        previewView.bounds.width > 1,
        previewView.bounds.height > 1
      else {
        return nil
      }

      let normalizedRect = previewView.metadataOutputRect(fromLayerRect: previewRect)
      let imageWidth = CGFloat(cgImage.width)
      let imageHeight = CGFloat(cgImage.height)
      return CGRect(
        x: normalizedRect.origin.x * imageWidth,
        y: normalizedRect.origin.y * imageHeight,
        width: normalizedRect.width * imageWidth,
        height: normalizedRect.height * imageHeight
      )
      .integral
      .intersection(CGRect(x: 0, y: 0, width: imageWidth, height: imageHeight))
    }

    let fallbackSize = min(CGFloat(cgImage.width), CGFloat(cgImage.height))
    let fallbackRect = CGRect(
      x: (CGFloat(cgImage.width) - fallbackSize) / 2,
      y: (CGFloat(cgImage.height) - fallbackSize) / 2,
      width: fallbackSize,
      height: fallbackSize
    )
    let resolvedCropRect = (cropRect?.isNull == false && cropRect?.isEmpty == false) ? cropRect! : fallbackRect

    guard let croppedCgImage = cgImage.cropping(to: resolvedCropRect) else {
      return nil
    }
    return UIImage(cgImage: croppedCgImage, scale: 1, orientation: .up)
  }

  private func imageOrientation(from imageSource: CGImageSource, fallback: CGImagePropertyOrientation) -> CGImagePropertyOrientation {
    guard
      let properties = CGImageSourceCopyPropertiesAtIndex(imageSource, 0, nil) as? [CFString: Any],
      let rawValue = properties[kCGImagePropertyOrientation] as? UInt32,
      let orientation = CGImagePropertyOrientation(rawValue: rawValue)
    else {
      return fallback
    }

    return orientation
  }

  @objc private func deviceOrientationDidChange() {
    updateLatestDeviceOrientation()
    applyCurrentCaptureOrientation()
    emitDeviceOrientation()
  }

  private func updateLatestDeviceOrientation() {
    let orientation = UIDevice.current.orientation
    if orientation.isValidInterfaceOrientation {
      latestDeviceOrientation = orientation
    }
  }

  private func emitDeviceOrientation() {
    guard hasListeners else {
      return
    }

    DispatchQueue.main.async {
      self.sendEvent(withName: "orientation", body: ["degrees": self.rotationDegrees(for: self.latestDeviceOrientation)])
    }
  }

  private func rotationDegrees(for orientation: UIDeviceOrientation) -> Int {
    switch orientation {
    case .landscapeLeft:
      return 90
    case .landscapeRight:
      return -90
    case .portraitUpsideDown:
      return 180
    default:
      return 0
    }
  }

  private func currentVideoOrientation() -> AVCaptureVideoOrientation {
    updateLatestDeviceOrientation()
    switch latestDeviceOrientation {
    case .portrait:
      return .portrait
    case .portraitUpsideDown:
      return .portraitUpsideDown
    case .landscapeLeft:
      return .landscapeRight
    case .landscapeRight:
      return .landscapeLeft
    default:
      return .portrait
    }
  }

  private func applyCurrentCaptureOrientation() {
    let orientation = currentVideoOrientation()
    if let connection = output.connection(with: .video), connection.isVideoOrientationSupported {
      connection.videoOrientation = orientation
    }
    if let connection = metadataOutput.connection(with: .metadata), connection.isVideoOrientationSupported {
      connection.videoOrientation = orientation
    }
    if let connection = videoOutput.connection(with: .video), connection.isVideoOrientationSupported {
      connection.videoOrientation = orientation
    }
  }

  private func cgImageOrientation(for videoOrientation: AVCaptureVideoOrientation) -> CGImagePropertyOrientation {
    switch videoOrientation {
    case .portrait:
      return .right
    case .portraitUpsideDown:
      return .left
    case .landscapeRight:
      return .up
    case .landscapeLeft:
      return .down
    @unknown default:
      return .right
    }
  }

  private func prepareRelayImage(from data: Data) -> (data: Data, size: CGSize) {
    guard let image = UIImage(data: data) else {
      return (data, CGSize.zero)
    }

    let uprightImage = normalizeImageOrientation(image)
    let originalSize = uprightImage.size
    let maxDimension = max(originalSize.width, originalSize.height)
    let scale = maxDimension > relayImageMaxDimension ? relayImageMaxDimension / maxDimension : 1
    let outputSize = CGSize(
      width: max(1, floor(originalSize.width * scale)),
      height: max(1, floor(originalSize.height * scale))
    )

    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    format.opaque = true
    let renderer = UIGraphicsImageRenderer(size: outputSize, format: format)
    let outputData = renderer.jpegData(withCompressionQuality: relayImageCompressionQuality) { context in
      UIColor.white.setFill()
      context.fill(CGRect(origin: .zero, size: outputSize))
      uprightImage.draw(in: CGRect(origin: .zero, size: outputSize))
    }

    return (outputData, outputSize)
  }

  private func normalizeImageOrientation(_ image: UIImage) -> UIImage {
    if image.imageOrientation == .up {
      return image
    }

    let format = UIGraphicsImageRendererFormat()
    format.scale = image.scale
    format.opaque = true
    let renderer = UIGraphicsImageRenderer(size: image.size, format: format)
    return renderer.image { context in
      UIColor.white.setFill()
      context.fill(CGRect(origin: .zero, size: image.size))
      image.draw(in: CGRect(origin: .zero, size: image.size))
    }
  }

  private func emitCapturedImage(imageURL: URL?, imageData: Data, imageSize: CGSize?) {
    guard hasListeners else {
      return
    }

    DispatchQueue.main.async {
      var body: [String: String] = ["phase": "captured"]
      if let imageURL {
        body["imageUri"] = imageURL.absoluteString
      }
      body["dataUrl"] = "data:image/jpeg;base64,\(imageData.base64EncodedString())"
      body["size"] = "\(imageData.count)"
      if let imageSize {
        body["width"] = "\(Int(imageSize.width))"
        body["height"] = "\(Int(imageSize.height))"
      }
      self.sendEvent(withName: "capture", body: body)
    }
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

  private func recognizeText(in image: CGImage, orientation: CGImagePropertyOrientation, imageURL: URL?) {
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

    let handler = VNImageRequestHandler(cgImage: image, orientation: orientation, options: [:])
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
        if let imageData = self.pendingImageData {
          result["dataUrl"] = "data:image/jpeg;base64,\(imageData.base64EncodedString())"
          result["size"] = "\(imageData.count)"
        }
        if let imageSize = self.pendingImageSize {
          result["width"] = "\(Int(imageSize.width))"
          result["height"] = "\(Int(imageSize.height))"
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

  private func finishPhotoWithError(code: String, message: String, error: Error?) {
    sessionQueue.async {
      DispatchQueue.main.async {
        self.pendingPhotoReject?(code, message, error)
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
    pendingPhotoResolve = nil
    pendingPhotoReject = nil
    pendingPhotoPreviewRect = nil
    pendingImageURL = nil
    pendingImageData = nil
    pendingImageSize = nil
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
      if VoltClipTextRecognizer.shared.previewOverlayView === self {
        VoltClipTextRecognizer.shared.previewOverlayView = nil
      }
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

  func metadataOutputRect(fromLayerRect rect: CGRect) -> CGRect {
    previewLayer.metadataOutputRectConverted(fromLayerRect: rect)
  }

  func transformedMachineReadableCodeObject(
    for metadataObject: AVMetadataMachineReadableCodeObject
  ) -> AVMetadataMachineReadableCodeObject? {
    previewLayer.transformedMetadataObject(for: metadataObject) as? AVMetadataMachineReadableCodeObject
  }

  private func startPreview() {
    VoltClipTextRecognizer.shared.previewOverlayView = self
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

private extension UIImage {
  func normalizedForVoltRelay() -> UIImage {
    if imageOrientation == .up {
      return self
    }

    let format = UIGraphicsImageRendererFormat()
    format.scale = scale
    format.opaque = true
    let renderer = UIGraphicsImageRenderer(size: size, format: format)
    return renderer.image { context in
      UIColor.white.setFill()
      context.fill(CGRect(origin: .zero, size: size))
      draw(in: CGRect(origin: .zero, size: size))
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
