import AVFoundation
import AVFAudio
import ImageIO
import Speech
import SwiftUI
import UIKit
import Vision

private let signalBaseURL = URL(string: "https://scanner-signal.vercel.app/api/signal")!
private let validModes: Set<String> = ["ocr", "barcode", "photo", "dictation"]

@UIApplicationMain
final class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?
  private let model = ClipModel()

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let window = UIWindow(frame: UIScreen.main.bounds)
    window.rootViewController = UIHostingController(rootView: ClipRootView(model: model))
    window.tintColor = .white
    window.makeKeyAndVisible()
    self.window = window

    if
      let activityDictionary = launchOptions?[.userActivityDictionary] as? [AnyHashable: Any],
      let activity = activityDictionary.values.compactMap({ $0 as? NSUserActivity }).first
    {
      model.handle(activity: activity)
    }

    return true
  }

  func application(
    _ application: UIApplication,
    continue userActivity: NSUserActivity,
    restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
  ) -> Bool {
    model.handle(activity: userActivity)
    return true
  }

  func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
    model.handle(url: url)
    return true
  }
}

private enum ClipMode: String, CaseIterable, Identifiable {
  case ocr
  case barcode
  case photo
  case dictation

  var id: String { rawValue }

  var title: String {
    switch self {
    case .ocr: return "Text"
    case .barcode: return "Scan"
    case .photo: return "Photo"
    case .dictation: return "Speak"
    }
  }

  var symbol: String {
    switch self {
    case .ocr: return "doc.text.viewfinder"
    case .barcode: return "barcode.viewfinder"
    case .photo: return "camera.viewfinder"
    case .dictation: return "mic"
    }
  }
}

private struct ClipInvocation {
  let mode: ClipMode
  let sessionId: String
}

@MainActor
private final class ClipModel: ObservableObject {
  @Published var mode: ClipMode = .ocr
  @Published var sessionId: String?
  @Published var status = "Open from the QR code in Chrome"
  @Published var error: String?
  @Published var isSending = false
  @Published var lastText = ""
  @Published var barcodeCandidate: BarcodeCandidate?
  @Published var torchEnabled = false
  @Published var zoomFactor: CGFloat = 1
  @Published var autoSendBarcode = true
  @Published var insertIntoCursor = true
  @Published var dictationRunning = false
  @Published var dictationTranscript = ""

  let camera = ClipCamera()
  let dictation = ClipDictation()

  init() {
    camera.onBarcode = { [weak self] candidate in
      Task { @MainActor in
        guard let self else { return }
        self.barcodeCandidate = candidate
        self.status = "Code found"
        if self.autoSendBarcode {
          await self.sendBarcode(candidate)
        }
      }
    }

    dictation.onPartial = { [weak self] text in
      Task { @MainActor in
        guard let self else { return }
        self.dictationTranscript = text
        await self.sendDictation(text: text, phase: "partial", background: true)
      }
    }

    dictation.onFinal = { [weak self] text in
      Task { @MainActor in
        guard let self else { return }
        self.dictationTranscript = text
        await self.sendDictation(text: text, phase: "final", background: false)
      }
    }
  }

  func handle(activity: NSUserActivity) {
    guard let url = activity.webpageURL else { return }
    handle(url: url)
  }

  func handle(url: URL) {
    guard let invocation = parseInvocation(url: url) else {
      status = "Open this App Clip from the Chrome QR"
      return
    }

    mode = invocation.mode
    sessionId = invocation.sessionId
    error = nil
    status = "Paired with Chrome"
    Task { await connect() }
  }

  func connect() async {
    guard let sessionId else { return }
    do {
      _ = try await postJSON(path: "\(sessionId)/connect", body: [:])
    } catch {
      self.error = "Chrome session is unavailable. Reopen the QR code."
    }
  }

  func startMode() {
    error = nil
    switch mode {
    case .ocr, .photo, .barcode:
      camera.start()
      camera.setMode(mode)
      camera.setTorch(torchEnabled)
      camera.setZoom(zoomFactor)
    case .dictation:
      camera.stop()
    }
  }

  func stopMode() {
    if mode == .dictation {
      dictation.stop()
      dictationRunning = false
    }
  }

