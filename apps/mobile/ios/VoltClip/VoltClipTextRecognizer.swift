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
  private var isConfigured = false
  private var pendingResolve: RCTPromiseResolveBlock?
  private var pendingReject: RCTPromiseRejectBlock?
  private var pendingImageURL: URL?
  private weak var previewOverlayView: VoltClipTextCameraView?

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
          self.pendingResolve = resolve
          self.pendingReject = reject

          if !self.session.isRunning {
            self.session.startRunning()
          }

          let settings = AVCapturePhotoSettings()
          self.output.capturePhoto(with: settings, delegate: self)
        } catch {
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
      overlayView.layer.cornerRadius = 32
      overlayView.frame = frame
      if overlayView.superview !== window {
        overlayView.removeFromSuperview()
        window.addSubview(overlayView)
      }
      window.bringSubviewToFront(overlayView)
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
      let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back)
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
    isConfigured = true
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
        self.pendingResolve = nil
        self.pendingReject = nil
        self.pendingImageURL = nil
      }
    }
  }

  private func finishWithError(code: String, message: String, error: Error?) {
    sessionQueue.async {
      DispatchQueue.main.async {
        self.pendingReject?(code, message, error)
        self.pendingResolve = nil
        self.pendingReject = nil
        self.pendingImageURL = nil
      }
    }
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

  deinit {
    VoltClipTextRecognizer.shared.stopPreview()
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
      VoltClipTextRecognizer.shared.stopPreview()
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
