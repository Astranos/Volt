@preconcurrency import AVFoundation
import AVFAudio
import AudioToolbox
import CoreImage
import CoreImage.CIFilterBuiltins
import ImageIO
import Speech
import SwiftUI
import UIKit
import UniformTypeIdentifiers
@preconcurrency import Vision
import VisionKit

private let signalBaseURL = URL(string: "https://scanner-signal.vercel.app/api/signal")!
private let validModes: Set<String> = ["ocr", "barcode", "photo", "dictation"]
private let clipZoomStops: [CGFloat] = [1, 1.5, 2, 2.5, 3, 3.5, 4]

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
    case .photo: return "Photos"
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
  @Published var mode: ClipMode = .barcode
  @Published var sessionId: String?
  @Published var status = "Scan the Chrome QR to pair"
  @Published var error: String?
  @Published var isPairing = true
  @Published var isSending = false
  @Published var lastText = ""
  @Published var barcodeCandidate: BarcodeCandidate?
  @Published var torchEnabled = false
  @Published var zoomFactor: CGFloat = 1
  @Published var autoSendBarcode = false
  @Published var fullFrameScan = false
  @Published var insertIntoCursor = true
  @Published var dictationAddsPunctuation = true
  @Published var dictationRunning = false
  @Published var dictationPressActive = false
  @Published var dictationTranscript = ""
  @Published var textCapture: TextCapture?
  @Published var textCaptureShowsCleanedImage = false
  @Published var isExtractingText = false
  @Published var cursorTargetName = "Chrome"

  let camera = ClipCamera()
  let dictation = ClipDictation()
  private let zoomHaptic = UISelectionFeedbackGenerator()
  private let impactHaptic = UIImpactFeedbackGenerator(style: .light)
  private let notificationHaptic = UINotificationFeedbackGenerator()
  private var pasteboardChangeCount = UIPasteboard.general.changeCount
  private var barcodeCandidateClearTask: Task<Void, Never>?
  private var barcodeCandidateSignature: String?
  private var transientStatusTask: Task<Void, Never>?
  private var dictationPressBlockedUntilRelease = false

  init() {
    zoomHaptic.prepare()
    impactHaptic.prepare()
    notificationHaptic.prepare()

    NotificationCenter.default.addObserver(
      self,
      selector: #selector(handlePasteboardChange),
      name: UIPasteboard.changedNotification,
      object: UIPasteboard.general
    )

    camera.onBarcode = { [weak self] candidate in
      Task { @MainActor in
        guard let self else { return }
        self.barcodeCandidateClearTask?.cancel()
        if self.isPairing {
          self.barcodeCandidate = candidate
          self.handlePairingCandidate(candidate)
          return
        }
        let signature = "\(candidate.format):\(candidate.value)"
        if self.barcodeCandidateSignature != signature {
          self.barcodeCandidateSignature = signature
          self.barcodeCandidate = candidate
          self.status = self.barcodeStatusMessage(for: candidate)
        }
        if self.autoSendBarcode {
          await self.sendBarcode(candidate, userInitiated: false)
        }
      }
    }
    camera.onBarcodeLost = { [weak self] in
      Task { @MainActor in
        self?.scheduleBarcodeCandidateClear(after: 0.35)
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
        self.status = "Release to send"
      }
    }
  }

  deinit {
    barcodeCandidateClearTask?.cancel()
    transientStatusTask?.cancel()
    NotificationCenter.default.removeObserver(self)
  }

  func handle(activity: NSUserActivity) {
    guard let url = activity.webpageURL else { return }
    handle(url: url)
  }

  func handle(url: URL) {
    guard let invocation = parseInvocation(url: url) else {
      beginPairing()
      return
    }

    mode = invocation.mode
    sessionId = invocation.sessionId
    isPairing = false
    error = nil
    status = "Paired with Chrome"
    Task { await connect() }
  }

  func beginPairing() {
    stopMode()
    isPairing = true
    mode = .barcode
    sessionId = nil
    barcodeCandidate = nil
    barcodeCandidateSignature = nil
    zoomFactor = 1
    torchEnabled = false
    fullFrameScan = false
    cursorTargetName = "Chrome"
    error = nil
    status = "Scan the Chrome QR to pair"
    clearTextCapture()
    startMode()
  }

  func unpair() {
    beginPairing()
  }

  func selectMode(_ nextMode: ClipMode) {
    guard mode != nextMode else { return }
    let previousMode = mode
    selectionFeedback()
    if previousMode == .dictation || nextMode == .dictation || textCapture != nil || isExtractingText {
      stopMode()
    }
    mode = nextMode
    barcodeCandidate = nil
    barcodeCandidateSignature = nil
    error = nil
    if nextMode != .ocr {
      clearTextCapture()
    }
    if sessionId == nil {
      status = nextMode == .barcode ? "Scan the Chrome QR to pair" : "Pair from Chrome to send results"
    } else {
      status = defaultHintStatus()
    }
    startMode()
  }

  private func handlePairingCandidate(_ candidate: BarcodeCandidate) {
    guard let url = URL(string: candidate.value), parseInvocation(url: url) != nil else {
      status = candidate.format == "qr" ? "That QR is not a Volt Chrome pairing code" : "Point at the Chrome QR"
      return
    }
    barcodeCandidateClearTask?.cancel()
    barcodeCandidate = nil
    status = "Pairing with Chrome"
    handle(url: url)
  }

  func connect() async {
    guard let sessionId else { return }
    do {
      _ = try await postJSON(path: "\(sessionId)/connect", body: [:])
      await refreshSessionTarget()
    } catch {
      if let httpError = error as? ClipHTTPStatusError, httpError.statusCode == 404 {
        do {
          try await repairRelaySession(mode: mode)
          _ = try await postJSON(path: "\(sessionId)/connect", body: [:])
          await refreshSessionTarget()
          return
        } catch {}
      }
      self.error = "Chrome session is unavailable. Reopen the QR code."
    }
  }

  func startMode() {
    error = nil
    switch mode {
    case .ocr, .photo, .barcode:
      guard !isExtractingText, textCapture == nil else {
        camera.stop()
        return
      }
      camera.start()
      camera.setMode(isPairing ? .barcode : mode)
      camera.setBarcodeFullFrame(isPairing || fullFrameScan)
      camera.setTorch(torchEnabled)
      camera.setZoom(zoomFactor)
    case .dictation:
      if sessionId == nil || isPairing {
        camera.start()
        camera.setMode(.barcode)
        camera.setBarcodeFullFrame(true)
        camera.setTorch(torchEnabled)
        camera.setZoom(zoomFactor)
      } else {
        camera.stop()
        Task {
          try? await dictation.prepareForUse()
        }
      }
    }
  }

  func stopMode() {
    camera.stop()
    if mode == .dictation {
      dictation.stop()
      dictationRunning = false
      dictationPressActive = false
    }
  }

  func capturePrimary() {
    impactFeedback()
    switch mode {
    case .ocr:
      if textCapture != nil {
        clearTextCapture()
        status = "Ready"
        return
      }
      playCaptureSound()
      status = "Capturing text"
      camera.capturePhoto { [weak self] result in
        Task { @MainActor in
          guard let self else { return }
          switch result {
          case .success(let photo):
            self.isExtractingText = true
            self.camera.stop()
            await self.prepareTextCapture(photo: photo)
          case .failure(let error):
            self.error = error.localizedDescription
          }
        }
      }
    case .photo:
      playCaptureSound()
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
        playSendSound()
        Task { await sendBarcode(barcodeCandidate, userInitiated: true) }
      }
    case .dictation:
      break
    }
  }

  func beginDictationPress() {
    guard mode == .dictation, !dictationPressActive else { return }
    guard !dictationPressBlockedUntilRelease else { return }
    guard sessionId != nil else {
      dictationPressBlockedUntilRelease = true
      error = "Pair with Chrome before dictating."
      status = "Scan the Chrome QR to pair first"
      return
    }
    dictationPressActive = true
    impactFeedback()
    AudioServicesPlaySystemSound(1113)
    Task { await startDictation() }
  }

  func endDictationPress() {
    if dictationPressBlockedUntilRelease {
      dictationPressBlockedUntilRelease = false
      return
    }
    guard mode == .dictation, dictationPressActive else { return }
    dictationPressActive = false
    AudioServicesPlaySystemSound(1114)
    notificationHaptic.notificationOccurred(.success)
    notificationHaptic.prepare()

    Task { @MainActor in
      status = "Finishing dictation"
      let completedText = await dictation.finishAndStop(tailDuration: 1.25, timeout: 2.0)
      dictationRunning = false
      let finalText = (completedText ?? dictationTranscript).trimmingCharacters(in: .whitespacesAndNewlines)
      guard !finalText.isEmpty else {
        status = "No dictation captured"
        notificationHaptic.notificationOccurred(.warning)
        notificationHaptic.prepare()
        return
      }
      dictationTranscript = finalText
      await sendDictation(text: finalText, phase: "final", background: false)
    }
  }

  func startDictation() async {
    guard let sessionId else {
      dictationPressActive = false
      dictationPressBlockedUntilRelease = true
      error = "Pair with Chrome before dictating."
      return
    }
    do {
      dictationTranscript = ""
      status = "Listening"
      try await dictation.start(sessionId: sessionId, addsPunctuation: dictationAddsPunctuation)
      guard dictationPressActive else {
        dictation.stop()
        return
      }
      dictationRunning = true
      status = "Listening"
    } catch {
      dictationRunning = false
      dictationPressActive = false
      dictationPressBlockedUntilRelease = true
      self.error = error.localizedDescription
    }
  }

  func setTorch(_ enabled: Bool) {
    selectionFeedback()
    torchEnabled = enabled
    camera.setTorch(enabled)
  }

  func setZoom(_ factor: CGFloat) {
    zoomFactor = factor
    camera.setZoom(factor)
  }

  func setZoomStop(_ factor: CGFloat, haptic: Bool = true) {
    let snapped = nearestZoomStop(to: factor)
    if haptic && abs(snapped - zoomFactor) > 0.01 {
      zoomHaptic.selectionChanged()
      zoomHaptic.prepare()
    }
    setZoom(snapped)
  }

  func setFullFrameScan(_ enabled: Bool) {
    selectionFeedback()
    fullFrameScan = enabled
    camera.setBarcodeFullFrame(enabled || isPairing)
  }

  func clearTextCapture() {
    textCapture = nil
    textCaptureShowsCleanedImage = false
    lastText = ""
    isExtractingText = false
    if mode == .ocr {
      startMode()
    }
  }

  private func scheduleBarcodeCandidateClear(after delay: TimeInterval) {
    barcodeCandidateClearTask?.cancel()
    barcodeCandidateClearTask = Task { @MainActor in
      let nanoseconds = UInt64(max(0, delay) * 1_000_000_000)
      try? await Task.sleep(nanoseconds: nanoseconds)
      guard !Task.isCancelled else { return }
      barcodeCandidate = nil
      barcodeCandidateSignature = nil
    }
  }

  private func prepareTextCapture(photo: CapturedPhoto) async {
    defer {
      isExtractingText = false
      if mode == .ocr, textCapture == nil {
        startMode()
      }
    }
    do {
      let cleaned = try await TextImageEnhancer.cleanedImage(from: photo.image)
      let text = try await TextRecognizer.recognize(cgImage: cleaned.cgImage)
      lastText = text
      textCapture = TextCapture(originalImage: photo.uiImage, cleanedImage: cleaned.uiImage)
      textCaptureShowsCleanedImage = false
      pasteboardChangeCount = UIPasteboard.general.changeCount
      guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
        status = "No text found"
        return
      }
      status = "Select text and copy"
      notificationHaptic.notificationOccurred(.success)
      notificationHaptic.prepare()
      Task { @MainActor in
        try? await Task.sleep(nanoseconds: 360_000_000)
        guard self.textCapture != nil else { return }
        withAnimation(.easeInOut(duration: 0.36)) {
          self.textCaptureShowsCleanedImage = true
        }
      }
    } catch {
      self.error = error.localizedDescription
    }
  }

  @objc private func handlePasteboardChange() {
    guard textCapture != nil else { return }
    guard UIPasteboard.general.changeCount != pasteboardChangeCount else { return }
    pasteboardChangeCount = UIPasteboard.general.changeCount
    let copiedText = UIPasteboard.general.string?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    guard !copiedText.isEmpty else { return }
    Task { @MainActor in
      await sendCopiedText(copiedText)
    }
  }

  private func sendCopiedText(_ text: String) async {
    do {
      try await sendResult(mode: .ocr, message: [
        "barcode": text,
        "format": "live-text",
        "insertIntoCursor": insertIntoCursor,
        "kind": "text",
        "scannedAt": ISO8601DateFormatter().string(from: Date()),
      ])
      showTransientStatus("Copied text sent to Chrome")
      notificationHaptic.notificationOccurred(.success)
      notificationHaptic.prepare()
    } catch {
      self.error = error.localizedDescription
      notificationHaptic.notificationOccurred(.warning)
      notificationHaptic.prepare()
    }
  }

  private func playCaptureSound() {
    AudioServicesPlaySystemSound(1108)
  }

  private func playSendSound() {
    AudioServicesPlaySystemSound(1004)
  }

  private func impactFeedback() {
    impactHaptic.impactOccurred(intensity: 0.55)
    impactHaptic.prepare()
  }

  private func selectionFeedback() {
    zoomHaptic.selectionChanged()
    zoomHaptic.prepare()
  }

  private func sendBarcode(_ candidate: BarcodeCandidate, userInitiated: Bool) async {
    guard !isSending else { return }
    do {
      if userInitiated {
        status = "Sending barcode"
      }
      try await sendResult(mode: .barcode, message: [
        "barcode": candidate.value,
        "format": candidate.format,
        "insertIntoCursor": true,
        "kind": "barcode",
        "scannedAt": ISO8601DateFormatter().string(from: Date()),
      ])
      if userInitiated {
        showTransientStatus("Sent to Chrome")
        scheduleBarcodeCandidateClear(after: 0.45)
      } else {
        status = barcodeStatusMessage(for: candidate)
      }
    } catch {
      self.error = error.localizedDescription
    }
  }

  private func barcodeStatusMessage(for candidate: BarcodeCandidate) -> String {
    let value = candidate.value.trimmingCharacters(in: .whitespacesAndNewlines)
    let preview = value.count > 72 ? "\(value.prefix(69))..." : value
    return preview.isEmpty ? "Barcode in reader" : "\(candidate.format.uppercased()): \(preview)"
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
        showTransientStatus("Sent to Chrome")
      }
    } catch {
      if !background {
        self.error = error.localizedDescription
      }
    }
  }

  private func sendPhoto(_ photo: CapturedPhoto) async {
    do {
      let squarePhoto = try photo.squareCropped()
      let base64 = squarePhoto.data.base64EncodedString()
      try await sendResult(mode: .photo, message: [
        "kind": "photo",
        "id": "clip-photo-\(Int(Date().timeIntervalSince1970 * 1000))",
        "name": "volt-photo.jpg",
        "mimeType": "image/jpeg",
        "dataUrl": "data:image/jpeg;base64,\(base64)",
        "size": squarePhoto.data.count,
        "width": Int(squarePhoto.size.width),
        "height": Int(squarePhoto.size.height),
        "capturedAt": ISO8601DateFormatter().string(from: Date()),
      ])
      showTransientStatus("Sent to Chrome")
    } catch {
      self.error = error.localizedDescription
    }
  }

  private func showTransientStatus(_ message: String, duration: TimeInterval = 1.45) {
    transientStatusTask?.cancel()
    status = message
    transientStatusTask = Task { @MainActor in
      let nanoseconds = UInt64(max(0, duration) * 1_000_000_000)
      try? await Task.sleep(nanoseconds: nanoseconds)
      guard !Task.isCancelled, self.status == message else { return }
      self.status = self.defaultHintStatus()
    }
  }

  private func defaultHintStatus() -> String {
    if sessionId == nil || isPairing {
      return mode == .barcode ? "Scan the Chrome QR to pair" : "Pair from Chrome to send results"
    }
    if mode == .barcode, let barcodeCandidate {
      return barcodeStatusMessage(for: barcodeCandidate)
    }
    if mode == .ocr, textCapture != nil {
      return "Select text and copy"
    }
    switch mode {
    case .ocr:
      return "Capture text to send"
    case .barcode:
      return "Place a barcode in the reader"
    case .photo:
      return "Capture a square photo"
    case .dictation:
      return "Hold microphone to start"
    }
  }

  private func sendResult(mode: ClipMode, message: [String: Any], background: Bool = false) async throws {
    guard let sessionId else {
      throw ClipError.message("Scan the Chrome QR to pair first.")
    }

    if !background {
      isSending = true
    }
    defer {
      if !background {
        isSending = false
      }
    }

    let body: [String: Any] = [
      "id": "\(Int(Date().timeIntervalSince1970 * 1000))-\(UUID().uuidString.prefix(8))",
      "mode": mode.rawValue,
      "message": message,
    ]

    do {
      _ = try await postJSON(path: "\(sessionId)/result", body: body)
    } catch {
      guard let httpError = error as? ClipHTTPStatusError, httpError.shouldRepairRelay else {
        throw error
      }
      try await repairRelaySession(mode: mode)
      _ = try await postJSON(path: "\(sessionId)/result", body: body)
    }
  }

  private func repairRelaySession(mode: ClipMode) async throws {
    guard let sessionId else { return }
    _ = try await postJSON(path: sessionId, body: [
      "relay": true,
      "mode": mode.rawValue,
    ])
  }

  private func refreshSessionTarget() async {
    guard let sessionId else { return }
    do {
      let session = try await getJSON(path: sessionId)
      if let target = session["target"] as? [String: Any] {
        cursorTargetName = humanizedTargetName(from: target)
      }
    } catch {
      cursorTargetName = "Chrome"
    }
  }

  private func humanizedTargetName(from target: [String: Any]) -> String {
    if
      let urlString = target["url"] as? String,
      let host = URL(string: urlString)?.host?.replacingOccurrences(of: "^www\\.", with: "", options: .regularExpression),
      !host.isEmpty
    {
      return host
    }
    if let title = target["tabTitle"] as? String, !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
      return title
    }
    if let browser = target["browser"] as? String, !browser.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
      return browser
    }
    return "Chrome"
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
      let message = signalErrorMessage(from: data)
      print("[VoltSignal] POST \(path) returned \(http.statusCode): \(message ?? "No response body")")
      throw ClipHTTPStatusError(statusCode: http.statusCode, message: message)
    }
    return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
  }

  private func getJSON(path: String) async throws -> [String: Any] {
    let url = signalBaseURL.appendingPathComponent(path)
    var request = URLRequest(url: url)
    request.httpMethod = "GET"
    let (data, response) = try await URLSession.shared.data(for: request)
    guard let http = response as? HTTPURLResponse else {
      throw ClipError.message("Chrome session did not respond.")
    }
    guard (200..<300).contains(http.statusCode) else {
      let message = signalErrorMessage(from: data)
      print("[VoltSignal] GET \(path) returned \(http.statusCode): \(message ?? "No response body")")
      throw ClipHTTPStatusError(statusCode: http.statusCode, message: message)
    }
    return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
  }

  private func signalErrorMessage(from data: Data) -> String? {
    guard !data.isEmpty else { return nil }
    if
      let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let error = object["error"] as? String,
      !error.isEmpty
    {
      return error
    }
    let text = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
    return text?.isEmpty == false ? text : nil
  }

  private func parseInvocation(url: URL) -> ClipInvocation? {
    guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
    let parts = components.path.split(separator: "/").map(String.init)
    let clipIndex = parts.firstIndex(of: "clip")
    let pathMode = clipIndex.flatMap { parts.indices.contains($0 + 1) ? parts[$0 + 1] : nil } ?? parts.first
    let query = components.queryItems ?? []
    let queryMode = query.first(where: { $0.name == "mode" })?.value
    let modeValue = queryMode ?? (validModes.contains(pathMode ?? "") ? pathMode : nil)
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
      ViewfinderBackground(model: model)

      VStack(spacing: 0) {
        topHintRow
        Spacer()
      }
      .padding(.horizontal, 18)
      .padding(.top, 16)

      VStack(spacing: 0) {
        Spacer()
        shutterButton
          .padding(.bottom, 16)
        bottomControlsGlass
      }
      .padding(.horizontal, 18)
      .padding(.bottom, 18)
    }
    .ignoresSafeArea(.container, edges: .bottom)
    .background(Color.black)
    .foregroundStyle(.white)
    .onAppear { model.startMode() }
    .onChange(of: model.mode) { _ in model.startMode() }
  }

  private var topHintRow: some View {
    StatusGlassRow(
      message: statusMessage,
      isError: model.error != nil,
      symbol: statusSymbol
    )
    .frame(maxWidth: 380)
    .frame(maxWidth: .infinity, alignment: .center)
  }

  private var controlsPanel: some View {
    VStack(spacing: 10) {
      if model.mode != .dictation {
        ZoomSlider(factor: model.zoomFactor) { factor in
          model.setZoom(factor)
        }
        .transition(.opacity.combined(with: .move(edge: .top)))
      } else {
        dictationPreview
          .transition(.opacity.combined(with: .move(edge: .top)))
      }
      secondaryControls
    }
    .padding(.horizontal, 16)
    .padding(.top, 30)
    .padding(.bottom, 20)
    .frame(maxWidth: .infinity)
  }

  private var bottomControlsGlass: some View {
    let shape = UnevenRoundedRectangle(
      topLeadingRadius: 52,
      bottomLeadingRadius: 48,
      bottomTrailingRadius: 48,
      topTrailingRadius: 52,
      style: .continuous
    )

    return VStack(spacing: 0) {
      if !model.isPairing {
        HStack {
          Spacer()
          UnpairGlassButton(action: model.unpair)
        }
        .padding(.horizontal, 16)
        .padding(.top, 12)
        .padding(.bottom, -2)
      }
      controlsPanel
      modePicker
        .padding(.horizontal, 2)
        .padding(.top, 6)
        .padding(.bottom, 14)
    }
    .frame(maxWidth: .infinity)
    .background {
      ConcentricLiquidDrawer(cornerRadius: 52)
    }
    .clipShape(shape)
    .animation(.smooth(duration: 0.32), value: model.mode)
    .padding(.horizontal, -2)
  }

  private var secondaryControls: some View {
    HStack(spacing: 14) {
      GlassToggleControl(
        title: "Type to cursor",
        systemImage: "text.cursor",
        isOn: model.insertIntoCursor
      ) {
        model.insertIntoCursor.toggle()
      }

      if model.mode != .dictation {
        GlassToggleControl(
          title: "Light",
          systemImage: model.torchEnabled ? "flashlight.on.fill" : "flashlight.off.fill",
          isOn: model.torchEnabled
        ) {
          model.setTorch(!model.torchEnabled)
        }
      } else {
        GlassToggleControl(
          title: "Punctuation",
          systemImage: "textformat",
          isOn: model.dictationAddsPunctuation
        ) {
          model.dictationAddsPunctuation.toggle()
        }
      }
    }
  }

  private var dictationPreview: some View {
    Text(dictationDrawerText)
      .font(.system(size: 16, weight: .semibold))
      .foregroundStyle(.primary)
      .frame(maxWidth: .infinity, minHeight: 56, alignment: .center)
      .multilineTextAlignment(.center)
      .lineLimit(2)
  }

  private var dictationDrawerText: String {
    "Writing to \(model.cursorTargetName)"
  }

  private var shutterButton: some View {
    Button(action: model.mode == .dictation ? {} : model.capturePrimary) {
      Image(systemName: primarySymbol)
        .font(.system(size: 36, weight: .bold))
        .frame(width: 94, height: 94)
        .contentShape(Circle())
        .overlay {
          if model.mode == .dictation {
            Circle()
              .stroke(.primary.opacity(model.dictationPressActive ? 0.34 : 0.14), lineWidth: model.dictationPressActive ? 5 : 2)
              .padding(model.dictationPressActive ? 7 : 10)
          }
        }
        .scaleEffect(model.dictationPressActive ? 0.94 : 1)
        .animation(.easeOut(duration: 0.10), value: model.dictationPressActive)
    }
    .simultaneousGesture(
      DragGesture(minimumDistance: 0)
        .onChanged { _ in
          if model.mode == .dictation {
            model.beginDictationPress()
          }
        }
        .onEnded { _ in
          if model.mode == .dictation {
            model.endDictationPress()
          }
        }
    )
    .disabled(model.isSending && model.mode != .dictation)
    .buttonStyle(.plain)
    .nativeClearGlassBackground(Circle())
    .clipShape(Circle())
    .accessibilityLabel(model.mode == .dictation ? "Hold to dictate" : model.mode == .ocr && model.textCapture != nil ? "Retake text capture" : "Capture")
  }

  private var modePicker: some View {
    GroupedGlassModePicker(selectedMode: model.mode) { mode in
      model.selectMode(mode)
    }
    .frame(maxWidth: 560)
    .frame(maxWidth: .infinity)
    .padding(.trailing, model.isPairing ? 0 : 92)
    .accessibilityLabel("Mode")
  }

  private var primarySymbol: String {
    switch model.mode {
    case .ocr: return model.textCapture == nil ? "text.viewfinder" : "arrow.counterclockwise"
    case .barcode: return "paperplane.fill"
    case .photo: return "camera.fill"
    case .dictation: return model.dictationRunning ? "stop.fill" : "mic.fill"
    }
  }

  private var statusSymbol: String {
    if model.error != nil {
      return "exclamationmark.triangle.fill"
    }
    if model.mode == .barcode, model.barcodeCandidate != nil {
      return "barcode.viewfinder"
    }
    if model.isSending {
      return "paperplane.fill"
    }
    return "info.circle.fill"
  }

  private var statusMessage: String {
    if let error = model.error {
      return error
    }
    guard model.mode == .dictation else {
      return model.status
    }
    if model.isSending {
      return "Sending dictation"
    }
    if model.dictationPressActive || model.dictationRunning {
      return "Listening"
    }
    return "Hold microphone to start"
  }
}