  func capturePrimary() {
    switch mode {
    case .ocr:
      status = "Reading text"
      camera.capturePhoto { [weak self] result in
        Task { @MainActor in
          guard let self else { return }
          switch result {
          case .success(let photo):
            await self.recognizeAndSend(photo: photo)
          case .failure(let error):
            self.error = error.localizedDescription
          }
        }
      }
    case .photo:
      status = "Sending photo"
      camera.capturePhoto { [weak self] result in
        Task { @MainActor in
          guard let self else { return }
          switch result {
          case .success(let photo):
            await self.sendPhoto(photo)
          case .failure(let error):
            self.error = error.localizedDescription
          }
        }
      }
    case .barcode:
      if let barcodeCandidate {
        Task { await sendBarcode(barcodeCandidate) }
      }
    case .dictation:
      if dictationRunning {
        dictation.stop()
        dictationRunning = false
        status = "Dictation sent"
      } else {
        Task { await startDictation() }
      }
    }
  }

  func startDictation() async {
    do {
      dictationTranscript = ""
      try await dictation.start()
      dictationRunning = true
      status = "Listening"
    } catch {
      dictationRunning = false
      self.error = error.localizedDescription
    }
  }

  func setTorch(_ enabled: Bool) {
    torchEnabled = enabled
    camera.setTorch(enabled)
  }

  func setZoom(_ factor: CGFloat) {
    zoomFactor = factor
    camera.setZoom(factor)
  }

  private func recognizeAndSend(photo: CapturedPhoto) async {
    do {
      let text = try await TextRecognizer.recognize(cgImage: photo.image)
      lastText = text
      guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
        status = "No text found"
        return
      }
      try await sendResult(mode: .ocr, message: [
        "barcode": text,
        "format": "live-text",
        "insertIntoCursor": insertIntoCursor,
        "kind": "text",
        "scannedAt": ISO8601DateFormatter().string(from: Date()),
      ])
      status = "Sent to Chrome"
    } catch {
      self.error = error.localizedDescription
    }
  }

  private func sendBarcode(_ candidate: BarcodeCandidate) async {
    guard !isSending else { return }
    do {
      try await sendResult(mode: .barcode, message: [
        "barcode": candidate.value,
        "format": candidate.format,
        "insertIntoCursor": true,
        "kind": "barcode",
        "scannedAt": ISO8601DateFormatter().string(from: Date()),
      ])
      status = "Sent to Chrome"
    } catch {
      self.error = error.localizedDescription
    }
  }

  private func sendDictation(text: String, phase: String, background: Bool) async {
    guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
    do {
      try await sendResult(mode: .dictation, message: [
        "barcode": text,
        "dictationPhase": phase,
        "dictationSessionId": dictation.sessionId,
        "format": "dictation",
        "insertIntoCursor": true,
        "kind": "text",
        "scannedAt": ISO8601DateFormatter().string(from: Date()),
      ], background: background)
      if !background {
        status = "Sent to Chrome"
      }
    } catch {
      if !background {
        self.error = error.localizedDescription
      }
    }
  }

  private func sendPhoto(_ photo: CapturedPhoto) async {
    do {
      let base64 = photo.data.base64EncodedString()
      try await sendResult(mode: .photo, message: [
        "kind": "photo",
        "id": "clip-photo-\(Int(Date().timeIntervalSince1970 * 1000))",
        "name": "volt-photo.jpg",
        "mimeType": "image/jpeg",
        "dataUrl": "data:image/jpeg;base64,\(base64)",
        "size": photo.data.count,
        "width": Int(photo.size.width),
        "height": Int(photo.size.height),
        "capturedAt": ISO8601DateFormatter().string(from: Date()),
      ])
      status = "Sent to Chrome"
    } catch {
      self.error = error.localizedDescription
    }
  }

  private func sendResult(mode: ClipMode, message: [String: Any], background: Bool = false) async throws {
    guard let sessionId else {
      throw ClipError.message("Open from the QR code in Chrome first.")
    }

    if !background {
      isSending = true
      defer { isSending = false }
    }

    _ = try await postJSON(path: "\(sessionId)/result", body: [
      "id": "\(Int(Date().timeIntervalSince1970 * 1000))-\(UUID().uuidString.prefix(8))",
      "mode": mode.rawValue,
      "message": message,
    ])
  }

  private func postJSON(path: String, body: [String: Any]) async throws -> [String: Any] {
    let url = signalBaseURL.appendingPathComponent(path)
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONSerialization.data(withJSONObject: body)
    let (data, response) = try await URLSession.shared.data(for: request)
    guard let http = response as? HTTPURLResponse else {
      throw ClipError.message("Chrome session did not respond.")
    }
    guard (200..<300).contains(http.statusCode) else {
      if http.statusCode == 404 {
        throw ClipError.message("The Chrome session expired. Open a new QR code.")
      }
      throw ClipError.message("Chrome session returned \(http.statusCode).")
    }
    return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
  }

  private func parseInvocation(url: URL) -> ClipInvocation? {
    guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
    let parts = components.path.split(separator: "/").map(String.init)
    let clipIndex = parts.firstIndex(of: "clip")
    let pathMode = clipIndex.flatMap { parts.indices.contains($0 + 1) ? parts[$0 + 1] : nil } ?? parts.first
    let query = components.queryItems ?? []
    let queryMode = query.first(where: { $0.name == "mode" })?.value
    let modeValue = queryMode ?? pathMode
    let session = query.first(where: { $0.name == "session" })?.value
    guard
      let modeValue,
      validModes.contains(modeValue),
      let mode = ClipMode(rawValue: modeValue),
      let session,
      session.range(of: #"^[A-Za-z0-9_-]{4,80}$"#, options: .regularExpression) != nil
    else {
      return nil
    }
    return ClipInvocation(mode: mode, sessionId: session)
  }
}