private struct StatusGlassRow: View {
  let message: String
  let isError: Bool
  let symbol: String

  var body: some View {
    HStack(spacing: 10) {
      Image(systemName: symbol)
        .font(.system(size: 16, weight: .semibold))
      Text(displayMessage)
        .font(.system(size: 16, weight: .semibold, design: .rounded))
        .lineLimit(2)
        .minimumScaleFactor(0.72)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
    .foregroundStyle(isError ? .red.opacity(0.95) : .white.opacity(0.88))
    .padding(.horizontal, 16)
    .padding(.vertical, 12)
    .frame(maxWidth: .infinity, minHeight: 54, alignment: .leading)
    .nativeClearGlassBackground(RoundedRectangle(cornerRadius: 27, style: .continuous))
    .animation(.smooth(duration: 0.22), value: displayMessage)
    .animation(.smooth(duration: 0.22), value: isError)
    .accessibilityLabel(displayMessage)
  }

  private var displayMessage: String {
    let trimmed = message.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? "Ready" : trimmed
  }
}

private struct GroupedGlassModePicker: View {
  let selectedMode: ClipMode
  let onSelect: (ClipMode) -> Void
  @GestureState private var dragLocationX: CGFloat?

  private var selectedIndex: Int {
    ClipMode.allCases.firstIndex(of: selectedMode) ?? 0
  }

  var body: some View {
    GeometryReader { proxy in
      let modes = ClipMode.allCases
      let outerInset: CGFloat = 7
      let count = max(CGFloat(modes.count), 1)
      let groupWidth = max(proxy.size.width - outerInset * 2, 1)
      let segmentWidth = groupWidth / count
      let selectedCenterX = outerInset + segmentWidth * (CGFloat(selectedIndex) + 0.5)
      let minCenterX = outerInset + segmentWidth * 0.5
      let maxCenterX = outerInset + segmentWidth * (count - 0.5)
      let activeCenterX = min(max(dragLocationX ?? selectedCenterX, minCenterX), maxCenterX)
      let isDragging = dragLocationX != nil
      let grabberWidth = max(segmentWidth * (isDragging ? 1.06 : 0.96), 86)
      let grabberHeight: CGFloat = isDragging ? 68 : 62
      let grabberRadius: CGFloat = isDragging ? 32 : 30
      let grabberOffset = activeCenterX - grabberWidth / 2

      ZStack(alignment: .leading) {
        RoundedRectangle(cornerRadius: grabberRadius, style: .continuous)
          .fill(Color.white.opacity(isDragging ? 0.20 : 0.14))
          .nativeClearGlassBackground(RoundedRectangle(cornerRadius: grabberRadius, style: .continuous))
          .overlay {
            RoundedRectangle(cornerRadius: grabberRadius, style: .continuous)
              .stroke(Color.white.opacity(isDragging ? 0.72 : 0.58), lineWidth: isDragging ? 1.6 : 1.2)
          }
          .shadow(color: Color.white.opacity(isDragging ? 0.26 : 0.18), radius: isDragging ? 18 : 12, y: 1)
          .shadow(color: Color.black.opacity(0.18), radius: isDragging ? 12 : 8, y: 4)
          .frame(width: grabberWidth, height: grabberHeight)
          .offset(x: grabberOffset)
          .animation(.interactiveSpring(response: 0.28, dampingFraction: 0.72), value: selectedIndex)
          .animation(.interactiveSpring(response: 0.22, dampingFraction: 0.76), value: isDragging)

        HStack(spacing: 0) {
          ForEach(modes) { mode in
            GlassModeTabButton(
              mode: mode,
              isSelected: selectedMode == mode,
              action: { onSelect(mode) }
            )
            .frame(width: segmentWidth)
          }
        }
        .padding(.horizontal, outerInset)
        .animation(nil, value: selectedIndex)
      }
      .contentShape(Rectangle())
      .simultaneousGesture(
        DragGesture(minimumDistance: 0)
          .updating($dragLocationX) { value, state, _ in
            state = value.location.x
          }
          .onChanged { value in
            let relativeX = min(max(value.location.x - outerInset, 0), groupWidth - 1)
            let index = min(max(Int(relativeX / segmentWidth), 0), modes.count - 1)
            let mode = modes[index]
            if mode != selectedMode {
              onSelect(mode)
            }
          }
      )
    }
    .frame(maxWidth: .infinity)
    .frame(height: 76)
  }
}

private struct GlassModeTabButton: View {
  let mode: ClipMode
  let isSelected: Bool
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      VStack(spacing: 4) {
        Image(systemName: mode.symbol)
          .font(.system(size: 20, weight: .semibold))
        Text(mode.title)
          .font(.system(size: 10, weight: .bold, design: .rounded))
          .lineLimit(1)
          .minimumScaleFactor(0.75)
      }
      .frame(maxWidth: .infinity, minHeight: 60)
      .foregroundStyle(isSelected ? .white : .white.opacity(0.74))
      .contentShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
    }
    .buttonStyle(.plain)
    .accessibilityLabel(mode.title)
    .accessibilityAddTraits(isSelected ? .isSelected : [])
  }
}