private struct ClipRootView: View {
  @ObservedObject var model: ClipModel

  var body: some View {
    ZStack {
      if model.mode == .dictation {
        DictationBackdrop()
      } else {
        CameraPreview(camera: model.camera)
          .ignoresSafeArea()
        BarcodeOverlay(candidate: model.barcodeCandidate)
          .ignoresSafeArea()
      }

      VStack(spacing: 0) {
        header
        Spacer()
        controls
      }
      .padding(.horizontal, 18)
      .padding(.top, 16)
      .padding(.bottom, 14)
    }
    .background(Color.black)
    .foregroundStyle(.white)
    .onAppear { model.startMode() }
    .onChange(of: model.mode) { _ in model.startMode() }
  }

  private var header: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text(model.mode.title)
        .font(.system(size: 30, weight: .bold, design: .rounded))
      Text(model.error ?? model.status)
        .font(.system(size: 15, weight: .medium))
        .foregroundStyle(model.error == nil ? .white.opacity(0.78) : .red.opacity(0.95))
        .lineLimit(2)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(.top, 8)
  }

  private var controls: some View {
    VStack(spacing: 14) {
      if model.mode == .dictation {
        Text(model.dictationTranscript.isEmpty ? "Hold the phone near your voice." : model.dictationTranscript)
          .font(.system(size: 20, weight: .semibold))
          .frame(maxWidth: .infinity, minHeight: 72, alignment: .center)
          .multilineTextAlignment(.center)
      }

      HStack(spacing: 14) {
        ToggleButton(title: "Type", symbol: "cursorarrow", isOn: model.insertIntoCursor) {
          model.insertIntoCursor.toggle()
        }

        if model.mode == .barcode {
          ToggleButton(title: "Auto", symbol: "bolt.fill", isOn: model.autoSendBarcode) {
            model.autoSendBarcode.toggle()
          }
        } else if model.mode != .dictation {
          ToggleButton(title: "Light", symbol: "flashlight.on.fill", isOn: model.torchEnabled) {
            model.setTorch(!model.torchEnabled)
          }
        }
      }

      if model.mode != .dictation {
        HStack(spacing: 12) {
          Image(systemName: "minus.magnifyingglass")
          Slider(value: Binding(get: {
            Double(model.zoomFactor)
          }, set: { value in
            model.setZoom(CGFloat(value))
          }), in: 1...4)
          Image(systemName: "plus.magnifyingglass")
        }
        .font(.system(size: 15, weight: .semibold))
      }

      HStack(spacing: 16) {
        modePicker
        Button(action: model.capturePrimary) {
          ZStack {
            Circle()
              .fill(.white)
              .frame(width: 72, height: 72)
            Image(systemName: primarySymbol)
              .font(.system(size: 28, weight: .bold))
              .foregroundStyle(.black)
          }
        }
        .disabled(model.isSending)
      }
    }
    .padding(16)
    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 28, style: .continuous))
  }

  private var modePicker: some View {
    HStack(spacing: 4) {
      ForEach(ClipMode.allCases) { mode in
        Button {
          model.mode = mode
        } label: {
          VStack(spacing: 4) {
            Image(systemName: mode.symbol)
              .font(.system(size: 19, weight: .semibold))
            Text(mode.title)
              .font(.system(size: 11, weight: .semibold))
          }
          .frame(width: 58, height: 56)
          .foregroundStyle(model.mode == mode ? .black : .white)
          .background(model.mode == mode ? .white : .white.opacity(0.12), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
      }
    }
  }

  private var primarySymbol: String {
    switch model.mode {
    case .ocr: return "text.viewfinder"
    case .barcode: return "paperplane.fill"
    case .photo: return "camera.fill"
    case .dictation: return model.dictationRunning ? "stop.fill" : "mic.fill"
    }
  }
}

private struct ToggleButton: View {
  let title: String
  let symbol: String
  let isOn: Bool
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      Label(title, systemImage: symbol)
        .font(.system(size: 14, weight: .semibold))
        .frame(maxWidth: .infinity, minHeight: 44)
        .foregroundStyle(isOn ? .black : .white)
        .background(isOn ? .white : .white.opacity(0.14), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
  }
}

private struct DictationBackdrop: View {
  var body: some View {
    LinearGradient(colors: [.black, Color(red: 0.10, green: 0.12, blue: 0.16)], startPoint: .top, endPoint: .bottom)
      .ignoresSafeArea()
      .overlay {
        Image(systemName: "waveform")
          .font(.system(size: 120, weight: .thin))
          .foregroundStyle(.white.opacity(0.16))
      }
  }
}

private struct CameraPreview: UIViewRepresentable {
  let camera: ClipCamera

  func makeUIView(context: Context) -> PreviewView {
    let view = PreviewView()
    view.previewLayer.session = camera.session
    return view
  }

  func updateUIView(_ uiView: PreviewView, context: Context) {
    uiView.previewLayer.session = camera.session
  }
}

private final class PreviewView: UIView {
  override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
  var previewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }

  override init(frame: CGRect) {
    super.init(frame: frame)
    previewLayer.videoGravity = .resizeAspectFill
    backgroundColor = .black
  }

  required init?(coder: NSCoder) {
    super.init(coder: coder)
    previewLayer.videoGravity = .resizeAspectFill
  }
}