private enum NativeModeTab {
  static func items() -> [UITabBarItem] {
    ClipMode.allCases.enumerated().map { index, mode in
      let item = UITabBarItem(title: mode.title, image: UIImage(systemName: mode.symbol), tag: index)
      item.accessibilityLabel = mode.title
      return item
    }
  }
}

private struct ConcentricLiquidDrawer: View {
  let cornerRadius: CGFloat

  var body: some View {
    let bottomRadius = max(44, cornerRadius - 4)
    let shape = UnevenRoundedRectangle(
      topLeadingRadius: cornerRadius,
      bottomLeadingRadius: bottomRadius,
      bottomTrailingRadius: bottomRadius,
      topTrailingRadius: cornerRadius,
      style: .continuous
    )

    Group {
      if #available(iOS 26.0, *) {
        Color.clear
          .glassEffect(.clear, in: shape)
      } else {
        shape.fill(.ultraThinMaterial)
      }
    }
    .overlay {
      shape.stroke(Color(uiColor: .separator).opacity(0.24), lineWidth: 1)
    }
    .shadow(color: .black.opacity(0.14), radius: 12, y: 5)
  }
}

private struct NativeLiquidModePicker: UIViewRepresentable {
  let selectedMode: ClipMode
  let onSelect: (ClipMode) -> Void

  func makeCoordinator() -> Coordinator {
    Coordinator(onSelect: onSelect)
  }

  func makeUIView(context: Context) -> UITabBar {
    let tabBar = UITabBar()
    tabBar.delegate = context.coordinator
    tabBar.items = NativeModeTab.items()
    tabBar.itemPositioning = .fill
    tabBar.isTranslucent = true
    tabBar.backgroundImage = UIImage()
    tabBar.shadowImage = UIImage()
    tabBar.backgroundColor = .clear
    let appearance = UITabBarAppearance()
    appearance.configureWithTransparentBackground()
    appearance.backgroundEffect = nil
    appearance.backgroundColor = .clear
    appearance.shadowColor = .clear
    tabBar.standardAppearance = appearance
    tabBar.scrollEdgeAppearance = appearance
    tabBar.selectedItem = tabBar.items?[selectedIndex]
    return tabBar
  }

  func updateUIView(_ tabBar: UITabBar, context: Context) {
    context.coordinator.onSelect = onSelect
    if tabBar.items?.count != ClipMode.allCases.count {
      tabBar.items = NativeModeTab.items()
    }
    tabBar.selectedItem = tabBar.items?.first(where: { $0.tag == selectedIndex })
  }

  private var selectedIndex: Int {
    ClipMode.allCases.firstIndex(of: selectedMode) ?? 0
  }

  final class Coordinator: NSObject, UITabBarDelegate {
    var onSelect: (ClipMode) -> Void

    init(onSelect: @escaping (ClipMode) -> Void) {
      self.onSelect = onSelect
    }

    func tabBar(_ tabBar: UITabBar, didSelect item: UITabBarItem) {
      guard ClipMode.allCases.indices.contains(item.tag) else { return }
      onSelect(ClipMode.allCases[item.tag])
    }
  }
}

private struct UnpairGlassButton: View {
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      HStack(spacing: 7) {
        Image(systemName: "link.badge.minus")
          .font(.system(size: 14, weight: .bold))
        Text("Unpair")
          .font(.system(size: 12, weight: .bold, design: .rounded))
          .lineLimit(1)
          .minimumScaleFactor(0.8)
      }
      .foregroundStyle(.white)
      .padding(.horizontal, 13)
      .frame(height: 34)
      .contentShape(Capsule())
    }
    .buttonStyle(.plain)
    .nativeClearGlassBackground(Capsule())
    .background {
      Capsule()
        .fill(Color.red.opacity(0.34))
    }
    .overlay {
      Capsule()
        .stroke(Color.red.opacity(0.58), lineWidth: 1.2)
    }
    .shadow(color: Color.red.opacity(0.22), radius: 10, y: 3)
    .accessibilityLabel("Unpair from Chrome")
  }
}

private struct GlassToggleControl: View {
  let title: String
  let systemImage: String
  let isOn: Bool
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      Label(title, systemImage: systemImage)
        .font(.system(size: 20, weight: .semibold, design: .rounded))
        .lineLimit(1)
        .minimumScaleFactor(0.72)
        .frame(maxWidth: .infinity, minHeight: 58)
        .padding(.horizontal, 18)
        .foregroundStyle(isOn ? .white : .white.opacity(0.62))
        .contentShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
    }
    .buttonStyle(.plain)
    .nativeClearGlassBackground(RoundedRectangle(cornerRadius: 28, style: .continuous))
    .background {
      RoundedRectangle(cornerRadius: 28, style: .continuous)
        .fill(isOn ? Color.white.opacity(0.18) : Color.black.opacity(0.06))
    }
    .overlay {
      RoundedRectangle(cornerRadius: 28, style: .continuous)
        .stroke(isOn ? Color.white.opacity(0.64) : Color.white.opacity(0.20), lineWidth: isOn ? 1.8 : 1)
    }
    .shadow(color: isOn ? .white.opacity(0.12) : .clear, radius: 10, y: 1)
    .accessibilityAddTraits(isOn ? .isSelected : [])
  }
}

private extension View {
  @ViewBuilder
  func nativeGlassControlStyle() -> some View {
    if #available(iOS 26.0, *) {
      self.buttonStyle(.glass(.clear.interactive()))
    } else {
      self.buttonStyle(.bordered)
    }
  }

  @ViewBuilder
  func nativeClearGlassBackground<S: Shape>(_ shape: S) -> some View {
    if #available(iOS 26.0, *) {
      self.glassEffect(.clear.interactive(), in: shape)
    } else {
      self.background(.ultraThinMaterial, in: shape)
    }
  }
}

private struct ZoomSlider: View {
  let factor: CGFloat
  let onChange: (CGFloat) -> Void

  var body: some View {
    VStack(spacing: 8) {
      HStack(spacing: 10) {
        Image(systemName: "minus.magnifyingglass")
          .font(.system(size: 15, weight: .semibold))
          .foregroundStyle(.secondary)
        Slider(value: Binding(get: {
          Double(factor)
        }, set: { value in
          onChange(CGFloat(value))
        }), in: 1...4)
        .tint(.white.opacity(0.92))
        Image(systemName: "plus.magnifyingglass")
          .font(.system(size: 15, weight: .semibold))
          .foregroundStyle(.secondary)
      }
      .padding(.horizontal, 4)

      HStack {
        Text("Zoom")
          .font(.system(size: 12, weight: .bold))
          .foregroundStyle(.secondary)
        Spacer()
        Text(formatZoom(factor))
          .font(.footnote.weight(.semibold))
          .padding(.horizontal, 10)
          .padding(.vertical, 4)
          .background(.thinMaterial, in: Capsule())
      }
    }
    .frame(minHeight: 56)
    .accessibilityLabel("Zoom")
    .accessibilityValue(formatZoom(factor))
  }
}

private struct ViewfinderBackground: View {
  @ObservedObject var model: ClipModel

  var body: some View {
    ZStack {
      if showsCameraFeed {
        CameraPreview(camera: model.camera)
          .ignoresSafeArea()
      } else {
        modeBackdrop
      }

      if model.mode == .ocr, let textCapture = model.textCapture {
        TextCaptureReview(
          capture: textCapture,
          showsCleanedImage: model.textCaptureShowsCleanedImage
        )
        .ignoresSafeArea()
        .transition(.opacity)
      } else if model.mode == .ocr, model.isExtractingText {
        extractionBackdrop
      }

      if model.mode == .barcode || model.isPairing {
        BarcodeOverlay(candidate: model.barcodeCandidate)
          .ignoresSafeArea()
      }

      if model.mode == .barcode, !model.isPairing {
        BarcodeScanGuide(candidate: model.barcodeCandidate)
          .ignoresSafeArea()
      }

      if model.mode == .photo {
        PhotoSquareOverlay()
          .ignoresSafeArea()
      }

      if model.mode == .dictation, !showsCameraFeed {
        DictationLiveOverlay(text: model.dictationTranscript, isListening: model.dictationPressActive)
          .ignoresSafeArea()
      }
    }
  }

  private var showsCameraFeed: Bool {
    (model.mode != .dictation || model.sessionId == nil || model.isPairing) && !model.isExtractingText && model.textCapture == nil
  }

  private var modeBackdrop: some View {
    LinearGradient(
      colors: [
        .black,
        backdropAccent,
      ],
      startPoint: .top,
      endPoint: .bottom
    )
    .ignoresSafeArea()
    .overlay {
      Image(systemName: model.mode.symbol)
        .font(.system(size: 118, weight: .thin))
        .foregroundStyle(.white.opacity(0.14))
    }
  }

  private var extractionBackdrop: some View {
    VStack(spacing: 16) {
      ProgressView()
        .tint(.white)
      Text("Extracting text")
        .font(.system(size: 16, weight: .semibold))
        .foregroundStyle(.white.opacity(0.74))
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(.black.opacity(0.36))
    .ignoresSafeArea()
  }

  private var backdropAccent: Color {
    switch model.mode {
    case .ocr: return Color(red: 0.08, green: 0.13, blue: 0.16)
    case .barcode: return Color(red: 0.07, green: 0.15, blue: 0.12)
    case .photo: return Color(red: 0.13, green: 0.10, blue: 0.14)
    case .dictation: return Color(red: 0.10, green: 0.12, blue: 0.16)
    }
  }
}

private struct TextCapture {
  let originalImage: UIImage
  let cleanedImage: UIImage
}

private struct TextCaptureReview: UIViewRepresentable {
  let capture: TextCapture
  let showsCleanedImage: Bool