private struct BarcodeOverlay: View {
  let candidate: BarcodeCandidate?

  var body: some View {
    GeometryReader { proxy in
      if let candidate {
        let rect = candidate.rect(in: proxy.size)
        RoundedRectangle(cornerRadius: 12, style: .continuous)
          .stroke(.green, lineWidth: 4)
          .frame(width: rect.width, height: rect.height)
          .position(x: rect.midX, y: rect.midY)
          .shadow(color: .green.opacity(0.65), radius: 10)
      }
    }
    .allowsHitTesting(false)
  }
}

private struct CapturedPhoto {
  let data: Data
  let image: CGImage
  let size: CGSize
}

private struct BarcodeCandidate: Identifiable {
  let id = UUID()
  let value: String
  let format: String
  let bounds: CGRect

  func rect(in size: CGSize) -> CGRect {
    CGRect(
      x: bounds.minX * size.width,
      y: bounds.minY * size.height,
      width: bounds.width * size.width,
      height: bounds.height * size.height
    )
  }
}

private final class ClipCamera: NSObject, ObservableObject, AVCaptureMetadataOutputObjectsDelegate, AVCapturePhotoCaptureDelegate {
  let session = AVCaptureSession()
  var onBarcode: ((BarcodeCandidate) -> Void)?

  private let queue = DispatchQueue(label: "com.volt.clip.native.camera")
  private let photoOutput = AVCapturePhotoOutput()
  private let metadataOutput = AVCaptureMetadataOutput()
  private var device: AVCaptureDevice?
  private var isConfigured = false
  private var completion: ((Result<CapturedPhoto, Error>) -> Void)?