  func makeUIView(context: Context) -> LiveTextCaptureView {
    let view = LiveTextCaptureView()
    view.setCapture(capture, showsCleanedImage: showsCleanedImage, animated: false)
    return view
  }

  func updateUIView(_ uiView: LiveTextCaptureView, context: Context) {
    uiView.setCapture(capture, showsCleanedImage: showsCleanedImage, animated: true)
  }
}

private final class LiveTextCaptureView: UIView {
  private let imageView = UIImageView()
  private var analyzer: Any?
  private var interaction: Any?
  private var analysisTask: Task<Void, Never>?
  private var currentImageIdentifier = ""

  override init(frame: CGRect) {
    super.init(frame: frame)
    setup()
  }

  required init?(coder: NSCoder) {
    super.init(coder: coder)
    setup()
  }

  deinit {
    analysisTask?.cancel()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    imageView.frame = bounds
  }

  func setCapture(_ capture: TextCapture, showsCleanedImage: Bool, animated: Bool) {
    let image = showsCleanedImage ? capture.cleanedImage : capture.originalImage
    let identifier = "\(ObjectIdentifier(image))-\(showsCleanedImage)"
    guard identifier != currentImageIdentifier else { return }
    currentImageIdentifier = identifier

    if animated {
      UIView.transition(with: imageView, duration: 0.36, options: [.transitionCrossDissolve, .allowUserInteraction]) {
        self.imageView.image = image
      }
    } else {
      imageView.image = image
    }

    if showsCleanedImage {
      analyze(image)
    }
  }

  private func setup() {
    backgroundColor = .black
    clipsToBounds = true
    imageView.contentMode = .scaleAspectFill
    imageView.isUserInteractionEnabled = true
    addSubview(imageView)

    if #available(iOS 16.0, *) {
      let liveTextInteraction = ImageAnalysisInteraction()
      liveTextInteraction.preferredInteractionTypes = .textSelection
      liveTextInteraction.allowLongPressForDataDetectorsInTextMode = false
      imageView.addInteraction(liveTextInteraction)
      interaction = liveTextInteraction
      analyzer = ImageAnalyzer()
    }
  }

  private func analyze(_ image: UIImage) {
    guard #available(iOS 16.0, *) else { return }
    guard let analyzer = analyzer as? ImageAnalyzer, let interaction = interaction as? ImageAnalysisInteraction else { return }

    analysisTask?.cancel()
    analysisTask = Task {
      do {
        let analysis = try await analyzer.analyze(image, configuration: ImageAnalyzer.Configuration([.text]))
        await MainActor.run {
          guard !Task.isCancelled else { return }
          interaction.analysis = analysis
          interaction.preferredInteractionTypes = .textSelection
          interaction.allowLongPressForDataDetectorsInTextMode = false
        }
      } catch {
        await MainActor.run {
          interaction.analysis = nil
        }
      }
    }
  }
}

private struct CameraPreview: UIViewRepresentable {
  let camera: ClipCamera

  func makeUIView(context: Context) -> PreviewView {
    let view = PreviewView(camera: camera)
    view.previewLayer.session = camera.session
    camera.attachPreviewView(view)
    return view
  }

  func updateUIView(_ uiView: PreviewView, context: Context) {
    uiView.previewLayer.session = camera.session
    uiView.camera = camera
    camera.attachPreviewView(uiView)
  }
}

private final class PreviewView: UIView {
  override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
  var previewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
  weak var camera: ClipCamera?
  private let focusRing = UIView()

  init(camera: ClipCamera) {
    self.camera = camera
    super.init(frame: .zero)
    setup()
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
    camera?.updateRectOfInterest(from: previewLayer)
  }

  override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
    guard let point = touches.first?.location(in: self) else { return }
    let devicePoint = previewLayer.captureDevicePointConverted(fromLayerPoint: point)
    camera?.focus(at: devicePoint)
    showFocusRing(at: point)
  }

  private func setup() {
    previewLayer.videoGravity = .resizeAspectFill
    backgroundColor = .black
    isMultipleTouchEnabled = false

    focusRing.isUserInteractionEnabled = false
    focusRing.alpha = 0
    focusRing.layer.borderWidth = 2
    focusRing.layer.borderColor = UIColor.white.withAlphaComponent(0.92).cgColor
    focusRing.layer.cornerRadius = 34
    focusRing.layer.cornerCurve = .continuous
    addSubview(focusRing)
  }

  private func showFocusRing(at point: CGPoint) {
    focusRing.bounds = CGRect(x: 0, y: 0, width: 68, height: 68)
    focusRing.center = point
    focusRing.transform = CGAffineTransform(scaleX: 1.18, y: 1.18)
    focusRing.alpha = 0.95

    UIView.animate(withDuration: 0.18, delay: 0, options: [.curveEaseOut, .allowUserInteraction]) {
      self.focusRing.transform = .identity
    } completion: { _ in
      UIView.animate(withDuration: 0.34, delay: 0.42, options: [.curveEaseIn, .allowUserInteraction]) {
        self.focusRing.alpha = 0
      }
    }
  }
}

private struct BarcodeOverlay: View {
  let candidate: BarcodeCandidate?

  var body: some View {
    GeometryReader { proxy in
      if let candidate {
        if candidate.previewCorners.count >= 4 {
          Path { path in
            let points = candidate.previewCorners.map { $0.point(in: proxy.size) }
            path.move(to: points[0])
            for point in points.dropFirst() {
              path.addLine(to: point)
            }
            path.closeSubpath()
          }
          .stroke(.green, style: StrokeStyle(lineWidth: 4, lineCap: .round, lineJoin: .round))
          .shadow(color: .green.opacity(0.65), radius: 10)
        } else {
          let rect = candidate.rect(in: proxy.size)
          RoundedRectangle(cornerRadius: 12, style: .continuous)
            .stroke(.green, lineWidth: 4)
            .frame(width: rect.width, height: rect.height)
            .position(x: rect.midX, y: rect.midY)
            .shadow(color: .green.opacity(0.65), radius: 10)
        }
      }
    }
    .allowsHitTesting(false)
  }
}

private struct BarcodeScanGuide: View {
  let candidate: BarcodeCandidate?

  var body: some View {
    GeometryReader { proxy in
      let rect = barcodeScanRect(in: proxy.size, safeAreaInsets: proxy.safeAreaInsets)

      ZStack {
        if let previewText {
          Text(previewText)
            .font(.system(size: 21, weight: .semibold, design: .rounded))
            .foregroundStyle(.white)
            .lineLimit(2)
            .minimumScaleFactor(0.62)
            .multilineTextAlignment(.center)
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .frame(maxWidth: min(proxy.size.width - 48, rect.width + 56))
            .nativeClearGlassBackground(RoundedRectangle(cornerRadius: 20, style: .continuous))
            .position(x: rect.midX, y: max(proxy.safeAreaInsets.top + 88, rect.minY - 40))
            .transition(.opacity.combined(with: .scale(scale: 0.96)))
        }

        RoundedRectangle(cornerRadius: 22, style: .continuous)
          .stroke(.white.opacity(0.76), style: StrokeStyle(lineWidth: 1.4, lineCap: .round))
          .background {
            RoundedRectangle(cornerRadius: 22, style: .continuous)
              .fill(.black.opacity(0.08))
          }
          .frame(width: rect.width, height: rect.height)
          .position(x: rect.midX, y: rect.midY)
          .overlay {
            Path { path in
              path.move(to: CGPoint(x: rect.midX - rect.width * 0.42, y: rect.midY))
              path.addLine(to: CGPoint(x: rect.midX + rect.width * 0.42, y: rect.midY))
            }
            .stroke(.white.opacity(0.22), lineWidth: 1)
          }
      }
      .animation(.smooth(duration: 0.2), value: previewText)
    }
    .allowsHitTesting(false)
  }

  private var previewText: String? {
    guard let value = candidate?.value.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else {
      return nil
    }
    if value.count <= 96 {
      return value
    }
    return "\(value.prefix(93))..."
  }
}

private struct DictationLiveOverlay: View {
  let text: String
  let isListening: Bool

  var body: some View {
    VStack {
      Text(displayText)
        .font(.system(size: 42, weight: .bold, design: .rounded))
        .foregroundStyle(.white)
        .multilineTextAlignment(.leading)
        .lineLimit(4)
        .minimumScaleFactor(0.62)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 28)
        .padding(.top, 96)
      Spacer()
    }
  }

  private var displayText: String {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    if !trimmed.isEmpty {
      return trimmed
    }
    return isListening ? "Listening..." : "Hold to speak"
  }
}

private struct PhotoSquareOverlay: View {
  var body: some View {
    GeometryReader { proxy in
      let side = min(proxy.size.width - 48, proxy.size.height * 0.54)
      let rect = CGRect(
        x: (proxy.size.width - side) / 2,
        y: max(proxy.safeAreaInsets.top + 132, (proxy.size.height - side) * 0.26),
        width: side,
        height: side
      )
      let shape = RoundedRectangle(cornerRadius: 34, style: .continuous)

      ZStack {
        Color.black.opacity(0.48)
          .mask {
            Rectangle()
              .overlay(alignment: .topLeading) {
                shape
                  .frame(width: rect.width, height: rect.height)
                  .offset(x: rect.minX, y: rect.minY)
                  .blendMode(.destinationOut)
              }
              .compositingGroup()
          }

        shape
          .stroke(.white.opacity(0.72), lineWidth: 1.2)
          .frame(width: rect.width, height: rect.height)
          .position(x: rect.midX, y: rect.midY)

        shape
          .stroke(.black.opacity(0.24), lineWidth: 1)
          .frame(width: rect.width - 6, height: rect.height - 6)
          .position(x: rect.midX, y: rect.midY)

        PhotoGridLines(cornerRadius: 30)
          .frame(width: rect.width, height: rect.height)
          .position(x: rect.midX, y: rect.midY)
      }
    }
    .allowsHitTesting(false)
  }
}

private struct PhotoGridLines: View {
  let cornerRadius: CGFloat

  var body: some View {
    GeometryReader { proxy in
      let width = proxy.size.width
      let height = proxy.size.height
      let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)

      Path { path in
        for index in 1...2 {
          let offset = CGFloat(index) / 3
          path.move(to: CGPoint(x: width * offset, y: 0))
          path.addLine(to: CGPoint(x: width * offset, y: height))
          path.move(to: CGPoint(x: 0, y: height * offset))
          path.addLine(to: CGPoint(x: width, y: height * offset))
        }
      }
      .stroke(.white.opacity(0.22), lineWidth: 0.8)
      .clipShape(shape)
    }
  }
}

private struct NormalizedPoint {
  let x: CGFloat
  let y: CGFloat

  func point(in size: CGSize) -> CGPoint {
    CGPoint(x: x * size.width, y: y * size.height)
  }
}

private struct CapturedPhoto {
  let data: Data
  let image: CGImage
  let uiImage: UIImage
  let size: CGSize

  func squareCropped() throws -> CapturedPhoto {
    let side = min(image.width, image.height)
    let cropRect = CGRect(
      x: (image.width - side) / 2,
      y: (image.height - side) / 2,
      width: side,
      height: side
    )
    guard
      let croppedImage = image.cropping(to: cropRect),
      let mutableData = CFDataCreateMutable(nil, 0),
      let destination = CGImageDestinationCreateWithData(mutableData, UTType.jpeg.identifier as CFString, 1, nil)
    else {
      throw ClipError.message("Unable to crop the photo.")
    }

    CGImageDestinationAddImage(destination, croppedImage, [
      kCGImageDestinationLossyCompressionQuality as String: 0.88,
    ] as CFDictionary)
    guard CGImageDestinationFinalize(destination) else {
      throw ClipError.message("Unable to encode the photo.")
    }

    let outputData = mutableData as Data
    let outputImage = UIImage(cgImage: croppedImage, scale: 1, orientation: .right)
    return CapturedPhoto(
      data: outputData,
      image: croppedImage,
      uiImage: outputImage,
      size: CGSize(width: side, height: side)
    )
  }
}

private struct BarcodeCandidate: Identifiable {
  let id = UUID()
  let value: String
  let format: String
  let previewBounds: CGRect
  let previewCorners: [NormalizedPoint]

  func rect(in size: CGSize) -> CGRect {
    CGRect(
      x: previewBounds.minX * size.width,
      y: previewBounds.minY * size.height,
      width: previewBounds.width * size.width,
      height: previewBounds.height * size.height
    )
  }
}

private func nearestZoomStopIndex(to factor: CGFloat) -> Int {
  var bestIndex = 0
  var bestDistance = CGFloat.greatestFiniteMagnitude
  for (index, stop) in clipZoomStops.enumerated() {
    let distance = abs(stop - factor)
    if distance < bestDistance {
      bestDistance = distance
      bestIndex = index
    }
  }
  return bestIndex
}

private func nearestZoomStop(to factor: CGFloat) -> CGFloat {
  clipZoomStops[nearestZoomStopIndex(to: factor)]
}

private func formatZoom(_ factor: CGFloat) -> String {
  factor.truncatingRemainder(dividingBy: 1) == 0 ? "\(Int(factor))x" : String(format: "%.1fx", Double(factor))
}

private func clampedUnit(_ value: CGFloat) -> CGFloat {
  max(0, min(1, value))
}

private func barcodeScanRect(in size: CGSize, safeAreaInsets: EdgeInsets = EdgeInsets()) -> CGRect {
  let width = min(size.width - 48, size.width * 0.78)
  let height = min(max(size.height * 0.14, 96), 148)
  let top = safeAreaInsets.top + max(108, size.height * 0.20)
  return CGRect(
    x: (size.width - width) / 2,
    y: top,
    width: width,
    height: height
  )
}

private func barcodeScanRect(in size: CGSize) -> CGRect {
  barcodeScanRect(in: size, safeAreaInsets: EdgeInsets())
}

private final class ClipCamera: NSObject, ObservableObject, AVCaptureMetadataOutputObjectsDelegate, AVCapturePhotoCaptureDelegate {
  let session = AVCaptureSession()
  var onBarcode: ((BarcodeCandidate) -> Void)?
  var onBarcodeLost: (() -> Void)?

  private let queue = DispatchQueue(label: "com.volt.clip.native.camera")
  private let photoOutput = AVCapturePhotoOutput()
  private let metadataOutput = AVCaptureMetadataOutput()
  private var device: AVCaptureDevice?
  private var isConfigured = false
  private var completion: ((Result<CapturedPhoto, Error>) -> Void)?
  private weak var previewView: PreviewView?
  private var barcodeFullFrame = false

  @MainActor
  func attachPreviewView(_ view: PreviewView) {
    previewView = view
    updateRectOfInterest(from: view.previewLayer)
  }

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

  func setBarcodeFullFrame(_ enabled: Bool) {
    barcodeFullFrame = enabled
    queue.async {
      self.metadataOutput.rectOfInterest = enabled ? CGRect(x: 0, y: 0, width: 1, height: 1) : CGRect(x: 0.18, y: 0.18, width: 0.64, height: 0.64)
      DispatchQueue.main.async {
        if let previewLayer = self.previewView?.previewLayer {
          self.updateRectOfInterest(from: previewLayer)
        }
      }
    }
  }

  @MainActor
  func updateRectOfInterest(from previewLayer: AVCaptureVideoPreviewLayer) {
    guard isConfigured else { return }
    let rect: CGRect
    if barcodeFullFrame || previewLayer.bounds.isEmpty {
      rect = CGRect(x: 0, y: 0, width: 1, height: 1)
    } else {
      let layerBounds = previewLayer.bounds
      let scanRect = barcodeScanRect(in: layerBounds.size)
      rect = previewLayer.metadataOutputRectConverted(fromLayerRect: scanRect)
    }

    let metadataOutput = metadataOutput
    queue.async {
      metadataOutput.rectOfInterest = rect
    }
  }

  func focus(at devicePoint: CGPoint) {
    queue.async {
      guard let device = self.device else { return }
      guard (try? device.lockForConfiguration()) != nil else { return }
      defer { device.unlockForConfiguration() }
      if device.isFocusPointOfInterestSupported {
        device.focusPointOfInterest = devicePoint
        device.focusMode = device.isFocusModeSupported(.autoFocus) ? .autoFocus : .continuousAutoFocus
      }
      if device.isExposurePointOfInterestSupported {
        device.exposurePointOfInterest = devicePoint
        device.exposureMode = device.isExposureModeSupported(.continuousAutoExposure) ? .continuousAutoExposure : .autoExpose
      }
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
    DispatchQueue.main.async {
      if let previewLayer = self.previewView?.previewLayer {
        self.updateRectOfInterest(from: previewLayer)
      }
    }
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
      onBarcodeLost?()
      return
    }

    let overlay = normalizedPreviewOverlay(for: object)
    onBarcode?(
      BarcodeCandidate(
        value: value,
        format: metadataName(object.type),
        previewBounds: overlay.bounds,
        previewCorners: overlay.corners
      )
    )
  }