  func start() {
    AVCaptureDevice.requestAccess(for: .video) { granted in
      guard granted else { return }
      self.queue.async {
        do {
          try self.configureIfNeeded()
          if !self.session.isRunning {
            self.session.startRunning()
          }
        } catch {
          // Surface is handled by capture actions.
        }
      }
    }
  }

  func stop() {
    queue.async {
      if self.session.isRunning {
        self.session.stopRunning()
      }
    }
  }

  func setMode(_ mode: ClipMode) {
    queue.async {
      self.metadataOutput.setMetadataObjectsDelegate(mode == .barcode ? self : nil, queue: DispatchQueue.main)
    }
  }

  func setTorch(_ enabled: Bool) {
    queue.async {
      guard let device = self.device, device.hasTorch else { return }
      try? device.lockForConfiguration()
      device.torchMode = enabled ? .on : .off
      device.unlockForConfiguration()
    }
  }

  func setZoom(_ factor: CGFloat) {
    queue.async {
      guard let device = self.device else { return }
      let value = max(device.minAvailableVideoZoomFactor, min(factor, min(4, device.activeFormat.videoMaxZoomFactor)))
      try? device.lockForConfiguration()
      device.videoZoomFactor = value
      device.unlockForConfiguration()
    }
  }

  func capturePhoto(completion: @escaping (Result<CapturedPhoto, Error>) -> Void) {
    AVCaptureDevice.requestAccess(for: .video) { granted in
      guard granted else {
        completion(.failure(ClipError.message("Camera permission is required.")))
        return
      }
      self.queue.async {
        do {
          try self.configureIfNeeded()
          self.completion = completion
          if !self.session.isRunning {
            self.session.startRunning()
          }
          self.photoOutput.capturePhoto(with: AVCapturePhotoSettings(), delegate: self)
        } catch {
          completion(.failure(error))
        }
      }
    }
  }

  private func configureIfNeeded() throws {
    guard !isConfigured else { return }
    guard
      let device = AVCaptureDevice.default(.builtInTripleCamera, for: .video, position: .back)
        ?? AVCaptureDevice.default(.builtInDualWideCamera, for: .video, position: .back)
        ?? AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back)
    else {
      throw ClipError.message("Camera is unavailable.")
    }

    let input = try AVCaptureDeviceInput(device: device)
    session.beginConfiguration()
    session.sessionPreset = .photo
    if session.canAddInput(input) { session.addInput(input) }
    if session.canAddOutput(photoOutput) { session.addOutput(photoOutput) }
    if session.canAddOutput(metadataOutput) {
      session.addOutput(metadataOutput)
      metadataOutput.metadataObjectTypes = supportedTypes(metadataOutput.availableMetadataObjectTypes)
    }
    session.commitConfiguration()
    self.device = device
    isConfigured = true
  }

  private func supportedTypes(_ available: [AVMetadataObject.ObjectType]) -> [AVMetadataObject.ObjectType] {
    [.qr, .ean13, .ean8, .upce, .code128, .code39, .code93, .dataMatrix, .pdf417, .aztec, .interleaved2of5, .itf14]
      .filter { available.contains($0) }
  }

  func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput metadataObjects: [AVMetadataObject], from connection: AVCaptureConnection) {
    guard
      let object = metadataObjects.compactMap({ $0 as? AVMetadataMachineReadableCodeObject }).first,
      let value = object.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines),
      !value.isEmpty
    else {
      return
    }

    let normalized = CGRect(
      x: max(0, min(1, object.bounds.origin.x)),
      y: max(0, min(1, object.bounds.origin.y)),
      width: max(0.06, min(1, object.bounds.width)),
      height: max(0.06, min(1, object.bounds.height))
    )
    onBarcode?(BarcodeCandidate(value: value, format: metadataName(object.type), bounds: normalized))
  }

  func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?) {
    if let error {
      completion?(.failure(error))
      completion = nil
      return
    }
    guard
      let data = photo.fileDataRepresentation(),
      let source = CGImageSourceCreateWithData(data as CFData, nil),
      let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
    else {
      completion?(.failure(ClipError.message("Unable to read the photo.")))
      completion = nil
      return
    }
    completion?(.success(CapturedPhoto(data: data, image: image, size: CGSize(width: image.width, height: image.height))))
    completion = nil
  }

  private func metadataName(_ type: AVMetadataObject.ObjectType) -> String {
    switch type {
    case .qr: return "qr"
    case .ean13: return "ean13"
    case .ean8: return "ean8"
    case .upce: return "upce"
    case .code128: return "code128"
    case .code39: return "code39"
    case .code93: return "code93"
    case .dataMatrix: return "datamatrix"
    case .pdf417: return "pdf417"
    case .aztec: return "aztec"
    case .interleaved2of5: return "itf"
    case .itf14: return "itf14"
    default: return type.rawValue
    }
  }
}