  private func normalizedPreviewOverlay(for object: AVMetadataMachineReadableCodeObject) -> (bounds: CGRect, corners: [NormalizedPoint]) {
    guard let previewView, !previewView.bounds.isEmpty else {
      return (
        CGRect(
          x: max(0, min(1, object.bounds.origin.x)),
          y: max(0, min(1, object.bounds.origin.y)),
          width: max(0.06, min(1, object.bounds.width)),
          height: max(0.06, min(1, object.bounds.height))
        ),
        []
      )
    }

    let transformed = previewView.previewLayer.transformedMetadataObject(for: object) as? AVMetadataMachineReadableCodeObject
    let bounds = transformed?.bounds ?? .null
    guard !bounds.isNull, !bounds.isEmpty else {
      return (CGRect(x: 0.47, y: 0.47, width: 0.06, height: 0.06), [])
    }

    let viewBounds = previewView.bounds
    let clipped = bounds.intersection(viewBounds)
    guard !clipped.isNull, !clipped.isEmpty else {
      return (CGRect(x: 0.47, y: 0.47, width: 0.06, height: 0.06), [])
    }

    let normalizedBounds = CGRect(
      x: clampedUnit(clipped.minX / viewBounds.width),
      y: clampedUnit(clipped.minY / viewBounds.height),
      width: max(0.02, min(1, clipped.width / viewBounds.width)),
      height: max(0.02, min(1, clipped.height / viewBounds.height))
    )

    let corners = (transformed?.corners ?? [])
      .map { point in
        NormalizedPoint(
          x: clampedUnit(point.x / viewBounds.width),
          y: clampedUnit(point.y / viewBounds.height)
        )
      }

    return (normalizedBounds, corners.count >= 4 ? corners : [])
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
    let uiImage = UIImage(cgImage: image, scale: 1, orientation: .right)
    completion?(.success(CapturedPhoto(data: data, image: image, uiImage: uiImage, size: CGSize(width: image.width, height: image.height))))
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

private struct EnhancedTextImage {
  let cgImage: CGImage
  let uiImage: UIImage
}

private enum TextImageEnhancer {
  static func cleanedImage(from image: CGImage) async throws -> EnhancedTextImage {
    try await Task.detached(priority: .userInitiated) {
      let context = CIContext(options: nil)
      let inputImage = CIImage(cgImage: image)

      let noiseReduction = CIFilter.noiseReduction()
      noiseReduction.inputImage = inputImage
      noiseReduction.noiseLevel = 0.02
      noiseReduction.sharpness = 0.55

      let colorControls = CIFilter.colorControls()
      colorControls.inputImage = noiseReduction.outputImage ?? inputImage
      colorControls.brightness = 0.02
      colorControls.contrast = 1.22
      colorControls.saturation = 0.92

      let sharpen = CIFilter.sharpenLuminance()
      sharpen.inputImage = colorControls.outputImage ?? inputImage
      sharpen.sharpness = 0.55

      guard
        let outputImage = sharpen.outputImage,
        let cgImage = context.createCGImage(outputImage, from: outputImage.extent)
      else {
        throw ClipError.message("Unable to clean up the captured image.")
      }

      return EnhancedTextImage(
        cgImage: cgImage,
        uiImage: UIImage(cgImage: cgImage, scale: 1, orientation: .right)
      )
    }.value
  }
}

private final class ClipDictation: NSObject {
  let sessionId = UUID().uuidString
  var onPartial: ((String) -> Void)?
  var onFinal: ((String) -> Void)?

  private let audioEngine = AVAudioEngine()
  private let speechRecognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
  private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
  private var recognitionTask: SFSpeechRecognitionTask?
  private var transcript = ""
  private var completedTranscript = ""
  private var isAudioSessionPrepared = false

  func prepareForUse() async throws {
    try await requestPermissions()
    try configureAudioSessionIfNeeded()
    _ = audioEngine.inputNode.outputFormat(forBus: 0)
    audioEngine.prepare()
  }

  func start(sessionId browserSessionId: String, addsPunctuation: Bool) async throws {
    stop()
    try await prepareForUse()
    transcript = ""
    completedTranscript = ""

    let request = SFSpeechAudioBufferRecognitionRequest()
    request.shouldReportPartialResults = true
    if #available(iOS 16.0, *) {
      request.addsPunctuation = addsPunctuation
    }
    recognitionRequest = request

    recognitionTask = speechRecognizer?.recognitionTask(with: request) { [weak self] result, error in
      guard let self else { return }
      if let result {
        let text = result.bestTranscription.formattedString
        self.transcript = text
        self.onPartial?(text)
        if result.isFinal {
          self.completedTranscript = text
          self.onFinal?(text)
        }
      }
      if error != nil, self.completedTranscript.isEmpty {
        self.completedTranscript = self.transcript
      }
    }

    let input = audioEngine.inputNode
    let format = input.outputFormat(forBus: 0)
    input.removeTap(onBus: 0)
    input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
      self?.recognitionRequest?.append(buffer)
    }

    audioEngine.prepare()
    try audioEngine.start()
  }

  func stop() {
    if audioEngine.isRunning {
      audioEngine.stop()
    }
    audioEngine.inputNode.removeTap(onBus: 0)
    recognitionRequest?.endAudio()
    recognitionTask?.cancel()
    recognitionTask = nil
    recognitionRequest = nil
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    isAudioSessionPrepared = false
  }

  func finishAndStop(tailDuration: TimeInterval, timeout: TimeInterval) async -> String? {
    let tailNanoseconds = UInt64(max(0, tailDuration) * 1_000_000_000)
    if tailNanoseconds > 0 {
      try? await Task.sleep(nanoseconds: tailNanoseconds)
    }

    if audioEngine.isRunning {
      audioEngine.stop()
    }
    audioEngine.inputNode.removeTap(onBus: 0)
    recognitionRequest?.endAudio()

    let completed = await waitForFinalTranscript(timeout: timeout)
    recognitionTask?.finish()
    recognitionTask = nil
    recognitionRequest = nil
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    isAudioSessionPrepared = false

    let completedValue = completed?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return completedValue.isEmpty ? nil : completedValue
  }

  private func configureAudioSessionIfNeeded() throws {
    guard !isAudioSessionPrepared else { return }
    let session = AVAudioSession.sharedInstance()
    try session.setCategory(.record, mode: .measurement, options: [.duckOthers, .allowBluetoothHFP])
    try session.setActive(true, options: .notifyOthersOnDeactivation)
    isAudioSessionPrepared = true
  }

  private func waitForFinalTranscript(timeout: TimeInterval) async -> String? {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
      let completed = completedTranscript.trimmingCharacters(in: .whitespacesAndNewlines)
      if !completed.isEmpty {
        return completed
      }
      try? await Task.sleep(nanoseconds: 80_000_000)
    }
    let partial = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
    return partial.isEmpty ? nil : partial
  }

  private func requestPermissions() async throws {
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
    let speechStatus = await withCheckedContinuation { continuation in
      SFSpeechRecognizer.requestAuthorization { continuation.resume(returning: $0) }
    }
    guard speechStatus == .authorized else {
      throw ClipError.message("Speech recognition permission is required.")
    }
    guard speechRecognizer?.isAvailable == true else {
      throw ClipError.message("Speech recognition is unavailable.")
    }
  }
}

private struct ClipHTTPStatusError: LocalizedError {
  let statusCode: Int
  let message: String?

  var errorDescription: String? {
    if let message, !message.isEmpty {
      return "Chrome session returned \(statusCode): \(message)."
    }
    return "Chrome session returned \(statusCode)."
  }

  var shouldRepairRelay: Bool {
    statusCode == 404 || (statusCode == 400 && message == "Result mode mismatch")
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