private enum TextRecognizer {
  static func recognize(cgImage: CGImage) async throws -> String {
    try await withCheckedThrowingContinuation { continuation in
      let request = VNRecognizeTextRequest { request, error in
        if let error {
          continuation.resume(throwing: error)
          return
        }
        let observations = request.results as? [VNRecognizedTextObservation] ?? []
        let text = observations.compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
        continuation.resume(returning: text)
      }
      request.recognitionLevel = .accurate
      request.usesLanguageCorrection = true
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          try VNImageRequestHandler(cgImage: cgImage, orientation: .right).perform([request])
        } catch {
          continuation.resume(throwing: error)
        }
      }
    }
  }
}

private final class ClipDictation: NSObject {
  let sessionId = UUID().uuidString
  var onPartial: ((String) -> Void)?
  var onFinal: ((String) -> Void)?

  private let audioEngine = AVAudioEngine()
  private var request: SFSpeechAudioBufferRecognitionRequest?
  private var task: SFSpeechRecognitionTask?
  private let recognizer = SFSpeechRecognizer()

  func start() async throws {
    try await requestPermissions()
    stop()

    let request = SFSpeechAudioBufferRecognitionRequest()
    request.shouldReportPartialResults = true
    self.request = request

    let session = AVAudioSession.sharedInstance()
    try session.setCategory(.playAndRecord, mode: .measurement, options: [.duckOthers, .defaultToSpeaker, .allowBluetoothHFP])
    try session.setActive(true, options: .notifyOthersOnDeactivation)

    let input = audioEngine.inputNode
    let format = input.outputFormat(forBus: 0)
    input.removeTap(onBus: 0)
    input.installTap(onBus: 0, bufferSize: 2048, format: format) { buffer, _ in
      request.append(buffer)
    }

    audioEngine.prepare()
    try audioEngine.start()

    task = recognizer?.recognitionTask(with: request) { [weak self] result, error in
      guard let self else { return }
      if let result {
        let text = result.bestTranscription.formattedString
        if result.isFinal {
          self.onFinal?(text)
        } else {
          self.onPartial?(text)
        }
      }
      if error != nil {
        self.stop()
      }
    }
  }

  func stop() {
    if audioEngine.isRunning {
      audioEngine.stop()
    }
    audioEngine.inputNode.removeTap(onBus: 0)
    request?.endAudio()
    task?.cancel()
    task = nil
    request = nil
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
  }

  private func requestPermissions() async throws {
    let speechStatus = await withCheckedContinuation { continuation in
      SFSpeechRecognizer.requestAuthorization { status in
        continuation.resume(returning: status)
      }
    }
    guard speechStatus == .authorized else {
      throw ClipError.message("Speech recognition permission is required.")
    }

    let micGranted = await withCheckedContinuation { continuation in
      if #available(iOS 17.0, *) {
        AVAudioApplication.requestRecordPermission { continuation.resume(returning: $0) }
      } else {
        AVAudioSession.sharedInstance().requestRecordPermission { continuation.resume(returning: $0) }
      }
    }
    guard micGranted else {
      throw ClipError.message("Microphone permission is required.")
    }
  }
}

private enum ClipError: LocalizedError {
  case message(String)

  var errorDescription: String? {
    switch self {
    case .message(let message): return message
    }
  }
}
